# -*- coding: utf-8 -*-
"""Test di returns.py e del parser dei segmenti (nessuna richiesta di rete): python test_returns.py"""
import base64, json, os, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import returns

fails = checks = 0
def ok(c, msg):
    global fails, checks
    checks += 1
    if not c:
        fails += 1; print("FAIL", msg)

def seg(f, t, dd, dt, ad, at, m, c=None, n=None, a=None):
    s = {"f": f, "t": t, "dd": dd, "dt": dt, "ad": ad, "at": at, "m": m}
    if c: s.update(c=c, n=n, a=a)
    return s

OUT = {"price": 1005, "al": ["British Airways"], "dur": 1215, "ly": {"LHR": "Londra"}, "segs": [
    seg("LIN", "LHR", "2027-08-14", "14:10", "2027-08-14", "15:15", 125, "BA", "573", "British Airways"),
    seg("LHR", "EZE", "2027-08-14", "19:25", "2027-08-15", "05:25", 840, "BA", "245", "British Airways")]}
BACK = {"price": 1005, "al": ["British Airways"], "dur": 1040, "segs": [
    seg("EZE", "LHR", "2027-08-24", "15:10", "2027-08-25", "08:30", 800, "BA", "244", "British Airways"),
    seg("LHR", "LIN", "2027-08-25", "10:30", "2027-08-25", "13:30", 120, "BA", "572", "British Airways")]}
OLD = {"price": 700, "al": ["Iberia"], "dur": 900, "segs": [seg("MXP", "MAD", "2027-08-14", "06:30", "2027-08-14", "08:55", 145),
                                                           seg("MAD", "EZE", "2027-08-14", "12:10", "2027-08-14", "19:55", 765)]}
A = ("LIN", "EZE", "2027-08-14", "2027-08-24", 1)

# chiavi
k = returns.sel_key(*A, OUT)
ok(k == "R|LIN|EZE|2027-08-14|2027-08-24|1|BA573-BA245", "chiave del ritorno: rotta, date, scali e voli dell'andata -> %s" % k)
ok(returns.sel_key(*A, OLD) is None, "righe senza numeri di volo: nessuna chiave (si usa il ripiego)")
ok(returns.ow_key("LIN", "EZE", "2027-08-24", 1) == "OW|EZE|LIN|2027-08-24|1", "chiave del ripiego: solo andata meta -> Italia")

# lookup: stesso biglietto, prezzo cambiato, ripiego, niente
rows = {k: {"k": k, "st": "ok", "p": 1005, "fl": [dict(BACK, price=1100), BACK]}}
r = returns.lookup(rows, {}, *A, OUT)
ok(r and r[0]["segs"][0]["dt"] == "15:10" and r[1] == 1, "ritorno dello stesso biglietto (stesso prezzo): tipo 1, il piu' economico")
r = returns.lookup(rows, {}, *A, dict(OUT, price=990))
ok(r and r[1] == 2, "prezzo dell'A/R cambiato dopo la lettura: ritorno indicativo (tipo 2)")
ow = {"OW|EZE|LIN|2027-08-24|2": {"st": "ok", "fl": [dict(BACK, price=400, segs=BACK["segs"] + BACK["segs"][:1]), dict(BACK, price=520)]}}
r = returns.lookup({}, ow, *A, OUT)
ok(r and r[1] == 2 and r[0]["price"] == 520, "ripiego sui solo andata del giro: il piu' economico entro il limite di scali, tipo 2")
r = returns.lookup({k: {"k": k, "st": "empty", "fl": []}, "OW|EZE|LIN|2027-08-24|1": {"st": "ok", "fl": [dict(BACK, price=480)]}}, {}, *A, OUT)
ok(r and r[1] == 2 and r[0]["price"] == 480, "pagina del ritorno vuota: vale il solo andata letto come ripiego")
ok(returns.lookup({}, {}, *A, OUT) is None and returns.lookup({}, {}, *A, OLD) is None, "niente di letto: nessun ritorno")

# tabella degli itinerari
it = returns.Itin()
i0, i1, i2 = it.add(OUT), it.add(BACK), it.add(OUT)
ok(i0 == 0 and i1 == 1 and i2 == 0 and len(it.rows) == 2, "itinerari senza ripetizioni")
ok(it.rows[0] == [["LIN", "LHR", "14:10", "15:15", 0, 0, 125, "BA", "573"], ["LHR", "EZE", "19:25", "05:25", 0, 1, 840, "BA", "245"]], "tratte: orari, giorni+, minuti, sigla e numero")
ok(it.rows[1][0][4:6] == [0, 1] and it.rows[1][1][4:6] == [1, 1], "giorni+ contati dalla partenza del volo")
ok(it.al == {"BA": "British Airways"} and it.ap == {"LHR": "Londra"}, "nomi delle compagnie e citta' degli scali")
i3 = it.add(OLD)
ok(len(it.rows[i3][0]) == 7 and it.ap.get("MAD") == "Madrid", "righe vecchie: tratte senza numero di volo, citta' dello scalo dall'elenco")
ok(it.add({"price": 1, "segs": []}) == -1 and set(it.export()) == {"rows", "al", "ap"}, "volo senza tratte: -1")

# piano: prima l'opzione migliore di ogni voce per citta', le lette di recente non si rifanno
def pick(o, d, dep, ret, f, tot, tgt, ms=1):
    return {"o": o, "d": d, "dep": dep, "ret": ret, "ms": ms, "f": f, "tot": tot, "tgt": tgt}
pk = [pick("LIN", "EZE", "2027-08-14", "2027-08-25", dict(OUT, price=1200), 1200, "d_EZE"), pick(*A[:4], OUT, 1005, "d_EZE"),
      pick("FCO", "EZE", "2027-08-14", "2027-08-24", dict(OUT, price=1300), 1300, "d_EZE"), pick("MXP", "EZE", "2027-08-14", "2027-08-24", OLD, 700, "d_EZE", 2)]
todo, wanted = returns.plan(pk, {})
ok([p["tot"] for p in todo] == [1005, 1300, 700, 1200], "piano: migliori per citta' (max 1 scalo), poi 2 scali, poi le altre celle -> %s" % [p["tot"] for p in todo])
ok(k in wanted and "OW|EZE|LIN|2027-08-24|1" in wanted and "OW|EZE|MXP|2027-08-24|2" in wanted, "piano: chiavi che servono ancora")
todo2, _ = returns.plan(pk, {k: {"k": k, "st": "ok", "p": 1005, "fl": [BACK], "age": 1}})
ok(len(todo2) == 3 and all(p["tot"] != 1005 for p in todo2), "piano: una riga letta con la stessa andata e lo stesso prezzo resta")
todo3, _ = returns.plan(pk, {k: {"k": k, "st": "ok", "p": 950, "fl": [BACK], "age": 1}})
todo4, _ = returns.plan(pk, {k: {"k": k, "st": "ok", "p": 1005, "fl": [BACK], "age": returns.KEEP}})
ok(len(todo3) == 4 and len(todo4) == 4, "piano: prezzo cambiato o riga troppo vecchia -> si rilegge")
todo5, _ = returns.plan(pk, {"OW|EZE|MXP|2027-08-24|2": {"st": "ok", "fl": [BACK], "age": 0}})
ok(all(p["tot"] != 700 for p in todo5), "piano: andata senza numeri di volo con il ripiego gia' letto -> resta")

# file: una riga per chiave, andata e ritorno
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "r.jsonl")
    returns.save(rows, p)
    ok(returns.load(p) == rows and returns.load(os.path.join(d, "manca.jsonl")) == {}, "returns_v2.jsonl: salvataggio e lettura")

# parser e pagina del ritorno (servono le librerie della scansione: in locale .venv, su GitHub requirements.txt)
try:
    import gf
except Exception as e:
    gf = None
    print("gf.py non importabile (%s): test del parser saltati" % type(e).__name__)
if gf:
    def raw_seg(f, t, dep, arr, d0, d1, m, c, n, name):
        s = [None] * 23
        s[3], s[6], s[8], s[10], s[11], s[20], s[21], s[22] = f, t, dep, arr, m, d0, d1, [c, n, None, name]
        return s
    fl = [None] * 14
    fl[1], fl[9] = ["British Airways"], 1215
    fl[2] = [raw_seg("LIN", "LHR", [14, 10], [15, 15], [2027, 8, 14], [2027, 8, 14], 125, "BA", "573", "British Airways"),
             raw_seg("LHR", "EZE", [19, 25], [5, 25], [2027, 8, 14], [2027, 8, 15], 840, "BA", "245", "British Airways")]
    fl[13] = [[250, "LHR", "LHR", None, "Aeroporto di Londra-Heathrow", "Londra", "Aeroporto di Londra-Heathrow", "Londra"]]
    old = [None] * 14
    old[1], old[9] = ["Iberia"], 300
    old[2] = [raw_seg("MXP", "MAD", [6], [8, 55], [2027, 8, 14], [2027, 8, 14], 145, None, None, None)[:22]]
    got = gf._rows([None, None, [[[fl, [[None, 1005]]]]], [[[old, [[None, 300]]]]]])
    ok(len(got) == 2 and got[0]["segs"] == OUT["segs"] and got[0]["ly"] == {"LHR": "Londra"} and got[0]["price"] == 1005, "parser: compagnia, numero di volo e citta' dello scalo")
    ok(got[1]["segs"] == [seg("MXP", "MAD", "2027-08-14", "06:00", "2027-08-14", "08:55", 145)] and "ly" not in got[1], "parser: riga senza numero di volo letta lo stesso")
    q = gf.ReturnQuery(*A, OUT["segs"])
    b = base64.urlsafe_b64decode(q.tfs)
    ok(q.tfs == "Gl4SCjIwMjctMDgtMTQiHwoDTElOEgoyMDI3LTA4LTE0GgNMSFIqAkJBMgM1NzMiHwoDTEhSEgoyMDI3LTA4LTE0GgNFWkUqAkJBMgMyNDUoAWoFEgNMSU5yBRIDRVpFGhwSCjIwMjctMDgtMjQoAWoFEgNFWkVyBRIDTElOQgEBSAGYAQE=",
       "pagina del ritorno: tfs con l'andata scelta, uguale a quello del browser")
    ok(q.params() == {"tfs": q.tfs, "hl": "it", "curr": "EUR"} and b.count(b"BA") == 2 and b"573" in b and b"245" in b, "pagina del ritorno: parametri")
    three = OUT["segs"] + [seg("EZE", "COR", "2027-08-15", "08:00", "2027-08-15", "09:30", 90, "AR", "1500", "Aerolineas")] * 2
    b3 = base64.urlsafe_b64decode(gf.ReturnQuery("LIN", "COR", "2027-08-14", "2027-08-24", 2, three).tfs)
    ok(b3[0] == 0x1A and b3[1] & 0x80 and (b3[1] & 0x7F | b3[2] << 7) > 127 and b3[3] == 0x12, "pagina del ritorno: lunghezze oltre 127 byte in varint")

print("%d controlli, %d falliti" % (checks, fails))
sys.exit(1 if fails else 0)
