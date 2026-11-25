# -*- coding: utf-8 -*-
"""Ripresa mirata: rifa' SOLO le richieste rimaste senza voli nell'ultimo giro, con GetShoppingResults (gf.fetch_api) e
piu' tentativi. Parte dai file dell'ultimo giro gia' copiati nella cartella (pipeline.py retry li prende da prev/).

Cosa si richiede: le chiavi mancanti, in errore, o vuote ma viste solo dalla pagina (senza "src":"api"). Un vuoto gia'
confermato da GetShoppingResults non si richiede di nuovo, e una riga con voli non si tocca mai.

Ordine:
  a) tratte dei Popular trips: solo andata degli open-jaw e A/R sugli aeroporti fuori catalogo. Prima i trip senza
     nessun prezzo (per loro anche gli A/R sugli aeroporti in catalogo, che altrimenti arriverebbero solo in b / c),
     poi gli altri. Una data per rotta alla volta, partendo da quelle centrali, a ondate (1 data, poi 3, poi tutte):
     una rotta mai vista con voli e con 3 date confermate vuote da GetShoppingResults non si chiede oltre.
  b) A/R vero delle celle che hanno solo la stima (somma di due solo andata): per ogni coppia aeroporto-meta dalla
     cella stimata piu' economica in giu', un giro di coppie alla volta.
  c) coppie aeroporto-meta del tutto vuote: un solo andata di assaggio per direzione su una data non ancora provata
     (fino a 3 date per rotta); le rotte che rispondono si allargano a tutte le date (stima) e poi si chiede l'A/R vero.

Regole scali e formato delle righe sono quelli di estimate.py (work_ow / work_rt): una query a 2 scali per tratta,
max 1 scalo per tratta nel prezzo, 2 scali solo con sconto di almeno 25% e 150 euro pp; righe con "src":"api".

Variabili: RETRY_TRIES (tentativi per richiesta, default 6: l'attesa fra uno e l'altro cresce), RETRY_WORKERS (6),
RETRY_MAX_BLOCKS (ci si ferma dopo tanti 429 / captcha, default 8), RETRY_LIMIT (prove: tetto di richieste per fase),
EST_ONLY (prove: solo queste mete nelle fasi b e c), RETRY_ONLY_TRIPS (prove: solo questi trip nella fase a).

  python retry.py plan       cosa verrebbe richiesto con i file presenti (nessuna query)
  python retry.py run [MIN]  ripresa vera (di solito: python pipeline.py retry)
"""
import json, os, random, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import dests, estimate, origins, popular_trips

RAW, TRIPS_RAW = estimate.RAW, estimate.TRIPS_RAW
ORIGINS, DEPS, plus = origins.ORIGINS, estimate.DEPS, estimate.plus
RETS = sorted({plus(d, n) for d in DEPS for n in (10, 11, 12)})
BASE = {D["code"]: D for D in dests.DESTS}
TRIES = int(os.environ.get("RETRY_TRIES") or 6)
WORKERS = int(os.environ.get("RETRY_WORKERS") or 6)
MAX_BLOCKS = int(os.environ.get("RETRY_MAX_BLOCKS") or 8)
LIMIT = int(os.environ.get("RETRY_LIMIT") or 0)
ONLY_TRIPS = set(filter(None, (os.environ.get("RETRY_ONLY_TRIPS") or "").split(",")))
SHARE_A, SHARE_B = 0.4, 0.6      # quota del tempo per i trip; poi, di quello che resta, quota per gli A/R delle stime
MAX_PROBE = 3                    # date di assaggio per una rotta mai vista con voli


def need(rows, k):
    """Chiave da richiedere: mancante, in errore, o vuota ma non confermata da GetShoppingResults."""
    r = rows.get(k)
    return r is None or (r.get("st") != "ok" and r.get("src") != "api")


def mid(seq):
    """Dalla data centrale verso i bordi."""
    seq = list(seq)
    return sorted(seq, key=lambda x: abs(seq.index(x) - len(seq) // 2))


def rtk(c):
    return "%s|%s|%s|%s|2" % tuple(c)


def rows_for(c, raw, trips):
    """Gli A/R sugli aeroporti in catalogo stanno in raw_v2.jsonl, gli altri in trips_raw_v2.jsonl."""
    return raw if c[1] in BASE else trips


# ---------------------------------------------------------------- piano (nessuna query)

def dead_routes(*rows):
    """Rotte ("OW", da, a) o (aeroporto, hub) mai viste con voli e con almeno MAX_PROBE date confermate vuote da
    GetShoppingResults: non si chiedono oltre."""
    n, ok = {}, set()
    for d in rows:
        for k, r in d.items():
            p = k.split("|")
            if p[-1] != "2":
                continue
            route = tuple(p[:3]) if p[0] == "OW" else tuple(p[:2])
            if r.get("st") == "ok":
                ok.add(route)
            elif r.get("src") == "api":
                n[route] = n.get(route, 0) + 1
    return {r for r, c in n.items() if c >= MAX_PROBE and r not in ok}


def trip_tasks(t, raw, trips, catalog_rt, dead=()):
    """Richieste ancora da fare per un trip -> [(giro, task)]; task = ("ow", chiave) | ("rt", (o, hub, andata, ritorno))."""
    out = []
    for a in t["air"]:
        if a[0] == "oj":
            for o in ORIGINS:
                out += [(i, ("ow", "OW|%s|%s|%s|2" % (o, a[1], d))) for i, d in enumerate(mid(DEPS))]
                out += [(i, ("ow", "OW|%s|%s|%s|2" % (a[2], o, r))) for i, r in enumerate(mid(RETS))]
        elif a[1] not in BASE or catalog_rt:
            durs = estimate.durs(BASE[a[1]]) if a[1] in BASE else (10, 11, 12)
            cells = [(dep, n) for n in (11, 10, 12) if n in durs for dep in mid(DEPS)]
            for o in ORIGINS:
                out += [(i, ("rt", (o, a[1], dep, plus(dep, n)))) for i, (dep, n) in enumerate(cells)]
    route = lambda x: tuple(x[1].split("|")[:3]) if x[0] == "ow" else x[1][:2]
    return [(i, x) for i, x in out if route(x) not in dead
            and (need(trips, x[1]) if x[0] == "ow" else need(rows_for(x[1], raw, trips), rtk(x[1])))]


def plan_trips(raw, trips, priced, ranks=99):
    """Fase a. priced = id dei trip che hanno gia' un prezzo; ranks = quante date per rotta (le piu' centrali).
    -> (task dei trip senza prezzo, task degli altri)."""
    first, rest, dead = [], [], dead_routes(raw, trips)
    for t in popular_trips.TRIPS:
        if ONLY_TRIPS and t["id"] not in ONLY_TRIPS:
            continue
        no_price = t["id"] not in priced
        (first if no_price else rest).extend(x for x in trip_tasks(t, raw, trips, no_price, dead) if x[0] < ranks)
    seen, out = set(), []
    for part in (first, rest):
        part.sort(key=lambda x: (x[0], x[1][0] == "rt", random.random()))   # un giro di date alla volta, prima i solo andata
        got = [x for _, x in part if not (x in seen or seen.add(x))]
        out.append(got)
    return out[0], out[1]


def plan_cells(raw, ow):
    """Fase b: celle con la sola stima da chiedere come A/R vero. Per ogni coppia aeroporto-meta dalla piu' economica
    in giu': prima la migliore di ogni coppia, poi la seconda di ognuna, e cosi' via (dentro ogni giro dalla meno cara)."""
    by = {}
    for e in estimate.combos(raw, ow):
        c = (e["o"], e["d"], e["dep"], e["ret"])
        if (estimate.ONLY and e["d"] not in estimate.ONLY) or not need(raw, rtk(c)):
            continue
        by.setdefault(c[:2], []).append((estimate.price(e) or e["x"], c))
    out = [(i, p, c) for cells in by.values() for i, (p, c) in enumerate(sorted(cells))]
    return [("rt", c) for _, _, c in sorted(out)]


def plan_dead(raw, ow):
    """Fase c: coppie senza nessun A/R. -> (assaggi, tutte le date). Una rotta mai vista con voli si assaggia su una
    data alla volta fra le MAX_PROBE piu' centrali (quelle gia' confermate vuote non si richiedono); le coppie con
    tutte e due le rotte vive si allargano a tutte le date."""
    alive = estimate.ok_routes(ow)
    probe, full = [], []
    for o, D in estimate.dead_pairs(raw):
        c = D["code"]
        legs = (((o, c), DEPS), ((c, o), estimate.rets(D)))
        if all(r in alive for r, _ in legs):
            full += ["OW|%s|%s|%s|2" % (r + (d,)) for r, days in legs for d in days]
            continue
        for r, days in legs:
            if r not in alive:
                probe += [k for k in ["OW|%s|%s|%s|2" % (r + (d,)) for d in mid(days)[:MAX_PROBE]] if need(ow, k)][:1]
    one = lambda ks: [("ow", k) for k in dict.fromkeys(ks) if need(ow, k)]
    return one(probe), one(full)


def state(raw, ow):
    """Per meta e per coppia aeroporto-meta: "vero" (almeno un A/R con voli), "stima" (solo somma di due solo andata
    che rispetta la regola scali), "vuota"."""
    real = {tuple(k.split("|")[:2]) for k, r in raw.items() if r.get("st") == "ok" and not k.startswith("OW|")}
    est = {(e["o"], e["d"]) for e in estimate.combos(raw, ow) if estimate.price(e)}
    kind = lambda ps: "vero" if any(p in real for p in ps) else "stima" if any(p in est for p in ps) else "vuota"
    return ({c: kind([(o, c) for o in ORIGINS]) for c in BASE}, {"%s-%s" % (o, c): kind([(o, c)]) for c in BASE for o in ORIGINS})


def count(d):
    out = {"vero": 0, "stima": 0, "vuota": 0}
    for v in d.values():
        out[v] += 1
    return out


def trip_best():
    """{id del trip: miglior offerta | None} con i file presenti: build_trips.py su una copia, senza toccare trips_data.json."""
    fd, tmp = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        subprocess.run([sys.executable, "build_trips.py"], env=dict(os.environ, RAW=RAW, TRIPS_RAW=TRIPS_RAW, TRIPS_OUT=tmp),
                       stdout=subprocess.DEVNULL, check=True, timeout=600)
        return {t["id"]: t["best"] for t in json.load(open(tmp, encoding="utf-8"))["trips"]}
    except Exception as e:      # senza elenco tutti i trip contano come "senza prezzo": cambia solo l'ordine
        print("ATTENZIONE: build_trips.py non ha risposto (%s): trip trattati tutti come senza prezzo" % type(e).__name__, flush=True)
        return {t["id"]: None for t in popular_trips.TRIPS}
    finally:
        os.remove(tmp)


# ---------------------------------------------------------------- query

def stopped():
    return estimate.stats["blocked"] > estimate.MAX_BLOCKED


def run_tasks(tasks, deadline, label):
    """Esegue i task nell'ordine dato (estimate.work_ow / work_rt: stesse regole, stesse righe). -> task non saltati."""
    if LIMIT:
        tasks = tasks[:LIMIT]
    if not tasks:
        return 0
    t0, before = time.time(), dict(estimate.stats)
    with open(RAW, "a", encoding="utf-8") as fr, open(TRIPS_RAW, "a", encoding="utf-8") as ft, ThreadPoolExecutor(max_workers=WORKERS) as ex:
        def one(x):
            if x[0] == "ow":
                return estimate.work_ow(x[1], ft, deadline, TRIES)
            return estimate.work_rt(x[1], fr if x[1][1] in BASE else ft, deadline)
        futs = [ex.submit(one, x) for x in tasks]
        for i, _ in enumerate(as_completed(futs)):
            if (i + 1) % 250 == 0:
                print("  %s %d/%d %s" % (label, i + 1, len(tasks), estimate.stats), flush=True)
    d = {k: estimate.stats[k] - before[k] for k in estimate.stats}
    print("%s: %d in %.1f min %s" % (label, len(tasks), (time.time() - t0) / 60, d), flush=True)
    return len(tasks) - d["skipped"]


def passes(plan, deadline, label, n=2):
    """Piano -> richieste, fino a n volte: dalla seconda restano solo gli errori (e, per gli assaggi, la data dopo).
    -> (task del primo piano, task eseguiti)."""
    total = done = 0
    for i in range(n):
        tasks = plan()
        if i == 0:
            total = len(tasks)
        if not tasks or time.time() > deadline or stopped():
            break
        done += run_tasks(tasks, deadline, "%s (%d)" % (label, i + 1))
    return total, done


def compact(path, prev):
    """Una riga per chiave. Una riga che aveva voli non viene mai sostituita da una senza."""
    rows = {}
    with open(path, encoding="utf-8") as f:
        for ln in f:
            try:
                r = json.loads(ln)
            except Exception:
                continue
            if not (rows.get(r["k"], {}).get("st") == "ok" and r.get("st") != "ok"):
                rows[r["k"]] = r
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows.values():
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    return sum(1 for k, r in rows.items() if r.get("st") == "ok" and prev.get(k, {}).get("st") != "ok")


def run(budget_min=150):
    """-> riepilogo per scan_meta.json (blocco "retry")."""
    estimate.MAX_BLOCKED, estimate.RT_TRIES = MAX_BLOCKS - 1, TRIES
    t0 = time.time()
    end = t0 + budget_min * 60
    load = lambda: (estimate.load(RAW), estimate.load(TRIPS_RAW))
    raw0, ow0 = load()
    dest0, pair0 = state(raw0, ow0)
    best0 = trip_best()
    priced = {i for i, b in best0.items() if b}
    res = {"tries": TRIES, "budget_min": budget_min}

    a1, a2 = plan_trips(raw0, ow0, priced)
    res.update({"trip_tasks": len(a1) + len(a2), "trip_tasks_no_price": len(a1), "trip_done": 0})
    for ranks in (1, 3, 99):          # a ondate: le rotte che non rispondono su 3 date escono dal piano
        res["trip_done"] += passes(lambda: sum(plan_trips(*load(), priced, ranks), []), t0 + budget_min * 60 * SHARE_A,
                                   "ripresa a: tratte dei popular trips, %s" % ("%d date per rotta" % ranks if ranks < 99 else "tutte le date"))[1]
    res["cell_tasks"], res["cell_done"] = passes(lambda: plan_cells(*load()), time.time() + (end - time.time()) * SHARE_B, "ripresa b: A/R veri delle celle stimate")
    res["probe_tasks"], res["probe_done"] = passes(lambda: plan_dead(*load())[0], end, "ripresa c: assaggio delle coppie vuote", MAX_PROBE)
    res["full_tasks"], res["full_done"] = passes(lambda: plan_dead(*load())[1], end, "ripresa c: solo andata delle rotte vive")
    res["cell2_tasks"], res["cell2_done"] = passes(lambda: plan_cells(*load()), end, "ripresa c: A/R veri delle celle stimate rimaste", 1)

    res["new_ok"] = compact(RAW, raw0) + compact(TRIPS_RAW, ow0)
    raw1, ow1 = load()
    dest1, pair1 = state(raw1, ow1)
    best1 = trip_best()
    res["dests"] = {"prima": count(dest0), "dopo": count(dest1)}
    res["pairs"] = {"prima": count(pair0), "dopo": count(pair1)}
    res["trips"] = {"prima": len(priced), "dopo": sum(1 for b in best1.values() if b), "totale": len(best1)}
    res["unlocked_trips"] = sorted(i for i, b in best1.items() if b and i not in priced)
    res["unlocked_dests"] = sorted("%s:%s>%s" % (c, dest0[c], v) for c, v in dest1.items() if v != dest0[c])
    res["stopped"] = stopped()
    res["minutes"] = round((time.time() - t0) / 60, 1)
    res.update(estimate.stats)
    import gf
    res["api"] = dict(gf.api_stats)
    for i in res["unlocked_trips"]:
        b = best1[i]
        print("SBLOCCATO trip %s: %s %s -> %s (%d giorni), %s %s, voli %d euro pp" % (i, b["o"], b["dep"], b["ret"], b["n"], b["kind"], b["hub"], b["voli"]), flush=True)
    return res


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "plan":
        raw, ow = estimate.load(RAW), estimate.load(TRIPS_RAW)
        best = trip_best()
        priced = {i for i, b in best.items() if b}
        a1, a2 = plan_trips(raw, ow, priced)
        cells, (probe, full) = plan_cells(raw, ow), plan_dead(raw, ow)
        kinds = lambda ts: "%d (%d solo andata, %d A/R)" % (len(ts), sum(x[0] == "ow" for x in ts), sum(x[0] == "rt" for x in ts))
        print("trip con prezzo: %d su %d | senza: %s" % (len(priced), len(best), ", ".join(sorted(set(best) - priced))))
        print("a) trip senza prezzo:", kinds(a1), "| altri trip:", kinds(a2))
        print("b) celle con la sola stima:", len(cells), "in", len({x[1][:2] for x in cells}), "coppie | prime:", [x[1] for x in cells[:5]])
        print("c) assaggi:", len(probe), "| solo andata delle rotte vive:", len(full))
        d, p = state(raw, ow)
        print("mete:", count(d), "| coppie aeroporto-meta:", count(p))
    elif cmd == "run":
        print("RIPRESA", json.dumps(run(float(sys.argv[2]) if len(sys.argv) > 2 else 150), ensure_ascii=False))
    else:
        sys.exit(__doc__)
