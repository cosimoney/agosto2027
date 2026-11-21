# -*- coding: utf-8 -*-
"""popular_trips.py + trips_raw_v2.jsonl (+ raw_v2.jsonl per gli A/R gia' scansionati) -> trips_data.json (= RAW.trips_popular).
Origini: origins.py (LIN, MXP, FCO, PSA), campo "o" della cella. Solo prezzi dei voli, nessun costo di posizionamento.
Negli open-jaw si rientra su un aeroporto dello stesso gruppo dell'andata (Milano: LIN o MXP; Roma: FCO; Pisa: PSA).

Per ogni trip, data di andata, durata e aeroporto di partenza si confrontano tutti i modi di volare del catalogo:
  ow = open-jaw come somma di 2 solo-andata (prezzi reali Google, la somma e' una stima del multi-city)
  rt = A/R reale Google su un hub + tratte extra stimate per chiudere il giro
Regola scali come build.py: max 1 scalo per tratta; 2 scali solo se -25% e -150 EUR pp sul miglior <=1 scalo.

Formati compatti:
  legs[i]  = [prezzo, compagnie, durataMin, scali, partenza, arrivo, giorni+, scali via, da, a, data]
  opzione  = [indice in trip.air, prezzo voli Google pp, extra stimato pp, leg andata, leg ritorno | -1]
  cella    = {dep, n, o, a:[opzioni <=1 scalo, dalla piu' economica], b: opzione con 2 scali che rispetta la regola | null, x: min prezzo 2 scali altrimenti}
"""
import json, os, sys
from datetime import date, timedelta
import popular_trips as P
import origins

MIN_PCT, MIN_EUR = 0.25, 150
ORIGINS = origins.ORIGINS
DEPS = [(date(2027, 8, 6) + timedelta(days=i)).isoformat() for i in range(9)]
DURS = (10, 11, 12)

def load(path):
    out = {}
    if os.path.exists(path):
        for ln in open(path, encoding="utf-8"):
            try:
                r = json.loads(ln); out[r["k"]] = r
            except Exception:
                pass
    return out

base, mine = load(os.environ.get("RAW", "raw_v2.jsonl")), load(os.environ.get("TRIPS_RAW", "trips_raw_v2.jsonl"))   # env solo per rigenerare copie
raw = dict(base); raw.update(mine)

def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days
def plus(d, n):
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()
def sig(f):
    return (f["price"], tuple((s["f"], s["t"], s["dt"]) for s in f["segs"]))

LEGS, LEG_IX = [], {}
def leg(f):
    s = f["segs"]
    t = (f["price"], " + ".join(f["al"]) or "n.d.", f["dur"], len(s) - 1, s[0]["dt"], s[-1]["at"], days(s[0]["dd"], s[-1]["ad"]),
         "·".join(x["t"] for x in s[:-1]), s[0]["f"], s[-1]["t"], s[0]["dd"])
    if t not in LEG_IX:
        LEG_IX[t] = len(LEGS); LEGS.append(list(t))
    return LEG_IX[t]

used = {"q": 0, "ok": 0, "reuse": 0}
seen_keys = set()
def get(k):
    r = raw.get(k)
    if k not in seen_keys:
        seen_keys.add(k)
        if r is not None:
            if k in mine: used["q"] += 1; used["ok"] += r["st"] == "ok"
            else: used["reuse"] += 1
    return r

def ow_pool(f, t, d):
    """-> (voli <=1 scalo, voli con 2 scali, n. query fatte, n. query con voli)"""
    fl, ks = {}, {}
    for ms in (2, 1):
        k = "OW|%s|%s|%s|%d" % (f, t, d, ms)
        r = get(k)
        if r is None: continue
        ks[k] = r["st"] == "ok"
        for x in r["fl"]: fl[sig(x)] = x
    v = sorted(fl.values(), key=lambda x: (x["price"], x["dur"]))
    return [x for x in v if len(x["segs"]) - 1 <= 1], [x for x in v if len(x["segs"]) - 1 == 2], ks

def rt_pool(o, hub, dep, ret):
    k2, k1 = "%s|%s|%s|%s|2" % (o, hub, dep, ret), "%s|%s|%s|%s|1" % (o, hub, dep, ret)
    r2, r1 = get(k2), get(k1)
    ks = {k: r["st"] == "ok" for k, r in ((k2, r2), (k1, r1)) if r is not None}
    f1 = sorted((r1 or {}).get("fl", []), key=lambda f: (f["price"], f["dur"]))
    s1 = {sig(f) for f in f1}
    f2 = sorted([f for f in (r2 or {}).get("fl", []) if sig(f) not in s1 and not (len(f["segs"]) - 1 <= 1 and f1 and f["price"] >= f1[0]["price"])],
                key=lambda f: (f["price"], f["dur"]))
    return f1, f2, ks

trips_out = []
for t in P.TRIPS:
    air = [{"k": "ow" if a[0] == "oj" else "rt", "a": a[1], "b": a[2] if a[0] == "oj" else a[1],
            "add": [list(x) for x in (a[2] if a[0] == "rt" else [])], "note": a[3] if a[0] == "rt" else ""} for a in t["air"]]
    cov = [[0, 0, 0] for _ in air]   # per modo di volare: query, query con voli, celle con opzione <=1 scalo
    covk = [{} for _ in air]
    cells = []
    for dep in DEPS:
        for n in DURS:
            ret = plus(dep, n)
            for o in ORIGINS:
                one, two = [], []
                for ai, a in enumerate(air):
                    x = sum(e[1] for e in a["add"])
                    if a["k"] == "ow":
                        o1, o2, ks = ow_pool(o, a["a"], dep)
                        covk[ai].update(ks)
                        b1, b2 = [], []
                        for m in origins.GROUPS[origins.GROUP[o]]:   # si puo' rientrare sull'altro aeroporto di Milano
                            p1, p2, ks = ow_pool(a["b"], m, ret)
                            covk[ai].update(ks)
                            b1 += p1; b2 += p2
                        b1.sort(key=lambda f: (f["price"], f["segs"][-1]["t"] != o, f["dur"])); b2.sort(key=lambda f: (f["price"], f["dur"]))
                        if o1 and b1:
                            one.append([ai, o1[0]["price"] + b1[0]["price"], x, leg(o1[0]), leg(b1[0])]); cov[ai][2] += 1
                        cand = []
                        if o2 and (b1 or b2): cand.append((o2[0], min(b1[:1] + b2[:1], key=lambda f: f["price"])))
                        if b2 and o1: cand.append((o1[0], b2[0]))
                        if cand:
                            c = min(cand, key=lambda c: c[0]["price"] + c[1]["price"])
                            two.append([ai, c[0]["price"] + c[1]["price"], x, leg(c[0]), leg(c[1])])
                    else:
                        f1, f2, ks = rt_pool(o, a["a"], dep, ret)
                        covk[ai].update(ks)
                        if f1:
                            one.append([ai, f1[0]["price"], x, leg(f1[0]), -1]); cov[ai][2] += 1
                        if f2:
                            two.append([ai, f2[0]["price"], x, leg(f2[0]), -1])
                tot = lambda op: op[1] + op[2]
                one.sort(key=tot); two.sort(key=tot)
                if not one and not two:
                    continue
                b, x2 = None, None
                if two:
                    if one and tot(one[0]) - tot(two[0]) >= MIN_EUR and (tot(one[0]) - tot(two[0])) / tot(one[0]) >= MIN_PCT:
                        b = two[0]
                    else:
                        x2 = tot(two[0])
                cells.append({"dep": dep, "n": n, "o": o, "a": one, "b": b, "x": x2})
    for ai in range(len(air)):
        cov[ai][0], cov[ai][1] = len(covk[ai]), sum(covk[ai].values())
    internal = [list(x) for x in t["internal"]]
    itot = sum(x[1] for x in internal)
    valid = [c for c in cells if c["a"]]
    why = None
    if not valid:
        if any(c["x"] or c["b"] for c in cells):
            why = "solo con 2 scali per tratta (da %d € pp)" % min(c["x"] for c in cells if c["x"])
        else:
            parts = []
            for a, c in zip(air, cov):
                name = ("%s→%s solo-andata" % (a["a"], a["b"])) if a["k"] == "ow" else ("A/R %s" % a["a"])
                parts.append("%s: %d ricerche con voli su %d" % (name, c[1], c[0]))
            why = "Google non ha ancora tariffe complete per agosto 2027 (" + "; ".join(parts) + ")"
    best = None
    if valid:
        mid = (t["land"][0] + t["land"][1]) / 2
    def best_of(cs):
        c = min(cs, key=lambda c: (c["a"][0][1] + c["a"][0][2], ORIGINS.index(c["o"])))
        op = c["a"][0]
        return {"dep": c["dep"], "ret": plus(c["dep"], c["n"]), "n": c["n"], "o": c["o"], "kind": air[op[0]]["k"], "hub": air[op[0]]["a"],
                "voli": op[1], "extra": op[2], "tot": round(op[1] + op[2] + itot + mid), "totLo": op[1] + op[2] + itot + t["land"][0], "totHi": op[1] + op[2] + itot + t["land"][1]}
    # best = il piu' economico fra tutte le origini (a parita' vince Milano); CAMPO NUOVO bestBy = lo stesso per gruppo MIL / ROM / PSA
    best_by = {}
    for g, os_ in origins.GROUPS.items():
        cs = [c for c in valid if c["o"] in os_]
        if cs: best_by[g] = best_of(cs)
    if valid:
        best = best_of(valid)
    d = dict(t)
    d.update({"air": air, "internal": internal, "itot": itot, "nights": sum(s[1] for s in t["stages"]), "stages": [list(s) for s in t["stages"]],
              "land": list(t["land"]), "cells": cells, "cov": cov, "why": why, "best": best, "bestBy": best_by})
    trips_out.append(d)

blob = {"meta": {"date": "21 novembre 2026", "multiCity": False, "q": len(mine), "ok": sum(r["st"] == "ok" for r in mine.values()),
                 "empty": sum(r["st"] != "ok" for r in mine.values()), "reused": used["reuse"], "minPct": MIN_PCT, "minEur": MIN_EUR, **origins.export()},
        "trips": trips_out, "legs": LEGS, "city": P.CITY, "styles": P.STYLES, "skipped": P.SKIPPED,
        "clima": {"ottimo": 1.0, "buono": 0.8, "accettabile": 0.5}}
js = json.dumps(blob, ensure_ascii=False, separators=(",", ":"))
open(os.environ.get("TRIPS_OUT", "trips_data.json"), "w", encoding="utf-8").write(js)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ok = [t for t in trips_out if t["best"]]
    print("trip", len(trips_out), "con voli", len(ok), "| query proprie", blob["meta"]["q"], "ok", blob["meta"]["ok"], "| riusate da raw_v2.jsonl", used["reuse"], "| legs", len(LEGS), "| bytes", len(js))
    for t in sorted(ok, key=lambda t: t["best"]["tot"]):
        b = t["best"]
        print("%-28s %s→%s %s %s→%s %dg %s %s voli %d +extra %d +interni %d terra %d-%d => tot pp %d (coppia %d)" % (
            t["id"], t["arr"], t["dep"], b["o"], b["dep"][5:], b["ret"][5:], b["n"], b["kind"], b["hub"], b["voli"], b["extra"], t["itot"], t["land"][0], t["land"][1], b["tot"], b["tot"] * 2))
    for t in trips_out:
        if not t["best"]: print("SENZA VOLI %-28s %s" % (t["id"], t["why"]))
