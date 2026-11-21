#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Giro completo per GitHub Actions: scansione -> verifica dei vuoti -> controllo anti-blocco -> build del sito.

  python pipeline.py scan     riscansiona tutto da zero (prezzi nuovi a ogni giro) e scrive scan_meta.json
  python pipeline.py build    build_trips.py, build.py, build_v2.py -> _site/index.html + _site/img/
  python pipeline.py meta     ricalcola scan_meta.json dai file presenti (dopo un caricamento a mano dei dati)

Dati:
  raw_v2.jsonl, trips_raw_v2.jsonl   risultati del giro in corso (una riga per query, riprendibili)
  prev/                              gli stessi file del giro precedente, scaricati dal branch "data"
  scan_meta.json                     riepilogo del giro: conteggi, durata, query non rifatte ("stale")

Tempo: la fase A di ogni scansione ha un tetto (SCAN_BUDGET_MIN, default 240 minuti in tutto). Se il tetto scatta,
le query non rifatte vengono riprese dal giro precedente, segnate come "stale" e rifatte per prime al giro dopo
(rotazione): il job resta sotto le 6 ore e nessuna rotta resta vecchia per piu' di un giro.

ABORT: se Google blocca il runner le pagine tornano vuote. Sulle query rifatte in questo giro si confronta il numero
di risultati con voli con quello del giro precedente: sotto il 60% (MIN_OK_RATIO) il giro si ferma con exit 1, e il
workflow non pubblica e non manda avvisi. Senza giro precedente servono almeno 100 risultati (MIN_OK_ABS).
Stessa fine se Google risponde piu' di 150 volte (MAX_BLOCKED) con 429 / captcha: la scansione si ferma subito.
FORCE_PUBLISH=1 salta il controllo (un calo vero, da confermare a mano).

scan.py, scan_trips.py, verify.py, build*.py restano quelli del progetto: qui si orchestrano soltanto.
"""
import json, os, re, shutil, subprocess, sys, time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT); sys.path.insert(0, ROOT)
RAW, TRIPS_RAW, META, PREV = "raw_v2.jsonl", "trips_raw_v2.jsonl", "scan_meta.json", "prev"
BUDGET = float(os.environ.get("SCAN_BUDGET_MIN") or 240) * 60
VERIFY_BUDGET = float(os.environ.get("VERIFY_BUDGET_MIN") or 40) * 60
MIN_OK_RATIO = float(os.environ.get("MIN_OK_RATIO") or 0.6)
MIN_OK_ABS = int(os.environ.get("MIN_OK_ABS") or 100)
MAX_BLOCKED = int(os.environ.get("MAX_BLOCKED") or 150)
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def log(*a):
    print(*a, flush=True)


def load(path):
    out = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                try:
                    r = json.loads(ln); out[r["k"]] = r
                except Exception:
                    pass
    return out


def fail(msg):
    """Motivo leggibile per il messaggio Telegram all'admin, poi exit 1."""
    log("ABORT:", msg)
    with open("fail_reason.txt", "w", encoding="utf-8") as f:
        f.write(msg + "\n")
    sys.exit(1)


def today_it():
    try:
        from zoneinfo import ZoneInfo
        d = datetime.now(ZoneInfo("Europe/Rome"))
    except Exception:
        d = datetime.now()
    return "%d %s %d" % (d.day, MESI[d.month - 1], d.year)


# ---------------------------------------------------------------- scansione

def bounded(mod, deadline):
    """Dopo la scadenza le query in coda non partono piu' (scan.run / scan_trips.run leggono `work` a ogni submit)."""
    orig = mod.work
    def work(*a, **k):
        if mod.stats.get("blocked", 0) > MAX_BLOCKED:
            return                      # 429 / captcha a ripetizione: inutile insistere, il giro va in ABORT
        if time.time() < deadline[0]:
            return orig(*a, **k)
    mod.work = work


def carry(path, prev, wanted, fresh):
    """Copia dal giro precedente le righe delle query non rifatte. -> chiavi riprese (stale)."""
    done = load(path)
    stale = []
    with open(path, "a", encoding="utf-8") as f:
        for k in wanted:
            if k not in done and k in prev:
                f.write(json.dumps(prev[k], ensure_ascii=False, separators=(",", ":")) + "\n")
                stale.append(k)
    fresh.update(k for k in wanted if k in done)
    return stale


def scan():
    t0 = time.time()
    for p in (RAW, TRIPS_RAW, META, "fail_reason.txt"):
        if os.path.exists(p):
            os.remove(p)                      # da zero a ogni giro
    prev_raw, prev_trips = load(os.path.join(PREV, RAW)), load(os.path.join(PREV, TRIPS_RAW))
    try:
        prev_meta = json.load(open(os.path.join(PREV, META), encoding="utf-8"))
    except Exception:
        prev_meta = {}
    first = set(prev_meta.get("stale") or [])   # non rifatte al giro scorso: adesso vanno per prime
    log("giro precedente: %d + %d query, %d da rifare per prime" % (len(prev_raw), len(prev_trips), len(first)))

    import scan as S, scan_trips as T
    assert S.RAW == RAW and T.RAW == TRIPS_RAW, "nomi dei file dati cambiati: %s %s" % (S.RAW, T.RAW)
    deadline = [0.0]
    bounded(S, deadline); bounded(T, deadline)
    fresh, stale = set(), []

    # destinazioni: fase A (fino a 2 scali) con tetto, fase B (1 scalo, dove A ha trovato voli) completa
    a = [c + (2,) for c in S.combos()]
    key = lambda t: "%s|%s|%s|%s|%d" % t
    deadline[0] = t0 + BUDGET * 0.6
    pri = [t for t in a if key(t) in first]
    if pri:
        S.run(pri, "A(ms2, prima le vecchie)")
    S.run(a, "A(ms2)")
    stale += carry(RAW, prev_raw, [key(t) for t in a], fresh)
    deadline[0] = float("inf")
    def phase_b(label):
        done = load(RAW)
        b = [t[:4] + (1,) for t in a if key(t) in fresh and done.get(key(t), {}).get("st") == "ok"]
        S.run(b, label)
        done = load(RAW)
        fresh.update(k for k in map(key, b) if k in done)
        return b
    phase_b("B(ms1)")
    done = load(RAW)   # query a 1 scalo delle rotte non rifatte: restano quelle del giro precedente
    stale += carry(RAW, prev_raw, [k[:-1] + "1" for k in stale if done.get(k, {}).get("st") == "ok"], set())
    dest_stats = dict(S.stats)

    # popular trips: A con tetto, B completa, C = ricontrollo lento dei vuoti
    ta = T.tasks(2)
    deadline[0] = t0 + BUDGET
    pri = [k for k in ta if k in first]
    if pri:
        T.run(pri, "trips A(ms2, prima le vecchie)")
    T.run(ta, "trips A(ms2)")
    tfresh = set()
    tstale = carry(TRIPS_RAW, prev_trips, ta, tfresh)
    deadline[0] = float("inf")
    done = load(TRIPS_RAW)
    tb = [k[:-1] + "1" for k in ta if k in tfresh and done.get(k, {}).get("st") == "ok"]
    T.run(tb, "trips B(ms1)")
    done = load(TRIPS_RAW)
    tfresh.update(k for k in tb if k in done)
    tstale += carry(TRIPS_RAW, prev_trips, [k[:-1] + "1" for k in tstale if done.get(k, {}).get("st") == "ok"], set())
    deadline[0] = time.time() + VERIFY_BUDGET / 2
    T.run(sorted(tfresh), "trips C(ricontrollo vuoti)", workers=2, v=1, slow=True)
    trip_stats = dict(T.stats)

    # verifica dei vuoti (verify.py): prima le coppie senza nessun volo, poi fase B per quelle sbloccate, poi il resto.
    # verify.py legge raw.jsonl come "scansione precedente": gli si da' il giro scorso, poi si toglie.
    have_prev = os.path.exists(os.path.join(PREV, RAW))
    if have_prev:
        shutil.copyfile(os.path.join(PREV, RAW), "raw.jsonl")
    try:
        vt0 = time.time()
        for mode in ("none", "ok"):
            left = VERIFY_BUDGET - (time.time() - vt0)
            if left < 60:
                log("verifica %s saltata: tempo finito" % mode); break
            try:
                subprocess.run([sys.executable, "verify.py", "1", mode], timeout=left, check=False,
                               env=dict(os.environ, WORKERS=str(min(3, int(os.environ.get("WORKERS") or 3)))))
            except subprocess.TimeoutExpired:
                log("verifica %s interrotta al tetto di tempo (le righe gia' scritte restano)" % mode)
            if mode == "none":
                phase_b("B(ms1) dopo verifica")
    finally:
        if os.path.exists("raw.jsonl"):
            os.remove("raw.jsonl")

    # controllo anti-blocco sulle sole query rifatte adesso
    now_raw, now_trips = load(RAW), load(TRIPS_RAW)
    ok = lambda d, ks: sum(1 for k in ks if d.get(k, {}).get("st") == "ok")
    n_fresh = len(fresh) + len(tfresh)
    ok_now = ok(now_raw, fresh) + ok(now_trips, tfresh)
    ok_prev = ok(prev_raw, fresh) + ok(prev_trips, tfresh)
    blocked = dest_stats.get("blocked", 0) + trip_stats.get("blocked", 0)
    meta = {"date": today_it(), "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "minutes": round((time.time() - t0) / 60, 1),
            "queries": len(now_raw) + len(now_trips), "fresh": n_fresh, "ok_fresh": ok_now, "ok_prev_same": ok_prev,
            "ok_total": ok(now_raw, now_raw) + ok(now_trips, now_trips), "blocked": blocked,
            "dest": dest_stats, "trips": trip_stats, "stale": sorted(stale + tstale)}
    log("RIEPILOGO", json.dumps({k: v for k, v in meta.items() if k != "stale"}, ensure_ascii=False), "| stale:", len(meta["stale"]))
    if os.environ.get("FORCE_PUBLISH") in ("1", "true"):
        log("FORCE_PUBLISH: controllo anti-blocco saltato")
    elif blocked > MAX_BLOCKED:
        fail("Google ha risposto %d volte con un blocco (429 / captcha): scansione interrotta. Niente pubblicazione, niente avvisi." % blocked)
    elif n_fresh == 0:
        fail("nessuna query completata in questo giro (%d bloccate)" % blocked)
    elif ok_prev >= 50 and ok_now < MIN_OK_RATIO * ok_prev:
        fail("solo %d risultati con voli contro %d del giro precedente sulle stesse %d query (%d bloccate): "
             "Google sta probabilmente bloccando il runner. Niente pubblicazione, niente avvisi." % (ok_now, ok_prev, n_fresh, blocked))
    elif ok_prev < 50 and ok_now < min(MIN_OK_ABS, max(1, n_fresh // 20)):
        fail("solo %d risultati con voli su %d query e nessun giro precedente con cui confrontare (%d bloccate)." % (ok_now, n_fresh, blocked))
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("OK-SCAN fresh=%d ok=%d (giro prima %d) stale=%d minuti=%s" % (n_fresh, ok_now, ok_prev, len(meta["stale"]), meta["minutes"]))


def write_meta():
    """scan_meta.json dai file presenti (dati caricati a mano: nessuna query 'stale')."""
    r, t = load(RAW), load(TRIPS_RAW)
    n_ok = sum(1 for d in (r, t) for x in d.values() if x.get("st") == "ok")
    meta = {"date": today_it(), "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "manual": True,
            "queries": len(r) + len(t), "ok_total": n_ok, "stale": []}
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("scan_meta.json:", meta["queries"], "query,", n_ok, "con voli")


# ---------------------------------------------------------------- build

def build():
    if not os.path.exists(RAW):
        fail("manca %s: nessun dato da pubblicare" % RAW)
    for cmd in (["build_trips.py"], ["build.py"], ["build_v2.py", "--raw", "v2"]):
        log("$ python", " ".join(cmd))
        r = subprocess.run([sys.executable] + cmd)
        if r.returncode:
            fail("%s fallito (exit %d)" % (cmd[0], r.returncode))
    html = open("agosto-2027-v2.html", encoding="utf-8").read()
    for marker in ("/*__DATA__*/", "/*__PHOTOS__*/", "/*__CSS__*/", "/*__JS__*/"):
        if marker in html:
            fail("pagina incompleta: segnaposto %s non sostituito" % marker)
    if len(html) < 200000:
        fail("pagina troppo piccola (%d caratteri): dati mancanti" % len(html))
    # data dei prezzi: build.py / build_trips.py la portano scritta a mano, qui diventa quella del giro
    try:
        when = json.load(open(META, encoding="utf-8"))["date"]
    except Exception:
        when = today_it()
    html, n = re.subn(r'"date":"\d{1,2} [a-z]+ 20\d\d"', lambda m: '"date":"%s"' % when, html)
    log("data dei prezzi: %s (%d punti)" % (when, n))
    if re.search(r'(src|href)=["\']/(?!/)', html):
        log("ATTENZIONE: la pagina contiene path assoluti (/...): su Pages il sito sta sotto /agosto2027/")
    shutil.rmtree("_site", ignore_errors=True)
    os.makedirs("_site")
    with open("_site/index.html", "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    shutil.copytree("img", "_site/img")
    open("_site/.nojekyll", "w").close()
    log("OK-BUILD _site/index.html %d byte, img %d file" % (os.path.getsize("_site/index.html"), len(os.listdir("_site/img"))))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "scan":
        scan()
    elif stage == "build":
        build()
    elif stage == "meta":
        write_meta()
    else:
        sys.exit(__doc__)
