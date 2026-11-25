#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Giro completo per GitHub Actions: scansione -> verifica dei vuoti -> controllo anti-blocco -> build del sito.

  python pipeline.py scan     riscansiona tutto da zero (prezzi nuovi a ogni giro) e scrive scan_meta.json
  python pipeline.py build    build_trips.py, build.py, storico prezzi, build_v2.py -> _site/index.html, data.json, world.json, img/
  python pipeline.py fill     solo le query che mancano nei dati dell'ultimo giro (mete/trip appena aggiunti)
  python pipeline.py retry    ripresa mirata: rifa' con GetShoppingResults e piu' tentativi solo le richieste rimaste senza
                              voli nell'ultimo giro (retry.py): popular trips, poi A/R veri delle stime, poi le mete vuote
  python pipeline.py meta     ricalcola scan_meta.json dai file presenti (dopo un caricamento a mano dei dati)

Dati:
  raw_v2.jsonl, trips_raw_v2.jsonl   risultati del giro in corso (una riga per query, riprendibili)
  prev/                              gli stessi file del giro precedente, scaricati dal branch "data"
  scan_meta.json                     riepilogo del giro: conteggi, durata, query non rifatte ("stale")
  bot/state/price_history.json       storico del prezzo piu' basso per meta e trip (price_history.py): sta su main, lo
                                     aggiorna il build a ogni giro riuscito e lo committa il workflow della scansione

Stime (estimate.py): dopo la verifica, per le coppie aeroporto-meta rimaste senza nessun A/R si cercano i solo andata
con GetShoppingResults (la chiamata che il browser fa dopo aver caricato la pagina: vedi gf.py) e il sito mostra la somma
andata + ritorno come stima dichiarata; poi, dalle celle piu' economiche, si chiede l'A/R vero alla stessa chiamata e
dove arriva sostituisce la stima (resta anche per i 4 giri dopo se quel giorno non risponde). Tetto di tempo:
EST_BUDGET_MIN (default 75 minuti, o un terzo di SCAN_BUDGET_MIN nelle prove corte), ridotto se il giro e' gia' lungo (TOTAL_BUDGET_MIN, default 235 in tutto). Le
chiavi non rifatte in tempo restano quelle del giro prima e vanno per prime al giro dopo. EST_BUDGET_MIN=0 le spegne.
Lo stesso ripiego e' acceso nel ricontrollo dei vuoti dei popular trips (fase C e verify_trips.py).

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
VERIFY_BUDGET = float(os.environ.get("VERIFY_BUDGET_MIN") or 150) * 60   # meta' ai trip (C + verify_trips.py), meta' a verify.py
EST_BUDGET = float(os.environ.get("EST_BUDGET_MIN") or min(75, BUDGET / 180))              # minuti per le stime (solo andata + A/R vero delle celle migliori)
TOTAL_BUDGET = float(os.environ.get("TOTAL_BUDGET_MIN") or 235)          # oltre questo totale le stime si accorciano
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


def estimates(t0, prev_raw, prev_trips, first=()):
    """Stime per le coppie senza A/R (estimate.py). -> (riepilogo per scan_meta.json, chiavi riprese dal giro prima).
    Non fa mai fallire il giro: se qualcosa va storto restano i dati veri e le stime del giro prima."""
    budget = min(EST_BUDGET, TOTAL_BUDGET - (time.time() - t0) / 60)
    if EST_BUDGET <= 0:
        return {"off": True}, []
    budget = max(budget, min(15, EST_BUDGET))
    try:
        import estimate, gf
        had = {k for k, r in prev_raw.items() if r.get("src") == "api" and r.get("st") == "ok" and k.endswith("|2")}   # A/R veri del giro prima
        res = estimate.run(budget, known=estimate.ok_routes(prev_trips), first=first, skip=had)
        keys, rt_keys = res.pop("keys"), res.pop("rt_keys")
        res["api"] = dict(gf.api_stats)
    except Exception as e:
        log("ATTENZIONE: stime non aggiornate (%s: %s)" % (type(e).__name__, str(e)[:200]))
        return {"error": type(e).__name__}, []
    # chiavi non rifatte (tempo finito o errore): se il giro prima aveva i voli, restano quelli
    now, stale = load(TRIPS_RAW), []
    with open(TRIPS_RAW, "a", encoding="utf-8") as f:
        for k in keys:
            r, p = now.get(k), prev_trips.get(k)
            if p and p.get("st") == "ok" and (r is None or (r.get("st") != "ok" and r.get("src") != "api")):
                f.write(json.dumps(p, ensure_ascii=False, separators=(",", ":")) + "\n")
                stale.append(k)
    # A/R veri (GetShoppingResults) del giro prima sulle celle che oggi non hanno risposto: restano, per al massimo 4 giri
    now, kept = load(RAW), 0
    with open(RAW, "a", encoding="utf-8") as f:
        for k2 in sorted(had):
            if k2 in now and now[k2].get("st") != "ok" and now[k2].get("src") != "api" and prev_raw[k2].get("age", 0) < 4:
                for k in (k2, k2[:-1] + "1"):
                    if k in prev_raw and (k == k2 or prev_raw[k].get("src") == "api"):
                        f.write(json.dumps(dict(prev_raw[k], age=prev_raw[k2].get("age", 0) + 1), ensure_ascii=False, separators=(",", ":")) + "\n")
                kept += 1
    res["stale"], res["rt_kept"] = len(stale), kept
    log("STIME", json.dumps(res, ensure_ascii=False))
    return res, stale


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
    deadline[0] = time.time() + VERIFY_BUDGET / 4
    import gf
    gf.API_ON = True     # pagina vuota -> GetShoppingResults: sulle rotte poco cercate i solo andata arrivano solo cosi'
    T.run(sorted(tfresh), "trips C(ricontrollo vuoti)", workers=2, v=1, slow=True)
    gf.API_ON = False
    # verify_trips.py: secondo ricontrollo (v=2) dei vuoti sulle rotte che hanno gia' voli, poi fase B per le sbloccate
    deadline[0] = float("inf")
    tv0 = time.time()
    for target in (2, 3):
        left = VERIFY_BUDGET / 4 - (time.time() - tv0)
        if left < 60 or not os.path.exists("verify_trips.py"):
            break
        try:
            subprocess.run([sys.executable, "verify_trips.py", str(target)], timeout=left, check=False,
                           env=dict(os.environ, WORKERS="2", GF_API="1"))
        except subprocess.TimeoutExpired:
            log("verify_trips interrotta al tetto di tempo (le righe gia' scritte restano)")
        done = load(TRIPS_RAW)
        tb2 = [k[:-1] + "1" for k in ta if done.get(k, {}).get("st") == "ok" and k[:-1] + "1" not in done]
        T.run(tb2, "trips B(ms1) dopo verifica %d" % target)
        done = load(TRIPS_RAW)
        tfresh.update(k for k in tb2 if k in done)
    trip_stats = dict(T.stats)

    # verifica dei vuoti (verify.py): prima le coppie senza nessun volo, poi fase B per quelle sbloccate, poi il resto.
    # verify.py legge raw.jsonl come "scansione precedente": gli si da' il giro scorso, poi si toglie.
    have_prev = os.path.exists(os.path.join(PREV, RAW))
    if have_prev:
        shutil.copyfile(os.path.join(PREV, RAW), "raw.jsonl")
    try:
        vt0 = time.time()
        # Sul runner molte pagine tornano vuote per carico: ogni passata di verify.py ne recupera una parte, e ogni
        # query a 2 scali recuperata ha bisogno della sua query a 1 scalo (fase B), i cui vuoti passano al giro dopo.
        for mode, target in (("none", "1"), ("ok", "1"), ("ok", "2"), ("ok", "3")):
            left = VERIFY_BUDGET / 2 - (time.time() - vt0)
            if left < 60:
                log("verifica %s %s saltata: tempo finito" % (mode, target)); break
            try:
                subprocess.run([sys.executable, "verify.py", target, mode], timeout=left, check=False,
                               env=dict(os.environ, WORKERS=str(min(3, int(os.environ.get("WORKERS") or 3)))))
            except subprocess.TimeoutExpired:
                log("verifica %s %s interrotta al tetto di tempo (le righe gia' scritte restano)" % (mode, target))
            phase_b("B(ms1) dopo verifica %s %s" % (mode, target))
    finally:
        if os.path.exists("raw.jsonl"):
            os.remove("raw.jsonl")

    # stime per le coppie rimaste senza A/R (fuori dal controllo anti-blocco: sono un'altra fonte)
    est, est_stale = estimates(t0, prev_raw, prev_trips, first)
    tstale += est_stale

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
            "dest": dest_stats, "trips": trip_stats, "est": est, "stale": sorted(stale + tstale)}
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


# ---------------------------------------------------------------- solo le query nuove

def fill():
    """Mete o trip appena aggiunti ai cataloghi: si parte dai dati dell'ultimo giro (prev/) e si interrogano solo le
    query che mancano, con due ricontrolli lenti dei vuoti. La data dei prezzi resta quella del giro: le righe nuove
    sono piu' fresche, mai piu' vecchie. Nessun controllo anti-blocco sul totale (le righe vecchie restano intatte)."""
    t0 = time.time()
    for name in (RAW, TRIPS_RAW, META):
        src = os.path.join(PREV, name)
        if not os.path.exists(src):
            fail("manca %s del giro precedente: lancia prima la scansione completa" % src)
        shutil.copyfile(src, name)
    import scan as S, scan_trips as T
    key = lambda t: "%s|%s|%s|%s|%d" % t
    prev_raw, prev_trips = load(RAW), load(TRIPS_RAW)
    a = [c + (2,) for c in S.combos() if key(c + (2,)) not in prev_raw]
    ta = [k for k in T.tasks(2) if k not in prev_trips]
    log("query nuove: %d mete, %d trip" % (len(a), len(ta)))
    if not a and not ta:
        log("niente di nuovo da cercare: solo le stime mancanti")

    def rewrite(path, drop):
        rows = load(path)
        with open(path, "w", encoding="utf-8") as f:
            for k, r in rows.items():
                if k not in drop:
                    f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + chr(10))

    def dest_round(tasks, label):
        S.run(tasks, label)
        for i in (1, 2):                     # ricontrollo dei vuoti: si tolgono e si rifanno con calma
            done = load(RAW)
            empty = [t for t in tasks if done.get(key(t), {}).get("st") in ("empty", "error")]
            if not empty:
                break
            rewrite(RAW, {key(t) for t in empty})
            time.sleep(30)
            S.run(empty, "%s ricontrollo %d" % (label, i))

    if a:
        dest_round(a, "nuove A(ms2)")
        done = load(RAW)
        b = [t[:4] + (1,) for t in a if done.get(key(t), {}).get("st") == "ok" and key(t[:4] + (1,)) not in done]
        if b:
            dest_round(b, "nuove B(ms1)")
    if ta:
        T.run(ta, "trip nuovi A(ms2)")
        T.run(ta, "trip nuovi ricontrollo", workers=2, v=1, slow=True)
        T.run(ta, "trip nuovi ricontrollo 2", workers=2, v=2, slow=True)
        done = load(TRIPS_RAW)
        tb = [k[:-1] + "1" for k in ta if done.get(k, {}).get("st") == "ok" and k[:-1] + "1" not in done]
        if tb:
            T.run(tb, "trip nuovi B(ms1)")
            T.run(tb, "trip nuovi B ricontrollo", workers=2, v=1, slow=True)

    est, _ = estimates(t0, prev_raw, prev_trips)   # stime per le mete nuove rimaste senza A/R (e per le chiavi mancanti delle altre)
    r, t = load(RAW), load(TRIPS_RAW)
    for path, rows in ((RAW, r), (TRIPS_RAW, t)):
        rewrite(path, set())                 # una riga per chiave
    blocked = S.stats.get("blocked", 0) + T.stats.get("blocked", 0)
    new_keys = [key(x) for x in a] + ta
    ok_new = sum(1 for k in new_keys if (r.get(k) or t.get(k) or {}).get("st") == "ok")
    meta = json.load(open(META, encoding="utf-8"))
    meta.update({"queries": len(r) + len(t),
                 "ok_total": sum(1 for d in (r, t) for x in d.values() if x.get("st") == "ok"),
                 "fill": {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "minutes": round((time.time() - t0) / 60, 1), "new": len(new_keys), "ok_new": ok_new,
                          "blocked": blocked, "est": est}})
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("OK-FILL nuove=%d con voli=%d bloccate=%d minuti=%s" % (len(new_keys), ok_new, blocked, meta["fill"]["minutes"]))
    if blocked > MAX_BLOCKED:
        fail("Google ha bloccato %d query durante la ricerca delle mete nuove: dati non pubblicati." % blocked)


# ---------------------------------------------------------------- ripresa mirata

def retry():
    """Dai dati dell'ultimo giro (prev/) si rifanno solo le richieste rimaste senza voli: ordine e regole in retry.py.
    La data dei prezzi resta quella del giro; i conteggi vanno nel blocco "retry" di scan_meta.json. Tetto di tempo:
    RETRY_BUDGET_MIN (default 150). Se Google blocca (RETRY_MAX_BLOCKS) ci si ferma e si pubblica quello che e' arrivato:
    le righe scritte sono voli veri, e quelle del giro restano intatte."""
    for name in (RAW, TRIPS_RAW, META):
        src = os.path.join(PREV, name)
        if not os.path.exists(src):
            fail("manca %s del giro precedente: lancia prima la scansione completa" % src)
        shutil.copyfile(src, name)
    import retry as R
    assert (R.RAW, R.TRIPS_RAW) == (RAW, TRIPS_RAW), "nomi dei file dati cambiati: %s %s" % (R.RAW, R.TRIPS_RAW)
    res = R.run(float(os.environ.get("RETRY_BUDGET_MIN") or 150))
    r, t = load(RAW), load(TRIPS_RAW)
    meta = json.load(open(META, encoding="utf-8"))
    res["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    res["runs"] = (meta.get("retry") or {}).get("runs", 0) + 1
    meta.update({"queries": len(r) + len(t), "ok_total": sum(1 for d in (r, t) for x in d.values() if x.get("st") == "ok"), "retry": res})
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log("RIPRESA", json.dumps(res, ensure_ascii=False))
    if res["stopped"]:
        log("ATTENZIONE: ripresa fermata dopo %d blocchi di Google (429 / captcha): si pubblica quello che e' arrivato" % res["blocked"])
    log("OK-RETRY righe nuove con voli=%d trip con prezzo %d -> %d mete %s -> %s minuti=%s" % (
        res["new_ok"], res["trips"]["prima"], res["trips"]["dopo"], res["dests"]["prima"], res["dests"]["dopo"], res["minutes"]))


# ---------------------------------------------------------------- build

def build():
    if not os.path.exists(RAW):
        fail("manca %s: nessun dato da pubblicare" % RAW)
    for cmd in (["build_trips.py"], ["build.py"], ["price_history.py", "update"], ["build_v2.py", "--raw", "v2"]):
        log("$ python", " ".join(cmd))
        r = subprocess.run([sys.executable] + cmd)
        if r.returncode and cmd[0] == "price_history.py":
            log("ATTENZIONE: storico prezzi non aggiornato (exit %d): il sito esce con lo storico che c'era" % r.returncode)
        elif r.returncode:
            fail("%s fallito (exit %d)" % (cmd[0], r.returncode))
    html = open("agosto-2027-v2.html", encoding="utf-8").read()
    for marker in ("/*__DATA_URL__*/", "<!--__HEAD__-->", "/*__CSS__*/", "/*__JS__*/"):
        if marker in html:
            fail("pagina incompleta: segnaposto %s non sostituito" % marker)
    # i dati stanno in data.json, accanto alla pagina (la pagina lo scarica all'avvio)
    if not os.path.exists("data.json"):
        fail("manca data.json: build_v2.py non ha scritto i dati")
    data = open("data.json", encoding="utf-8").read()
    if len(data) < 200000 or len(html) < 60000:
        fail("pagina o dati troppo piccoli (%d e %d caratteri): dati mancanti" % (len(html), len(data)))
    old = re.search(r"data\.json\?v=([0-9a-f]{6,40})", html)
    if not old:
        fail("la pagina non punta a data.json")
    # data dei prezzi: build.py / build_trips.py la portano scritta a mano, qui diventa quella del giro
    try:
        when = json.load(open(META, encoding="utf-8"))["date"]
    except Exception:
        when = today_it()
    data, n = re.subn(r'"date":"\d{1,2} [a-z]+ 20\d\d"', lambda m: '"date":"%s"' % when, data)
    log("data dei prezzi: %s (%d punti)" % (when, n))
    try:
        json.loads(data)
    except ValueError as e:
        fail("data.json non e' JSON valido: %s" % e)
    import hashlib
    ver = hashlib.sha1(data.encode("utf-8")).hexdigest()[:10]   # i dati sono cambiati (data): cambia anche l'indirizzo
    html = html.replace("data.json?v=" + old.group(1), "data.json?v=" + ver)
    if re.search(r'(src|href)=["\']/(?!/)', html):
        log("ATTENZIONE: la pagina contiene path assoluti (/...): su Pages il sito sta sotto /agosto2027/")
    shutil.rmtree("_site", ignore_errors=True)
    os.makedirs("_site")
    with open("_site/index.html", "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    with open("_site/data.json", "w", encoding="utf-8", newline="\n") as f:
        f.write(data)
    if os.path.exists("world.json"):
        shutil.copyfile("world.json", "_site/world.json")      # contorno dei continenti per la pagina Mappa
    else:
        log("ATTENZIONE: manca world.json (python build_map.py): la mappa esce senza continenti")
    shutil.copytree("img", "_site/img")
    open("_site/.nojekyll", "w").close()
    log("OK-BUILD _site/index.html %d byte, data.json %d byte, img %d file" % (os.path.getsize("_site/index.html"), os.path.getsize("_site/data.json"), len(os.listdir("_site/img"))))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "scan":
        scan()
    elif stage == "build":
        build()
    elif stage == "fill":
        fill()
    elif stage == "retry":
        retry()
    elif stage == "meta":
        write_meta()
    else:
        sys.exit(__doc__)
