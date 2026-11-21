# -*- coding: utf-8 -*-
"""Ricontrolla a bassa concorrenza le query 'empty' di raw_v2.jsonl (falsi vuoti da carico).
Riprendibile: ogni ricontrollo scrive una riga con v=numero di verifiche; si ferma a v>=TARGET.
  python verify.py [TARGET] [MODE]
  MODE ok   (default): vuoti delle coppie origine-destinazione che hanno almeno un risultato
  MODE none : coppie origine-destinazione senza nessun volo: si ricontrollano le 9 date con durata 11 (ms=2);
              se una si sblocca, rilanciare scan.py (fase B) e poi MODE ok per il resto."""
import json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import scan, gf
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 1
MODE = sys.argv[2] if len(sys.argv) > 2 else "ok"
lock = threading.Lock(); st_ = {"flip": 0, "still": 0, "fail": 0}
pause_until = [0.0]
def work(r, f):
    o, d, dep, ret, ms = r["k"].split("|")
    w = pause_until[0] - time.time()
    if w > 0: time.sleep(w)
    time.sleep(0.4 + random.random() * 0.8)
    try:
        st, fl = gf.fetch(scan.q(o, d, dep, ret, int(ms)), tries=2)
    except gf.Blocked:
        pause_until[0] = time.time() + 90; st = "error"
    except Exception:
        st = "error"
    with lock:
        if st == "ok":
            st_["flip"] += 1; f.write(json.dumps({"k": r["k"], "st": "ok", "fl": fl, "v": r.get("v", 0) + 1}, ensure_ascii=False, separators=(",", ":")) + "\n")
        elif st == "empty":
            st_["still"] += 1; f.write(json.dumps({"k": r["k"], "st": "empty", "fl": [], "v": r.get("v", 0) + 1}) + "\n")
        else:
            st_["fail"] += 1; pause_until[0] = max(pause_until[0], time.time() + 20)
        f.flush()
def todo_list():
    done = scan.load()
    okp = {tuple(k.split("|")[:2]) for k, r in done.items() if r["st"] == "ok"}
    if os.path.exists("raw.jsonl"):   # coppie che avevano voli nella scansione precedente: un vuoto di oggi e' sospetto
        for ln in open("raw.jsonl", encoding="utf-8"):
            try:
                r = json.loads(ln)
                if r["st"] == "ok": okp.add(tuple(r["k"].split("|")[:2]))
            except Exception:
                pass
    out = []
    for k, r in done.items():
        if r["st"] != "empty" or r.get("v", 0) >= TARGET: continue
        o, d, dep, ret, ms = k.split("|")
        if MODE == "ok" and (o, d) in okp: out.append(r)
        if MODE == "none" and (o, d) not in okp and ms == "2" and (scan.date.fromisoformat(ret) - scan.date.fromisoformat(dep)).days == 11: out.append(r)
    return out
if __name__ == "__main__":
    for p in range(3):
        todo = todo_list()
        if not todo: break
        random.shuffle(todo)
        print("verify", MODE, "target", TARGET, "pass", p + 1, "todo", len(todo), flush=True)
        with open(scan.RAW, "a", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", "3"))) as ex:
            for i, _ in enumerate(as_completed([ex.submit(work, r, f) for r in todo])):
                if (i + 1) % 200 == 0: print(" ", i + 1, st_, flush=True)
    print("VERIFY DONE", MODE, TARGET, st_, flush=True)
