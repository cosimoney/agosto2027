# -*- coding: utf-8 -*-
"""Ripiego per le mete che restano senza A/R: stima = miglior solo andata Italia->meta + miglior solo andata meta->Italia.

Perche': la pagina di Google Flights che legge gf.py contiene solo i risultati gia' pronti lato server. Sulle rotte meno
cercate arriva valida ma senza voli, e il browser li carica dopo con GetShoppingResults. Qui si interroga quella stessa
chiamata (gf.fetch_api), che per i solo andata risponde in 1-3 secondi; per gli A/R di lungo raggio invece va spesso in
errore e va riprovata, percio' l'A/R vero si chiede cella per cella partendo dalle piu' economiche di ogni meta, finche'
c'e' tempo (fase "refine"): dove arriva sostituisce la stima, e pipeline.py lo tiene anche per il giro dopo.

Query: l'andata dipende solo dalla data di partenza e il ritorno solo dalla data di rientro, quindi per una coppia
aeroporto-meta bastano 9 andate + 9 o 11 ritorni (non 27 combinazioni), con una sola query a 2 scali per tratta: la
risposta porta gli scali veri di ogni volo. Si cercano SOLO le coppie senza nessun A/R; una rotta mai vista con voli si
assaggia prima su una data sola (probe) e si allarga a tutte le date solo se risponde.

Dati: righe "OW|da|a|data|2" in trips_raw_v2.jsonl (stesso formato e stesso file dei solo andata dei popular trips, che
cosi' si riusano), con "src":"api". Gli A/R veri della fase refine vanno in raw_v2.jsonl con la chiave solita.

Regola scali come nel resto del sito, applicata a ciascuna tratta: max 1 scalo; 2 scali solo se la somma costa almeno
il 25% e almeno 150 euro pp in meno della migliore somma con max 1 scalo.

  python estimate.py show [IATA]     stime calcolabili dai file presenti (nessuna query)
  python estimate.py run [MINUTI]    cerca i solo andata mancanti e rifinisce le celle migliori (query vere)
"""
import json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
import dests, origins

RAW, TRIPS_RAW = os.environ.get("RAW", "raw_v2.jsonl"), os.environ.get("TRIPS_RAW", "trips_raw_v2.jsonl")
ONLY = set(filter(None, (os.environ.get("EST_ONLY") or "").split(",")))   # prove: solo queste mete (codici IATA)
MIN_PCT, MIN_EUR = 0.25, 150
ORIGINS = origins.ORIGINS
DEPS = [(date(2027, 8, 6) + timedelta(days=i)).isoformat() for i in range(9)]
PROBE_DEP = DEPS[4]
WORKERS = int(os.environ.get("EST_WORKERS") or 6)
TRIES = int(os.environ.get("EST_TRIES") or 4)          # un errore di GetShoppingResults e' casuale (circa 1 su 2): si riprova subito
RT_TRIES = int(os.environ.get("EST_RT_TRIES") or 4)    # A/R: stessi errori casuali, ma un errore puo' costare 20 secondi
OW_SHARE = float(os.environ.get("EST_OW_SHARE") or 0.45)   # quota del tempo per i solo andata; il resto va agli A/R veri
MAX_BLOCKED = 20
NOTE = "stima: somma di due solo andata"
lock = threading.Lock()
pause_until = [0.0]
stats = {"ok": 0, "empty": 0, "error": 0, "blocked": 0, "skipped": 0}


def plus(d, n):
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def durs(D):
    return (10, 11, 12) if D.get("scan") == "full" else (11,)


def rets(D):
    return sorted({plus(d, n) for d in DEPS for n in durs(D)})


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


def has_rt(raw, o, code, dep, ret):
    return (raw.get("%s|%s|%s|%s|2" % (o, code, dep, ret)) or {}).get("st") == "ok"


def dead_pairs(raw):
    """Coppie (aeroporto, meta) senza nessun A/R con voli."""
    alive = {tuple(k.split("|")[:2]) for k, r in raw.items() if r.get("st") == "ok" and not k.startswith("OW|")}
    return [(o, D) for D in dests.DESTS for o in ORIGINS if (o, D["code"]) not in alive and (not ONLY or D["code"] in ONLY)]


def ok_routes(*rows):
    """Rotte solo andata (da, a) con almeno una riga con voli."""
    out = set()
    for d in rows:
        for k, r in d.items():
            if k.startswith("OW|") and r.get("st") == "ok":
                p = k.split("|"); out.add((p[1], p[2]))
    return out


def plan(raw, ow, known=()):
    """-> (probe, full): chiavi solo andata delle coppie senza A/R. full = tutte le date delle coppie con le due rotte
    gia' viste con voli (oggi o nel giro prima: `known`); probe = una data per rotta, per le rotte mai viste con voli."""
    alive = ok_routes(ow) | set(known)
    probe, full = [], []
    for o, D in dead_pairs(raw):
        c = D["code"]
        r = rets(D)
        a, b = (o, c) in alive, (c, o) in alive
        if a and b:
            full += ["OW|%s|%s|%s|2" % (o, c, d) for d in DEPS] + ["OW|%s|%s|%s|2" % (c, o, d) for d in r]
        else:
            if not a: probe.append("OW|%s|%s|%s|2" % (o, c, PROBE_DEP))
            if not b: probe.append("OW|%s|%s|%s|2" % (c, o, r[len(r) // 2]))
    return probe, full


def todo(keys, rows):
    """Chiavi ancora da chiedere: mancanti, oppure vuote ma viste solo dalla pagina (non confermate da GetShoppingResults)."""
    return [k for k in dict.fromkeys(keys) if k not in rows or (rows[k].get("st") != "ok" and rows[k].get("src") != "api")]


# ---------------------------------------------------------------- stime (nessuna query)

def _pool(ow, f, t, day, cache):
    k = (f, t, day)
    if k not in cache:
        fl = {}
        for ms in (2, 1):
            for x in (ow.get("OW|%s|%s|%s|%d" % (f, t, day, ms)) or {}).get("fl") or []:
                fl[(x["price"], tuple((s["f"], s["t"], s["dt"]) for s in x["segs"]))] = x
        v = sorted(fl.values(), key=lambda x: (x["price"], x.get("dur") or 0))
        cache[k] = ([x for x in v if len(x["segs"]) - 1 <= 1], [x for x in v if len(x["segs"]) - 1 == 2])
    return cache[k]


def combos(raw, ow, dlist=None):
    """Celle (aeroporto, meta, andata, durata) senza A/R con voli ma con i due solo andata.
    -> [{"o","d","dep","ret","n","a": (andata, ritorno) | None, "b": (andata, ritorno) | None, "x": prezzo | None}]
    a = miglior somma con max 1 scalo per tratta; b = somma con 2 scali in almeno una tratta che rispetta la regola;
    x = prezzo della somma con 2 scali quando non la rispetta (o quando manca a).
    dlist = elenco delle mete (default dests.DESTS)."""
    out, cache = [], {}
    tot = lambda p: p[0]["price"] + p[1]["price"]
    for D in (dests.DESTS if dlist is None else dlist):
        c = D["code"]
        for o in ORIGINS:
            for dep in DEPS:
                o1, o2 = _pool(ow, o, c, dep, cache)
                if not (o1 or o2):
                    continue
                for n in durs(D):
                    ret = plus(dep, n)
                    if has_rt(raw, o, c, dep, ret):
                        continue
                    b1, b2 = _pool(ow, c, o, ret, cache)
                    one = (o1[0], b1[0]) if o1 and b1 else None
                    cand = []
                    if o2 and (b1 or b2): cand.append((o2[0], min(b1[:1] + b2[:1], key=lambda f: f["price"])))
                    if b2 and o1: cand.append((o1[0], b2[0]))
                    two = min(cand, key=tot) if cand else None
                    if not one and not two:
                        continue
                    b = x = None
                    if two:
                        if one and tot(one) - tot(two) >= MIN_EUR and (tot(one) - tot(two)) / tot(one) >= MIN_PCT:
                            b = two
                        else:
                            x = tot(two)
                    out.append({"o": o, "d": c, "dep": dep, "ret": ret, "n": n, "a": one, "b": b, "x": x})
    return out


def price(e):
    """Prezzo pp della stima secondo la regola scali (None se esiste solo con 2 scali)."""
    p = e["b"] or e["a"]
    return p[0]["price"] + p[1]["price"] if p else None


def refine_tasks(raw, ow, skip=()):
    """Celle stimate da chiedere come A/R vero, in ordine: prima la piu' economica di ogni meta e gruppo di aeroporti,
    poi la seconda di ognuna, e cosi' via (dentro ogni giro dalla meno cara). Il tetto di tempo taglia la coda.
    skip = chiavi A/R ("o|d|andata|ritorno|2") che hanno gia' un prezzo vero del giro prima: vanno in fondo."""
    by = {}
    for e in combos(raw, ow):
        if ONLY and e["d"] not in ONLY:
            continue
        by.setdefault((e["d"], origins.GROUP[e["o"]]), []).append((price(e) or e["x"], e["o"], e["d"], e["dep"], e["ret"]))
    out = []
    for cells in by.values():
        for i, c in enumerate(sorted(cells)):
            out.append(("%s|%s|%s|%s|2" % c[1:] in skip, i, c))
    return [c[1:] for _, _, c in sorted(out)]


# ---------------------------------------------------------------- query

def _wait():
    w = pause_until[0] - time.time()
    if w > 0:
        time.sleep(w)
    time.sleep(random.random() * 0.4)


def _blocked():
    with lock:
        stats["blocked"] += 1
        pause_until[0] = time.time() + 90


def _write(f, k, st, fl):
    with lock:
        stats[st] += 1
        f.write(json.dumps({"k": k, "st": st, "fl": fl, "src": "api"}, ensure_ascii=False, separators=(",", ":")) + "\n")
        f.flush()


def work_ow(k, f, deadline, tries):
    import gf
    if time.time() > deadline or stats["blocked"] > MAX_BLOCKED:
        with lock: stats["skipped"] += 1
        return
    _wait()
    _, a, b, day, ms = k.split("|")
    try:
        st, fl = gf.fetch_api(a, b, day, None, int(ms), tries=tries)
    except gf.Blocked:
        return _blocked()
    except Exception:
        st, fl = "error", []
    if st == "error":
        with lock: stats["error"] += 1
        return
    _write(f, k, st, fl)


def work_rt(t, f, deadline):
    """A/R vero di una cella stimata: 2 scali, poi 1 scalo se fra i voli ce n'e' almeno uno con andata a max 1 scalo."""
    import gf
    if time.time() > deadline or stats["blocked"] > MAX_BLOCKED:
        with lock: stats["skipped"] += 1
        return
    _wait()
    o, d, dep, ret = t
    try:
        st, fl = gf.fetch_api(o, d, dep, ret, 2, tries=RT_TRIES)
        if st == "error":
            with lock: stats["error"] += 1
            return
        if st == "ok" and any(len(x["segs"]) - 1 <= 1 for x in fl):
            st1, fl1 = gf.fetch_api(o, d, dep, ret, 1, tries=RT_TRIES + 1)
            if st1 == "error":      # senza la query a 1 scalo la cella sarebbe "solo 2 scali": meglio tenere la stima
                with lock: stats["error"] += 1
                return
            _write(f, "%s|%s|%s|%s|1" % t, st1, fl1)
        _write(f, "%s|%s|%s|%s|2" % t, st, fl)
    except gf.Blocked:
        _blocked()
    except Exception:
        with lock: stats["error"] += 1


def _pool_run(fn, tasks, path, label, workers):
    if not tasks:
        return
    t0, before = time.time(), dict(stats)
    with open(path, "a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(fn, t, f) for t in tasks]
        for i, _ in enumerate(as_completed(futs)):
            if (i + 1) % 500 == 0:
                print("  %s %d/%d %s" % (label, i + 1, len(tasks), stats), flush=True)
    print("%s: %d in %.1f min %s" % (label, len(tasks), (time.time() - t0) / 60, {k: stats[k] - before[k] for k in stats}), flush=True)


def run(budget_min=75, known=(), first=(), skip=(), raw_path=RAW, ow_path=TRIPS_RAW, workers=WORKERS):
    """Cerca i solo andata delle coppie senza A/R (OW_SHARE del tempo), poi chiede l'A/R vero delle celle stimate, dalle
    piu' economiche, finche' c'e' tempo: dove arriva, l'A/R vero sostituisce la stima.
    known = rotte (da, a) viste con voli nel giro prima; first = chiavi da fare per prime (non rifatte al giro prima);
    skip = celle con un A/R vero del giro prima (si rifanno per ultime: se non si arriva restano quelle).
    -> {"keys": chiavi solo andata volute, "probe", "full", "refine": celle chieste come A/R, "minutes", **stats}"""
    t0 = time.time()
    end_ow, end = t0 + budget_min * 60 * OW_SHARE, t0 + budget_min * 60
    first = set(first)
    order = lambda ks: sorted(ks, key=lambda k: (k not in first, random.random()))
    raw, ow = load(raw_path), load(ow_path)
    probe, full = plan(raw, ow, known)
    wanted = set(probe) | set(full)
    n_probe = len(todo(probe, ow))
    _pool_run(lambda k, f: work_ow(k, f, end_ow, TRIES + 2), order(todo(probe, ow)), ow_path, "stime: assaggio rotte", workers)
    ow = load(ow_path)
    probe2, full = plan(raw, ow, known)          # le rotte che hanno risposto si allargano a tutte le date
    wanted |= set(full)
    n_full = len(todo(full, ow))
    for i in (1, 2):                             # secondo passaggio solo per gli errori del primo
        _pool_run(lambda k, f: work_ow(k, f, end_ow, TRIES), order(todo(full, ow)), ow_path, "stime: solo andata (%d)" % i, workers)
        ow = load(ow_path)
    tasks = refine_tasks(raw, ow, skip)
    before = stats["skipped"]
    _pool_run(lambda t, f: work_rt(t, f, end), tasks, raw_path, "A/R veri delle celle stimate", workers)
    now = load(raw_path)
    rt = ["%s|%s|%s|%s|2" % t for t in tasks]
    out = {"keys": sorted(wanted), "rt_keys": rt, "probe": n_probe, "full": n_full, "refine": len(tasks) - (stats["skipped"] - before),
           "rt_ok": sum(1 for k in rt if now.get(k, {}).get("st") == "ok" and now[k].get("src") == "api"), "minutes": round((time.time() - t0) / 60, 1)}
    out.update(stats)
    return out


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "show":
        raw, ow = load(RAW), load(TRIPS_RAW)
        only = sys.argv[2] if len(sys.argv) > 2 else None
        best = {}
        for e in combos(raw, ow):
            p = price(e)
            if p and (not only or e["d"] == only) and (e["d"] not in best or p < best[e["d"]][0]):
                best[e["d"]] = (p, e)
        for c, (p, e) in sorted(best.items(), key=lambda x: x[1][0]):
            a, b = e["b"] or e["a"]
            print("%s %5d pp  %s %s->%s %dg  andata %d (%s, %d scali) + ritorno %d (%s, %d scali)" % (
                c, p, e["o"], e["dep"][5:], e["ret"][5:], e["n"], a["price"], "+".join(a["al"]), len(a["segs"]) - 1, b["price"], "+".join(b["al"]), len(b["segs"]) - 1))
        probe, full = plan(raw, ow)
        print("mete con stima: %d | coppie senza A/R: %d | da assaggiare: %d | solo andata delle rotte vive: %d (mancanti %d)" % (
            len(best), len(dead_pairs(raw)), len(todo(probe, ow)), len(full), len(todo(full, ow))))
    elif cmd == "run":
        res = run(float(sys.argv[2]) if len(sys.argv) > 2 else 65)
        print({k: v for k, v in res.items() if k not in ("keys", "rt_keys")}, "| chiavi:", len(res["keys"]))
    else:
        sys.exit(__doc__)
