# -*- coding: utf-8 -*-
"""Test di internal.py (voli interni dei popular trips), senza richieste di rete: python test_internal.py"""
import os, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import internal as I
import popular_trips as P

fails = checks = 0
def ok(c, msg):
    global fails, checks
    checks += 1
    if not c:
        fails += 1; print("FAIL", msg)

def fl(price, stops=0, al="JetSMART"):
    segs = [{"f": "AAA", "t": "BBB", "dd": "2027-08-15", "dt": "09:00", "ad": "2027-08-15", "at": "10:00", "m": 60}] * (stops + 1)
    return {"price": price, "al": [al], "dur": 60 * (stops + 1), "segs": segs}

# tabella: ogni giro e ogni etichetta esistono nel catalogo, aeroporti a 3 lettere, giorni dentro il giro
by_id = {t["id"]: t for t in P.TRIPS}
bad = []
for tid, labels in I.LEGS.items():
    t = by_id.get(tid)
    if not t:
        bad.append(tid); continue
    nights = sum(s[1] for s in t["stages"])
    for lb, specs in labels.items():
        for sp in specs:
            if not (len(sp) in (3, 4) and all(isinstance(x, str) and len(x) == 3 and x.isupper() for x in sp[:2]) and sp[0] != sp[1]
                    and all(isinstance(x, int) and 0 <= x <= nights + 1 for x in sp[2:]) and (len(sp) == 3 or sp[3] > sp[2])):
                bad.append((tid, lb, sp))
ok(not bad, "tabella delle tratte: giri del catalogo, aeroporti e giorni validi -> %s" % bad[:4])
cat = {(t["id"], e[0]) for t in P.TRIPS for e in list(t["internal"]) + [x for a in t["air"] if a[0] == "rt" for x in a[2]]}
used = [(tid, lb) for tid, labels in I.LEGS.items() for lb in labels if (tid, lb) in cat]
ok(len(used) >= 70, "tabella delle tratte: almeno 70 etichette del catalogo hanno i loro aeroporti -> %d" % len(used))
ok(all(I.is_flight(lb) for _, lb in used), "nella tabella solo voli")

# voli e non voli, quanti voli vale un'etichetta
ok(I.is_flight("Lima-Cusco") and I.is_flight("Lombok-Bali (volo o fast boat)") and not I.is_flight("Erevan-Tbilisi via terra"), "voli e tratte via terra")
ok(I.count("Lima-Cusco") == 1 and I.count("La Paz-Uyuni A/R") == 2 and I.count("Praia-Fogo e Praia-São Vicente") == 2 and I.count("Ende-Bali (due tratte)") == 2
   and I.count("Cuiabá-Campo Grande (via San Paolo o Brasilia)") == 1, "quanti voli vale un'etichetta")

# chiavi: giorno = partenza + notti gia' passate
ok(I.key(("LIM", "CUZ", 3), "2027-08-12") == "IO|LIM|CUZ|2027-08-15", "chiave del solo andata nel giorno dell'itinerario")
ok(I.key(("LPB", "UYU", 8, 10), "2027-08-12") == "IR|LPB|UYU|2027-08-20|2027-08-22", "chiave dell'A/R interno")

# lookup: prezzo reale, limite di scali, tutte le tratte o niente, riga di un altro giorno
rows = {"IO|LIM|CUZ|2027-08-15": {"k": "IO|LIM|CUZ|2027-08-15", "st": "ok", "fl": [fl(40, 2), fl(58), fl(90, 1, "LATAM")], "age": 0}}
r = I.lookup(rows, "peru-classico", "Lima-Cusco", "2027-08-12")
ok(r == {"p": 58, "d": "2027-08-15", "al": ["JetSMART"], "st": 0}, "prezzo reale: il piu' economico con al massimo 1 scalo -> %s" % r)
ok(I.lookup(rows, "peru-classico", "Lima-Cusco", "2027-08-09")["p"] == 58 and I.lookup(rows, "peru-classico", "Lima-Cusco")["d"] == "2027-08-15",
   "una riga letta per un altro giorno vale lo stesso (con il suo giorno)")
ok(I.lookup(rows, "peru-classico", "Cusco-Lima") is None and I.lookup(rows, "peru-classico", "Volo che non esiste") is None and I.lookup(rows, "nessun-giro", "Lima-Cusco") is None,
   "tratta non letta o fuori tabella: nessun prezzo reale")
two = {"IO|RAI|SFL|2027-08-14": {"k": "IO|RAI|SFL|2027-08-14", "st": "ok", "fl": [fl(70, 0, "Cabo Verde Airlines")], "age": 0}}
ok(I.lookup(two, "capo-verde-isole", "Praia-Fogo e Praia-São Vicente") is None, "etichetta con due tratte: una sola letta non basta")
two["IO|RAI|VXE|2027-08-16"] = {"k": "IO|RAI|VXE|2027-08-16", "st": "ok", "fl": [fl(95, 1, "BestFly")], "age": 0}
r = I.lookup(two, "capo-verde-isole", "Praia-Fogo e Praia-São Vicente")
ok(r and r["p"] == 165 and r["al"] == ["Cabo Verde Airlines", "BestFly"] and r["st"] == 1, "etichetta con due tratte: somma, compagnie, scali")
ok(I.lookup({"IO|LIM|CUZ|2027-08-15": {"k": "IO|LIM|CUZ|2027-08-15", "st": "empty", "fl": [], "age": 0}}, "peru-classico", "Lima-Cusco") is None, "pagina vuota: resta la stima")

# voce per il sito
ok(I.entry(rows, "peru-classico", ("Lima-Cusco", 70)) == ["Lima-Cusco", 58, 1, 70, "2027-08-15", "JetSMART", 1], "voce con prezzo reale")
ok(I.entry(rows, "peru-classico", ("Cusco-Lima", 70)) == ["Cusco-Lima", 70, 0, 70, "", "", 1], "voce senza prezzo reale: stima del catalogo")
ok(I.entry(rows, "georgia-armenia", ("Erevan-Tbilisi via terra", 25)) == ["Erevan-Tbilisi via terra", 25, 0, 25, "", "", 0], "tratta via terra: stima, zero voli")

# piano: prima le mai lette (prima i voli che servono comunque, dai giri piu' economici), poi altro giorno, poi le vecchie
pk = [{"tid": "peru-classico", "dep": "2027-08-12", "tot": 2500, "labels": ["Lima-Cusco", "Cusco-Lima"], "must": {"Lima-Cusco": True}},
      {"tid": "argentina-nord", "dep": "2027-08-14", "tot": 2100, "labels": ["Buenos Aires-Iguazú"], "must": {"Buenos Aires-Iguazú": True}}]
todo, wanted, pairs = I.plan(pk, {})
ok([k for k, _, _ in todo] == ["IO|AEP|IGR|2027-08-17", "IO|LIM|CUZ|2027-08-15", "IO|CUZ|LIM|2027-08-22"], "piano: mai lette, prima i voli che servono comunque, dal giro piu' economico -> %s" % [k for k, _, _ in todo])
ok(wanted == {"IO|AEP|IGR|2027-08-17", "IO|LIM|CUZ|2027-08-15", "IO|CUZ|LIM|2027-08-22"} and "IO|LIM|CUZ|" in pairs, "piano: chiavi che servono")
todo, _, _ = I.plan(pk, rows)
ok("IO|LIM|CUZ|2027-08-15" not in [k for k, _, _ in todo] and len(todo) == 2, "piano: una riga letta di recente resta")
old = {"IO|LIM|CUZ|2027-08-15": dict(rows["IO|LIM|CUZ|2027-08-15"], age=I.KEEP)}
ok(I.plan(pk, old)[0][-1][0] == "IO|LIM|CUZ|2027-08-15", "piano: riga troppo vecchia -> si rilegge, per ultima")
other = {"IO|LIM|CUZ|2027-08-13": {"k": "IO|LIM|CUZ|2027-08-13", "st": "ok", "fl": [fl(61)], "age": 2}}
t3 = [k for k, _, _ in I.plan(pk, other)[0]]
ok(t3[-1] == "IO|LIM|CUZ|2027-08-15" and len(t3) == 3, "piano: letta per un altro giorno -> si rilegge nel giorno giusto, dopo le mai lette")
other["IO|LIM|CUZ|2027-08-13"]["age"] = 0
ok("IO|LIM|CUZ|2027-08-15" not in [k for k, _, _ in I.plan(pk, other)[0]], "piano: letta in questo giro per un altro giorno -> basta quella")
emp = {"IO|LIM|CUZ|2027-08-15": {"k": "IO|LIM|CUZ|2027-08-15", "st": "empty", "fl": [], "age": 1}}
ok("IO|LIM|CUZ|2027-08-15" not in [k for k, _, _ in I.plan(pk, emp)[0]], "piano: pagina vuota del giro prima -> non subito")
emp["IO|LIM|CUZ|2027-08-15"]["age"] = I.KEEP_EMPTY
ok("IO|LIM|CUZ|2027-08-15" in [k for k, _, _ in I.plan(pk, emp)[0]], "piano: pagina vuota da due giri -> si riprova")

with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "i.jsonl")
    I.save(rows, p)
    ok(I.load(p) == rows and I.load(os.path.join(d, "manca.jsonl")) == {}, "internal_v2.jsonl: salvataggio e lettura")

# la query (servono le librerie della scansione: in locale .venv, su GitHub requirements.txt)
try:
    import base64
    q = I._query("IR|LPB|UYU|2027-08-20|2027-08-22")
    b = base64.urlsafe_b64decode(q.params()["tfs"] + "==")
    ok(b.count(b"LPB") == 2 and b.count(b"UYU") == 2 and b"2027-08-20" in b and b"2027-08-22" in b and b.count(bytes([0x28, I.MS])) == 2, "query A/R interna: limite di scali su entrambe le tratte")
    b = base64.urlsafe_b64decode(I._query("IO|LIM|CUZ|2027-08-15").params()["tfs"] + "==")
    ok(b.count(b"LIM") == 1 and b.count(bytes([0x28, I.MS])) == 1, "query solo andata interna")
except ImportError as e:
    print("fast_flights non importabile (%s): test della query saltati" % type(e).__name__)

print("%d controlli, %d falliti" % (checks, fails))
sys.exit(1 if fails else 0)
