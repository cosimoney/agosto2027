# -*- coding: utf-8 -*-
"""Test dello storico prezzi (price_history.py): python test_price_history.py
Giro normale, stesso giro contato due volte, secondo giro nello stesso giorno (minimo + ultimo valore), giorno dopo,
copertura bassa (dato parziale), giro in ABORT o senza scan_meta.json (nessuna scrittura), forma compatta per il sito."""
import json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import price_history as PH

fails = checks = 0
def ok(c, msg):
    global fails, checks
    checks += 1
    if not c:
        fails += 1; print("FAIL", msg)

def blob(mxp, fco=None, psa=None, two=None, q=1000, okq=250, cov=40, trip=900):
    """Blob minimo come quello di build_v2.load_data(): una meta (CMB) e un trip (giro)."""
    f = lambda p, st=1: [p, "X", 600, st, "10:00", "20:00", 0, "DOH", "MXP", "CMB"]
    combos = [{"o": "MXP", "d": "CMB", "dep": "2027-08-14", "n": 10, "a": [f(mxp), f(mxp + 50)], "b": f(two, 2) if two else None, "x": None},
              {"o": "LIN", "d": "CMB", "dep": "2027-08-10", "n": 11, "a": [f(mxp + 5)], "b": None, "x": None}]
    if fco: combos.append({"o": "FCO", "d": "CMB", "dep": "2027-08-09", "n": 10, "a": [f(fco)], "b": None, "x": None})
    if psa: combos.append({"o": "PSA", "d": "CMB", "dep": "2027-08-12", "n": 12, "a": [f(psa)], "b": None, "x": None})
    combos.append({"o": "MXP", "d": "NOA", "dep": "2027-08-12", "n": 12, "a": [], "b": None, "x": 1500})   # solo 2 scali fuori regola: nessun prezzo
    trips = [{"id": "giro", "land": [800, 1000], "itot": 120, "cov": [[30, 12, 5], [10, 3, 0]],
              "cells": [{"dep": "2027-08-08", "n": 11, "o": "FCO", "a": [[0, trip, 40, 0, 1], [0, trip + 80, 0, 0, -1]], "b": None, "x": None},
                        {"dep": "2027-08-09", "n": 12, "o": "MXP", "a": [[0, trip + 30, 40, 0, -1]], "b": None, "x": None}]}]
    return {"combos": combos, "cov": {"CMB": [60, cov, None], "NOA": [20, 2, 1500]}, "meta": {"q": q, "ok": okq, "groups": {"MIL": ["LIN", "MXP"], "ROM": ["FCO"], "PSA": ["PSA"]}},
            "trips_popular": {"meta": {"q": 0, "ok": 0}, "legs": [["x", "y", 1, 1], ["x", "y", 1, 2]], "trips": trips}}

def run(h, b, gen, src="actions"):
    return PH.update(h, PH.snapshot(b), PH.run_info(b, {"generated": gen}, src))

# 1. giro normale
h = PH.empty()
b1 = blob(821, fco=818, psa=1060)
s = PH.snapshot(b1)
ok(set(s) == {"d_CMB", "t_giro"}, "snapshot: solo i target con un prezzo -> %s" % sorted(s))
ok(s["d_CMB"]["g"] == {"MIL": [821, "MXP", "2027-08-14", 10, 1], "ROM": [818, "FCO", "2027-08-09", 10, 1], "PSA": [1060, "PSA", "2027-08-12", 12, 1]} and s["d_CMB"]["k"] == 40, "snapshot meta: minimo per gruppo [prezzo, origine, andata, giorni, scali]")
ok(s["t_giro"]["g"]["ROM"] == [900, "FCO", "2027-08-08", 11, 2, 1960, 40] and s["t_giro"]["g"]["MIL"][0] == 930 and s["t_giro"]["k"] == 15, "snapshot trip: voli, scali peggiori, totale stimato, extra -> %s" % s["t_giro"])
ok(run(h, b1, "2026-11-21T15:14:36Z") is True, "giro normale: scritto")
r = h["t"]["d_CMB"]
ok(len(r) == 1 and r[0]["d"] == "2026-11-21" and r[0]["A"] == "ROM" and r[0]["ROM"][0] == 818 and "l" not in r[0] and "p" not in r[0], "giro normale: una riga, migliore assoluto = Roma")
ok(h["runs"]["2026-11-21"] == {"src": "actions", "g": ["2026-11-21T15:14:36Z"], "n": 1, "q": 1000, "ok": 250, "r": 0.25}, "giro normale: riepilogo del giro -> %s" % h["runs"])
ok(PH.run_info(b1, {"generated": "2026-11-21T23:30:00Z"}, "x")["day"] == "2026-11-22", "giorno del giro in ora italiana")

# 2. lo stesso giro (ripubblicazione del sito) non conta due volte
before = json.dumps(h, sort_keys=True)
ok(run(h, b1, "2026-11-21T15:14:36Z") is False and json.dumps(h, sort_keys=True) == before, "stesso giro ripetuto: nessuna modifica")

# 3. secondo giro nello stesso giorno: resta il minimo, "l" porta l'ultimo valore
ok(run(h, blob(749, fco=830, trip=950), "2026-11-21T18:00:00Z") is True, "secondo giro del giorno: scritto")
r = h["t"]["d_CMB"]
ok(len(r) == 1 and r[0]["MIL"][0] == 749 and r[0]["ROM"][0] == 818 and r[0]["A"] == "MIL", "secondo giro: minimo del giorno per gruppo")
ok(r[0]["l"] == {"ROM": 830, "PSA": None}, "secondo giro: ultimo valore dove diverso dal minimo (Pisa non trovata) -> %s" % r[0].get("l"))
ok(h["runs"]["2026-11-21"]["n"] == 2 and len(h["runs"]["2026-11-21"]["g"]) == 2, "secondo giro: contato nel riepilogo")
ok(h["t"]["t_giro"][0]["ROM"][0] == 900 and h["t"]["t_giro"][0]["l"]["ROM"] == 950, "secondo giro: trip, minimo e ultimo")
ok(run(h, blob(700, fco=818, psa=1060), "2026-11-21T20:00:00Z") and h["t"]["d_CMB"][0]["MIL"][0] == 700 and "l" not in h["t"]["d_CMB"][0], "terzo giro piu' basso: nuovo minimo, niente 'l'")

# 4. giorno dopo, regola scali (2 scali ammessi dal build), copertura bassa
ok(run(h, blob(760, fco=818, two=520), "2026-11-22T16:28:38Z") and len(h["t"]["d_CMB"]) == 2 and h["t"]["d_CMB"][1]["MIL"] == [520, "MXP", "2027-08-14", 10, 2], "giorno dopo: riga nuova, opzione a 2 scali della regola")
ok(run(h, blob(990, okq=90, cov=10), "2026-11-23T07:00:00Z") and h["runs"]["2026-11-23"].get("p") == 1 and h["t"]["d_CMB"][2].get("p") == 1, "giro con copertura bassa: giorno e punti parziali")
ok(run(h, blob(751), "2026-11-23T12:00:00Z") and "p" not in h["runs"]["2026-11-23"] and "p" not in h["t"]["d_CMB"][2] and h["t"]["d_CMB"][2]["MIL"][0] == 751, "giro completo nello stesso giorno: non piu' parziale")
ok(run(h, blob(760, cov=12), "2026-11-24T07:00:00Z") and "p" not in h["runs"]["2026-11-24"] and h["t"]["d_CMB"][3].get("p") == 1 and "p" not in h["t"]["t_giro"][3], "copertura bassa solo sul target: parziale solo quello")

# 5. salvataggio, rilettura, forma compatta
tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "state", "price_history.json")
PH.save(h, path)
ok(PH.load(path) == h, "save + load: stesso contenuto")
ok(sum(ln.startswith('{"d":') for ln in open(path, encoding="utf-8")) == sum(len(v) for v in h["t"].values()), "file: una riga di testo per giorno e per target")
c = PH.compact(h, {"d_CMB"})
ok(list(c["t"]) == ["d_CMB"] and c["days"] == sorted(h["runs"]) and len(c["runs"]) == len(c["days"]), "compact: solo i target chiesti")
row = c["t"]["d_CMB"][0]
ok(c["e"][row[1]] == h["t"]["d_CMB"][0]["MIL"] and c["e"][row[2]][0] == 818 and row[4] == 0 and c["t"]["d_CMB"][3][4] == 1 and c["t"]["d_CMB"][3][3] == -1, "compact: indici delle voci, parziale, gruppo assente")
ok(len(c["e"]) == len({tuple(e) for e in c["e"]}), "compact: voci uguali scritte una volta")

# 6. ABORT e scan_meta mancante: nessuna scrittura
root0 = PH.ROOT
try:
    PH.ROOT = tmp
    p2 = os.path.join(tmp, "nuovo.json")
    ok(PH.update_from_files(p2) is False and not os.path.exists(p2), "senza scan_meta.json: nessuna scrittura")
    json.dump({"generated": "2026-11-25T07:00:00Z"}, open(os.path.join(tmp, "scan_meta.json"), "w"))
    open(os.path.join(tmp, "fail_reason.txt"), "w").write("ABORT di prova\n")
    before = open(path, encoding="utf-8").read()
    ok(PH.update_from_files(path) is False and open(path, encoding="utf-8").read() == before and PH.update_from_files(p2) is False and not os.path.exists(p2), "giro in ABORT: file intatto, nessun file nuovo")
finally:
    PH.ROOT = root0

print("%d controlli, %d falliti" % (checks, fails))
sys.exit(1 if fails else 0)
