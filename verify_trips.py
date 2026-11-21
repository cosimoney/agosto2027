# -*- coding: utf-8 -*-
"""Ricontrollo ulteriore dei vuoti di trips_raw_v2.jsonl sulle rotte che hanno gia' almeno un risultato (falsi vuoti da carico).
  python verify_trips.py TARGET   (scan_trips.py fa gia' il primo ricontrollo, v=1; qui TARGET = 2, 3...)
Dopo, rilanciare scan_trips.py per le fasi B mancanti."""
import collections, sys
import scan_trips as S
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 2
def route(k):
    p = k.split("|")
    return ("OW", p[1], p[2]) if p[0] == "OW" else ("RT", p[0], p[1])
if __name__ == "__main__":
    d = S.load()
    okr = {route(k) for k, r in d.items() if r["st"] == "ok"}
    keys = [k for k, r in d.items() if r["st"] == "empty" and route(k) in okr]
    S.run(keys, "V%d(vuoti su rotte con voli)" % TARGET, workers=int(S.os.environ.get("WORKERS", "1")), v=TARGET, slow=True)
