# -*- coding: utf-8 -*-
"""Scansione voli per i Popular trips. Riprendibile: una riga per query in trips_raw.jsonl, le query gia' fatte si saltano.

Multi-city: la pagina SSR di Google Flights (quella che legge gf.py) NON contiene i risultati multi-city
(ds:1 torna vuoto anche su rotte e date sicuramente in vendita), quindi gli open-jaw si ricavano sommando
due solo-andata: Milano->arrivo e ripartenza->Milano. Chiavi:
  OW|from|to|data|ms          solo-andata
  o|d|andata|ritorno|ms       A/R (stesso formato di raw.jsonl) solo per gli hub che raw.jsonl non ha
Fase A: ms=2 (superset). Fase B: ms=1 dove la A ha trovato voli. Fase C: ricontrollo unico dei vuoti (v=1), lento.
"""
import json, os, random, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from fast_flights import FlightQuery, Passengers, create_query
import gf, popular_trips, origins, dests

RAW, BASE = "trips_raw_v2.jsonl", "raw_v2.jsonl"
WORKERS = int(os.environ.get("WORKERS", "4"))
ORIGINS = origins.ORIGINS
DEPS = [(date(2027, 8, 6) + timedelta(days=i)).isoformat() for i in range(9)]
DURS = (10, 11, 12)
RETS = sorted({(date.fromisoformat(d) + timedelta(days=n)).isoformat() for d in DEPS for n in DURS})
lock = threading.Lock()
pause_until = [0.0]
streak = [0]
stats = {"ok": 0, "empty": 0, "fail": 0, "blocked": 0}

def load(path=RAW):
    done = {}
    if os.path.exists(path):
        for ln in open(path, encoding="utf-8"):
            try:
                r = json.loads(ln); done[r["k"]] = r
            except Exception:
                pass
    return done

def query(k):
    p = k.split("|")
    if p[0] == "OW":
        _, f, t, d, ms = p
        fl = [FlightQuery(date=d, from_airport=f, to_airport=t, max_stops=int(ms))]
        return create_query(flights=fl, trip="one-way", passengers=Passengers(adults=1), currency="EUR", language="it")
    o, d, dep, ret, ms = p
    fl = [FlightQuery(date=dep, from_airport=o, to_airport=d, max_stops=int(ms)), FlightQuery(date=ret, from_airport=d, to_airport=o, max_stops=int(ms))]
    return create_query(flights=fl, trip="round-trip", passengers=Passengers(adults=1), currency="EUR", language="it")

def tasks(ms):
    """Chiavi da interrogare a un dato max_stops (senza gli A/R gia' presenti in raw.jsonl)."""
    base_codes = {d["code"] for d in dests.DESTS}   # gli A/R delle destinazioni li fa scan.py (raw_v2.jsonl)
    ow, rt = set(), set()
    for t in popular_trips.TRIPS:
        for a in t["air"]:
            if a[0] == "oj":
                for o in ORIGINS:
                    for d in DEPS: ow.add("OW|%s|%s|%s|%d" % (o, a[1], d, ms))
                    for r in RETS: ow.add("OW|%s|%s|%s|%d" % (a[2], o, r, ms))
            elif a[1] not in base_codes:
                for o in ORIGINS:
                    for d in DEPS:
                        for n in DURS:
                            rt.add("%s|%s|%s|%s|%d" % (o, a[1], d, (date.fromisoformat(d) + timedelta(days=n)).isoformat(), ms))
    return sorted(ow) + sorted(rt)

def work(k, f, v=0, slow=False):
    w = pause_until[0] - time.time()
    if w > 0:
        time.sleep(w)
    time.sleep((0.5 + random.random()) if slow else random.random() * 0.5 + min(streak[0], 40) * 0.05)
    try:
        st, fl = gf.fetch(query(k), tries=2)
    except gf.Blocked:
        with lock:
            stats["blocked"] += 1
            pause_until[0] = time.time() + 90
        return
    except Exception:
        st, fl = "error", []
    if st not in ("ok", "empty"):
        with lock:
            stats["fail"] += 1
            pause_until[0] = max(pause_until[0], time.time() + 20)
        return
    with lock:
        stats[st] += 1
        streak[0] = 0 if st == "ok" else streak[0] + 1   # tante pagine vuote di fila -> si rallenta
        row = {"k": k, "st": st, "fl": fl}
        if v: row["v"] = v
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        f.flush()

def run(keys, label, workers=WORKERS, v=0, slow=False):
    for p in range(5):
        done = load()
        todo = [k for k in keys if k not in done] if not v else [k for k in keys if done.get(k, {}).get("st") == "empty" and done[k].get("v", 0) < v]
        if not todo:
            break
        random.shuffle(todo)
        print("%s pass %d: %d da fare su %d" % (label, p + 1, len(todo), len(keys)), flush=True)
        with open(RAW, "a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(work, k, f, v, slow) for k in todo]
            for i, _ in enumerate(as_completed(futs)):
                if (i + 1) % 200 == 0:
                    print("  %s %d/%d %s" % (label, i + 1, len(todo), stats), flush=True)
    print("%s finita %s" % (label, stats), flush=True)

if __name__ == "__main__":
    a = tasks(2)
    run(a, "A(ms2)")
    done = load()
    b = [k[:-1] + "1" for k in a if done.get(k, {}).get("st") == "ok"]
    run(b, "B(ms1)")
    run(a + b, "C(ricontrollo vuoti)", workers=2, v=1, slow=True)
    print("DONE", flush=True)
