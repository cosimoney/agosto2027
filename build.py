# -*- coding: utf-8 -*-
"""raw_v2.jsonl -> agosto-2027.html (dati inline nel template). Origini: origins.py (LIN, MXP, FCO, PSA).
Solo prezzi dei voli: nessun costo di posizionamento verso Roma o Pisa.
Variabili d'ambiente facoltative (per rigenerare una copia da altri dati): RAW, TPL, OUT."""
import json, os, sys
from datetime import date
import dests
import itineraries
import origins

MIN_PCT, MIN_EUR = 0.25, 150
raw = {}
for ln in open(os.environ.get("RAW", "raw_v2.jsonl"), encoding="utf-8"):
    try:
        r = json.loads(ln); raw[r["k"]] = r
    except Exception:
        pass

def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days

def sig(f):
    return (f["price"], tuple((s["f"], s["t"], s["dt"]) for s in f["segs"]))

def compact(f):
    s = f["segs"]
    lay = []
    for i in range(len(s) - 1):
        lay.append(s[i]["t"])
    return [f["price"], " + ".join(f["al"]) or "n.d.", f["dur"], len(s) - 1, s[0]["dt"], s[-1]["at"], days(s[0]["dd"], s[-1]["ad"]), "·".join(lay), s[0]["f"], s[-1]["t"]]

OVR = {"LAS": {"g": "accettabile", "flag": "deserto rovente: solo in quota"}, "OKA": {"flag": "rischio tifoni"}}
D = []
for d in dests.DESTS:
    d = dict(d); d.update(OVR.get(d["code"], {})); d.pop("scan", None); D.append(d)

combos, q_tot, q_ok, q_empty = [], 0, 0, 0
per_dest = {}
for k, r in raw.items():
    q_tot += 1
    if r["st"] == "ok": q_ok += 1
    else: q_empty += 1
for k, r in raw.items():
    o, dc, dep, ret, ms = k.split("|")
    if ms != "2":
        continue
    pd = per_dest.setdefault(dc, {"q": 0, "ok": 0, "min2": None})
    pd["q"] += 1
    if r["st"] != "ok":
        continue
    pd["ok"] += 1
    r1 = raw.get("%s|%s|%s|%s|1" % (o, dc, dep, ret))
    f1 = sorted((r1 or {}).get("fl", []), key=lambda f: (f["price"], f["dur"]))
    s1 = {sig(f) for f in f1}
    f2 = sorted([f for f in r["fl"] if sig(f) not in s1 and not (len(f["segs"]) - 1 <= 1 and f1 and f["price"] >= f1[0]["price"])], key=lambda f: (f["price"], f["dur"]))
    # f2 = opzioni che richiedono 2 scali in almeno una tratta
    seen, a = set(), []
    for f in f1:
        key = (f["price"], f["segs"][0]["dt"], tuple(f["al"]))
        if key in seen: continue
        seen.add(key); a.append(compact(f))
        if len(a) == 4: break
    b = None; x = None
    if f2:
        p2 = f2[0]["price"]
        if pd["min2"] is None or p2 < pd["min2"]: pd["min2"] = p2
        if a:
            p1 = a[0][0]
            if p1 - p2 >= MIN_EUR and (p1 - p2) / p1 >= MIN_PCT:
                b = compact(f2[0])
            else:
                x = p2
        else:
            x = p2
    if not a and not f2:
        continue
    combos.append({"o": o, "d": dc, "dep": dep, "n": days(dep, ret), "a": a, "b": b, "x": x})

combos.sort(key=lambda c: (c["d"], c["dep"], c["n"], c["o"]))
cov = {dc: [v["q"], v["ok"], v["min2"]] for dc, v in per_dest.items()}
# CAMPO NUOVO bestBy: per destinazione e gruppo di origine (MIL, ROM, PSA) la combinazione piu' economica
#   [prezzo pp, origine, andata, giorni, scali] con <=1 scalo; "two" = idem per l'opzione a 2 scali che rispetta la regola
best_by = {}
for c in combos:
    g = origins.GROUP[c["o"]]
    e = best_by.setdefault(c["d"], {})
    if c["a"]:
        f = c["a"][0]
        if g not in e or f[0] < e[g][0]: e[g] = [f[0], c["o"], c["dep"], c["n"], f[3]]
    if c["b"]:
        f = c["b"]; t = e.setdefault("two", {})
        if g not in t or f[0] < t[g][0]: t[g] = [f[0], c["o"], c["dep"], c["n"], f[3]]
codes = {d["code"] for d in D}
trips = {k: v for k, v in itineraries.TRIPS.items() if k in codes}
assert len(trips) == len(itineraries.TRIPS), sorted(set(itineraries.TRIPS) - codes)
blob = {"dests": D, "combos": combos, "cov": cov, "bestBy": best_by, "excluded": dests.EXCLUDED, "clima": dests.CLIMA_SCORE, "trips": trips,
        "meta": {"q": q_tot, "ok": q_ok, "empty": q_empty, "date": "21 novembre 2026", "minPct": MIN_PCT, "minEur": MIN_EUR, **origins.export()}}
js = json.dumps(blob, ensure_ascii=False, separators=(",", ":")).replace("</", "<" + chr(92) + "/")
tpl = open(os.environ.get("TPL", "template.html"), encoding="utf-8").read()
assert "/*__DATA__*/" in tpl
open(os.environ.get("OUT", "agosto-2027.html"), "w", encoding="utf-8").write(tpl.replace("/*__DATA__*/", js))
valid = {c["d"] for c in combos if c["a"]}
print("query", q_tot, "ok", q_ok, "empty", q_empty, "| combos", len(combos), "| dest con <=1 scalo:", len(valid), "| html bytes", len(tpl) + len(js),
      "| itinerari:", sum(len(v) for v in trips.values()), "su", len(trips), "destinazioni; con voli senza itinerari:", sorted(valid - set(trips)))
