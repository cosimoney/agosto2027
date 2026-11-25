# -*- coding: utf-8 -*-
"""trips_data.json -> worker/src/trip_costs.json: {"t_<id>": [a terra min, a terra max, voli interni, notti]} per persona.
Ripiego del comando /voti quando lo snapshot non porta ancora questi campi (di norma li scrive bot/snapshot.py).
Uso, dalla radice del repo dopo un build:  python worker/trip_costs.py   e poi  npx wrangler deploy  dalla cartella worker."""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
trips = json.load(open(os.path.join(ROOT, "trips_data.json"), encoding="utf-8"))["trips"]
out = {"t_" + t["id"]: [int(t["land"][0]), int(t["land"][1]), int(t.get("itot") or 0), int(t["nights"])]
       for t in trips if re.fullmatch(r"[a-z0-9-]{2,58}", str(t["id"]))}
with open(os.path.join(ROOT, "worker", "src", "trip_costs.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
print(len(out), "giri")
