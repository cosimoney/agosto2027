# -*- coding: utf-8 -*-
"""Scansione agosto 2027. Riprendibile: i risultati vanno in raw.jsonl (una riga per query), le query gia' fatte si saltano.
Fase A: max_stops=2 (superset). Fase B: max_stops=1 solo dove la A ha trovato voli."""
import json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from fast_flights import FlightQuery, Passengers, create_query
import gf, dests, origins

RAW = os.environ.get("RAW", "raw_v2.jsonl")
WORKERS = int(os.environ.get("WORKERS", "4"))
ORIGINS = origins.ORIGINS
DEPS = [date(2027, 8, 6) + timedelta(days=i) for i in range(9)]
lock = threading.Lock()
pause_until = [0.0]
streak = [0]
stats = {"ok": 0, "empty": 0, "fail": 0, "blocked": 0}

def q(o, d, dep, ret, ms):
    fl = [FlightQuery(date=dep, from_airport=o, to_airport=d, max_stops=ms), FlightQuery(date=ret, from_airport=d, to_airport=o, max_stops=ms)]
    return create_query(flights=fl, trip="round-trip", passengers=Passengers(adults=1), currency="EUR", language="it")

def load():
    done = {}
    if os.path.exists(RAW):
        for ln in open(RAW, encoding="utf-8"):
            try:
                r = json.loads(ln)
                done[r["k"]] = r
            except Exception:
                pass
    return done

def combos():
    out = []
    for D in dests.DESTS:
        durs = (10, 11, 12) if D["scan"] == "full" else (11,)
        for o in ORIGINS:
            for dep in DEPS:
                for n in durs:
                    out.append((o, D["code"], dep.isoformat(), (dep + timedelta(days=n)).isoformat()))
    return out

def work(t, f):
    o, d, dep, ret, ms = t
    k = "%s|%s|%s|%s|%d" % t
    w = pause_until[0] - time.time()
    if w > 0:
        time.sleep(w)
    time.sleep(random.random() * 0.5 + min(streak[0], 40) * 0.03)
    try:
        st, fl = gf.fetch(q(o, d, dep, ret, ms), tries=2)
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
            pause_until[0] = max(pause_until[0], time.time() + 20)   # errori h2 "excessive load": tutti i thread rallentano
        return
    with lock:
        stats[st] += 1
        streak[0] = 0 if st == "ok" else streak[0] + 1   # tante pagine vuote di fila -> si rallenta
        f.write(json.dumps({"k": k, "st": st, "fl": fl}, ensure_ascii=False, separators=(",", ":")) + "\n")
        f.flush()

def run(tasks, label):
    for p in range(5):
        done = load()
        todo = [t for t in tasks if "%s|%s|%s|%s|%d" % t not in done]
        if not todo:
            break
        random.shuffle(todo)
        print("%s pass %d: %d da fare (%d gia' fatte)" % (label, p + 1, len(todo), len(tasks) - len(todo)), flush=True)
        with open(RAW, "a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(work, t, f) for t in todo]
            for i, _ in enumerate(as_completed(futs)):
                if (i + 1) % 250 == 0:
                    print("  %s %d/%d %s" % (label, i + 1, len(todo), stats), flush=True)
    print("%s finita %s" % (label, stats), flush=True)

if __name__ == "__main__":
    cs = combos()
    run([c + (2,) for c in cs], "A(ms2)")
    done = load()
    b = [c + (1,) for c in cs if done.get("%s|%s|%s|%s|2" % c, {}).get("st") == "ok"]
    run(b, "B(ms1)")
    print("DONE", flush=True)
