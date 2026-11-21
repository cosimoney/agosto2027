# -*- coding: utf-8 -*-
"""Confronto origini (solo prezzo dei voli, pp): Roma FCO e Pisa PSA contro Milano (LIN/MXP).
Legge il blob di agosto-2027.html e trips_data.json; con le copie .bak confronta anche con la scansione precedente.
  python compare_origins.py [--all]"""
import json, os, re, sys
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8")
G = {"LIN": "MIL", "MXP": "MIL", "FCO": "ROM", "PSA": "PSA"}
def blob(path):
    if not os.path.exists(path): return None
    s = open(path, encoding="utf-8").read()
    i = s.index("const RAW = ") + 12
    return json.JSONDecoder().raw_decode(s.replace("<\/", "</")[i:])[0]
def ret(dep, n): return (date.fromisoformat(dep) + timedelta(days=n)).isoformat()[5:]
def summarize(rows):
    """rows: (id, gruppo, origine, dep, n, prezzo, scali<=1?) -> {id: {gruppo: best<=1, gruppo+'2': best 2 scali}}"""
    out = {}
    for i, g, o, dep, n, p, one in rows:
        e = out.setdefault(i, {}); k = g if one else g + "2"
        if k not in e or p < e[k][0]: e[k] = (p, o, dep, n)
    return out
def dest_rows(B):
    for c in B["combos"]:
        g = G[c["o"]]
        if c["a"]: yield c["d"], g, c["o"], c["dep"], c["n"], c["a"][0][0], True
        p2 = c["b"][0] if c["b"] else c["x"]
        if p2: yield c["d"], g, c["o"], c["dep"], c["n"], p2, False
def trip_rows(T):
    for t in T["trips"]:
        for c in t["cells"]:
            g = G[c["o"]]
            if c["a"]: yield t["id"], g, c["o"], c["dep"], c["n"], c["a"][0][1] + c["a"][0][2], True
            p2 = (c["b"][1] + c["b"][2]) if c["b"] else c["x"]
            if p2: yield t["id"], g, c["o"], c["dep"], c["n"], p2, False
def cells_won(rows):
    """per id: in quante combinazioni data x durata Roma/Pisa battono Milano (<=1 scalo)"""
    m = {}
    for i, g, o, dep, n, p, one in rows:
        if one:
            e = m.setdefault((i, dep, n), {}); e[g] = min(p, e.get(g, 9e9))
    w = {}
    for (i, dep, n), e in m.items():
        x = w.setdefault(i, [0, 0]); x[1] += 1
        alt = min(e.get("ROM", 9e9), e.get("PSA", 9e9))
        if alt < e.get("MIL", 9e9): x[0] += 1
    return w
def report(title, names, new, old, won):
    print("\n==== %s ====" % title)
    wins, unlock, same, none = [], [], [], []
    for i, nm in names.items():
        e = new.get(i, {}); mil = e.get("MIL"); alts = [(e[g], g) for g in ("ROM", "PSA") if g in e]
        if not alts and not mil:
            none.append((i, nm, e)); continue
        if not alts: same.append((i, nm, mil, None)); continue
        (b, g) = min(alts)
        if not mil:
            unlock.append((i, nm, g, b, e.get("MIL2"), e)); continue
        if b[0] < mil[0]: wins.append((mil[0] - b[0], i, nm, g, b, mil, e))
        else: same.append((i, nm, mil, (b, g)))
    print("-- Roma/Pisa piu' economiche di Milano (<=1 scalo, volo pp): %d" % len(wins))
    for d, i, nm, g, b, mil, e in sorted(wins, reverse=True):
        oth = " | ".join("%s %d" % (k, e[k][0]) for k in ("ROM", "PSA") if k in e)
        w = won.get(i, [0, 0])
        print("%-34s %s %s->%s %2dg  %5d  vs Milano %s %s->%s %5d  = -%d (-%d%%)  [%s; celle vinte %d/%d]" % (
            nm[:34], b[1], b[2][5:], ret(b[2], b[3]), b[3], b[0], mil[1], mil[2][5:], ret(mil[2], mil[3]), mil[0], d, round(100 * d / mil[0]), oth, w[0], w[1]))
    print("-- SBLOCCATE da Roma/Pisa (Milano senza opzioni <=1 scalo): %d" % len(unlock))
    for i, nm, g, b, m2, e in unlock:
        print("%-34s %s %s->%s %2dg  %5d  | Milano: %s" % (nm[:34], b[1], b[2][5:], ret(b[2], b[3]), b[3], b[0], ("solo 2 scali da %d (%s)" % (m2[0], m2[1])) if m2 else "nessun volo"))
    print("-- Milano resta la piu' economica o unica: %d" % len(same))
    if "--all" in sys.argv:
        for i, nm, mil, alt in same:
            print("%-34s Milano %s %5d | %s" % (nm[:34], mil[1], mil[0], ("%s %d (+%d)" % (alt[0][1], alt[0][0], alt[0][0] - mil[0])) if alt else "Roma/Pisa: nessuna opzione <=1 scalo"))
    print("-- Ancora senza opzioni <=1 scalo da nessuna origine: %d" % len(none))
    for i, nm, e in none:
        two = ", ".join("%s da %d" % (k[:-1], e[k][0]) for k in e)
        print("   %-34s %s" % (nm[:34], ("solo 2 scali: " + two) if two else "nessun volo"))
    if old is not None:
        newly = [(i, nm) for i, nm in names.items() if any(k in new.get(i, {}) for k in ("MIL", "ROM", "PSA")) and "MIL" not in old.get(i, {})]
        print("-- Senza opzioni <=1 scalo nella scansione precedente, ora con voli: %d" % len(newly))
        for i, nm in newly:
            e = new[i]; print("   %-34s %s" % (nm[:34], " | ".join("%s %s %d" % (k, e[k][1], e[k][0]) for k in ("MIL", "ROM", "PSA") if k in e)))
        ch = [(new[i]["MIL"][0] - old[i]["MIL"][0], nm, old[i]["MIL"][0], new[i]["MIL"][0]) for i, nm in names.items() if "MIL" in new.get(i, {}) and "MIL" in old.get(i, {}) and new[i]["MIL"][0] != old[i]["MIL"][0]]
        lost = [nm for i, nm in names.items() if "MIL" in old.get(i, {}) and "MIL" not in new.get(i, {})]
        print("-- Miglior prezzo da Milano cambiato rispetto alla scansione precedente: %d; perse: %s" % (len(ch), lost))
        for d, nm, a, b in sorted(ch): print("   %-34s %d -> %d (%+d)" % (nm[:34], a, b, d))
    return wins, unlock
B, B0 = blob("agosto-2027.html"), blob("agosto-2027.html.bak")
names = {d["code"]: "%s %s" % (d["city"], d["code"]) for d in B["dests"]}
r = list(dest_rows(B))
w1, u1 = report("DESTINAZIONI (A/R)", names, summarize(r), summarize(dest_rows(B0)) if B0 else None, cells_won(r))
T = json.load(open("trips_data.json", encoding="utf-8"))
T0 = json.load(open("trips_data.json.bak", encoding="utf-8")) if os.path.exists("trips_data.json.bak") else None
names = {t["id"]: "%s [%s]" % (t["name"], t["arr"] + ("-" + t["dep"] if t["dep"] != t["arr"] else "")) for t in T["trips"]}
r = list(trip_rows(T))
w2, u2 = report("POPULAR TRIPS (voli internazionali + tratte extra stimate del modo di volare)", names, summarize(r), summarize(trip_rows(T0)) if T0 else None, cells_won(r))
