# -*- coding: utf-8 -*-
"""Fetch + parser tollerante per Google Flights (basato su flightsMI/pipeline.py).
Differenze dal parser di fast-flights: legge sia i voli "migliori" (payload[2]) sia gli "altri"
(payload[3]), salta le singole righe malformate invece di far fallire tutta la pagina,
ed estrae la durata totale del viaggio.

Due fonti, stesso formato dei voli:
  1. la pagina HTML (script ds:1): contiene solo i risultati che Google ha gia' pronti quando la compone. Sulle rotte
     meno cercate (lungo raggio, date lontane) arriva valida ma SENZA voli, e il browser li carica subito dopo con una
     chiamata a parte. Quei vuoti non sono "nessun volo".
  2. quella chiamata: GetShoppingResults (POST, risposta JSON, 30 volte piu' leggera della pagina). Da' i voli veri,
     oppure un vuoto confermato, oppure un ErrorResponse: capita circa una volta su due anche su rotte con voli e cambia
     da una richiesta all'altra, quindi si riprova subito. Solo andata: 1-3 secondi. A/R di lungo raggio: spesso il
     motore non fa in tempo (errore dopo 20 secondi), percio' gli A/R restano sulla pagina e questa chiamata si usa
     - in estimate.py, per i solo andata delle mete senza A/R e per l'A/R vero della cella migliore;
     - dentro fetch() quando la pagina e' vuota, solo se gf.API_ON e' acceso (GF_API=1 o pipeline.py)."""
import json, os, random, threading, time, urllib.parse
from primp import Client
from selectolax.lexbor import LexborHTMLParser
from fast_flights import FlightQuery, Passengers, create_query

URL = "https://www.google.com/travel/flights"
API = "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults"
API_ON = os.environ.get("GF_API", "0") == "1"   # ripiego dentro fetch(): acceso solo dove serve (pipeline.py, estimate.py)
API_TRIES = int(os.environ.get("GF_API_TRIES") or 3)
api_stats = {"calls": 0, "http": 0, "ok": 0, "empty": 0, "error": 0}   # ripiego: chiamate fatte e come sono finite
_slock = threading.Lock()
SOCS = {"SOCS": "CAISHAgBEhJnd3NfMjAyNDA0MDktMF9SQzIaAml0IAEaBgiA_LyaBg"}
_tls = threading.local()

class Blocked(Exception):
    pass

def client(reset=False):
    if reset or getattr(_tls, "c", None) is None:
        c = Client(impersonate="chrome_145", impersonate_os="macos", referer=True, cookie_store=True, timeout=40)
        c.set_cookies("https://www.google.com", SOCS)
        _tls.c = c
    return _tls.c

def _t(v):
    p = [*(v or []), None, None]
    return "%02d:%02d" % (p[0] or 0, p[1] or 0)

def _d(v):
    return "%04d-%02d-%02d" % tuple(v)

def parse_html(html):
    """-> (status, flights). status: 'ok' | 'empty' (pagina valida, nessun volo) | 'nodata' (pagina senza payload)"""
    node = LexborHTMLParser(html).css_first(r"script.ds\:1")
    if node is None:
        return "nodata", []
    js = node.text()
    if "data:" not in js:
        return "nodata", []
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]
    if data.endswith("errorHasStatus: true"):
        return "empty", []
    try:
        p = json.loads(data)
    except Exception:
        return "nodata", []
    out = _rows(p)
    return ("ok" if out else "empty"), out

def _rows(p, out=None, seen=None):
    """Voli di un payload (pagina o GetShoppingResults: stessa struttura). Le righe malformate si saltano."""
    out = [] if out is None else out
    for idx, best in ((2, True), (3, False)):
        try:
            block = p[idx][0] if p[idx] else None
        except Exception:
            block = None
        for k in block or []:
            try:
                f = k[0]
                price = k[1][0][1]
                if not price or price <= 0:
                    continue
                segs = []
                for s in f[2]:
                    seg = {"f": s[3], "t": s[6], "dd": _d(s[20]), "dt": _t(s[8]), "ad": _d(s[21]), "at": _t(s[10]), "m": s[11]}
                    try:        # compagnia e numero del volo: servono al sito e alla pagina dei ritorni (returns.py)
                        c = s[22]
                        if c[0] and c[1]:
                            seg["c"], seg["n"] = str(c[0]), str(c[1])
                            if c[3]:
                                seg["a"] = str(c[3])
                    except Exception:
                        pass
                    segs.append(seg)
                if not segs:
                    continue
                ly = {}
                try:            # citta' degli aeroporti di scalo: [minuti, arrivo, ripartenza, _, nome, citta', nome, citta']
                    for x in f[13] or []:
                        if x[1] and x[5]: ly[str(x[1])] = str(x[5])
                        if x[2] and x[7]: ly[str(x[2])] = str(x[7])
                except Exception:
                    pass
                if seen is not None:
                    key = (price, f[9], tuple((x["f"], x["t"], x["dd"], x["dt"]) for x in segs))
                    if key in seen:
                        continue
                    seen.add(key)
                row = {"price": price, "al": list(f[1] or []), "dur": f[9], "segs": segs, "best": best}
                if ly:
                    row["ly"] = ly
                out.append(row)
            except Exception:
                continue
    return out

def spec(q):
    """Query di fast-flights -> (origine, destinazione, andata, ritorno | None, max scali | None)."""
    fd = list(q.flight_data)
    a = fd[0]
    ms = a.max_stops if a.HasField("max_stops") else None
    return a.from_airport.airport, a.to_airport.airport, a.date, (fd[1].date if len(fd) > 1 else None), ms

def api_body(o, d, dep, ret=None, ms=None):
    """Corpo della POST a GetShoppingResults. Scali: 0 = qualsiasi, 1 = diretto, 2 = max 1, 3 = max 2.
    Il penultimo blocco (1, 1, 0, 2) = ordina per "migliori", elenco completo (non solo i primi)."""
    st = {0: 1, 1: 2, 2: 3}.get(ms, 0)
    seg = lambda a, b, day: [[[[a, 0]]], [[[b, 0]]], None, st, [], [], day, None, [], [], [], None, None, [], 3]
    segs = [seg(o, d, dep)] + ([seg(d, o, ret)] if ret else [])
    flt = [[], [None, None, 1 if ret else 2, None, [], 1, [1, 0, 0, 0], None, None, None, None, None, None, segs, None, None, None, 1], 1, 1, 0, 2]
    return "f.req=" + urllib.parse.quote(json.dumps([None, json.dumps(flt, separators=(",", ":"))], separators=(",", ":")))

def parse_api(text):
    """-> (status, flights). 'ok' | 'empty' (risposta valida senza voli) | 'error' (ErrorResponse o risposta illeggibile)."""
    out, seen, valid, err = [], set(), False, False
    for ln in text.split(chr(10)):
        if not ln.startswith("[["):
            continue
        try:
            items = json.loads(ln)
        except Exception:
            continue
        for it in items:
            if not isinstance(it, list) or not it or it[0] != "wrb.fr":
                continue
            if len(it) > 2 and it[2]:
                try:
                    _rows(json.loads(it[2]), out, seen); valid = True
                except Exception:
                    err = True
            else:
                err = True
    if out:
        return "ok", out
    return ("empty" if valid and not err else "error"), []

def fetch_api(o, d, dep, ret=None, ms=None, tries=None):
    """GetShoppingResults. -> (status, flights) con status 'ok' | 'empty' | 'error'. Solleva Blocked su 429 / captcha."""
    body = api_body(o, d, dep, ret, ms).encode()
    st, fl = "error", []
    for a in range(tries or API_TRIES):
        try:
            res = client().post(API, params={"hl": "it", "gl": "IT", "curr": "EUR"}, content=body,
                                headers={"content-type": "application/x-www-form-urlencoded;charset=UTF-8"})
        except Exception:
            time.sleep(1 + a + random.random()); client(reset=True)
            continue
        with _slock:
            api_stats["http"] += 1
        if res.status_code in (429, 403) or "/sorry/" in (res.url or ""):
            raise Blocked("HTTP %s" % res.status_code)
        st, fl = parse_api(res.text) if res.status_code == 200 else ("error", [])
        if st != "error":
            break
        time.sleep(0.4 + a * 0.6 + random.random() * 0.5)   # ErrorResponse: casuale, un altro tentativo spesso risponde
    with _slock:
        api_stats["calls"] += 1; api_stats[st] += 1
    return st, fl

def build(o, d, dep, ret=None):
    fl = [FlightQuery(date=dep, from_airport=o, to_airport=d)]
    if ret:
        fl.append(FlightQuery(date=ret, from_airport=d, to_airport=o))
    return create_query(flights=fl, trip="round-trip" if ret else "one-way", passengers=Passengers(adults=1), currency="EUR", language="it")

def _ld(tag, b):
    """Campo protobuf a lunghezza delimitata (lunghezza varint)."""
    n, v = len(b), b""
    while True:
        v += bytes([(n & 0x7F) | (0x80 if n > 0x7F else 0)]); n >>= 7
        if not n:
            return bytes([tag]) + v + b


class ReturnQuery:
    """Pagina "scegli il ritorno" di un A/R: la stessa ricerca A/R con i voli dell'andata gia' scelti (tfs come lo
    scrive il browser dopo il clic sull'andata). La pagina HTML porta i ritorni di QUEL biglietto, con il prezzo
    totale A/R: stessa richiesta leggera delle altre pagine, nessuna chiamata a GetShoppingResults.
    segs = segmenti dell'andata con "c" (compagnia) e "n" (numero del volo)."""
    def __init__(self, o, d, dep, ret, ms, segs):
        e = lambda s: str(s).encode()
        sel = b"".join(_ld(0x22, _ld(0x0A, e(s["f"])) + _ld(0x12, e(s["dd"])) + _ld(0x1A, e(s["t"])) + _ld(0x2A, e(s["c"])) + _ld(0x32, e(s["n"]))) for s in segs)
        leg = lambda day, a, b, extra=b"": _ld(0x1A, _ld(0x12, e(day)) + extra + (bytes([0x28, ms]) if ms is not None else b"") + _ld(0x6A, _ld(0x12, e(a))) + _ld(0x72, _ld(0x12, e(b))))
        raw = leg(dep, o, d, sel) + leg(ret, d, o) + bytes([0x42, 1, 1, 0x48, 1, 0x98, 1, 1])
        import base64
        self.tfs = base64.urlsafe_b64encode(raw).decode()

    def params(self):
        return {"tfs": self.tfs, "hl": "it", "curr": "EUR"}


def fetch(q, tries=3):
    """-> (status, flights). Solleva Blocked su 429/captcha persistente.
    Pagina vuota -> ripiego su GetShoppingResults: 'empty' resta solo se anche li' non ci sono voli (o da' errore).
    q = query di fast-flights oppure ReturnQuery (per quella nessun ripiego: resta la sola pagina)."""
    last = None
    for a in range(tries):
        try:
            res = client().get(URL, params=q.params())
            if res.status_code in (429, 403) or "/sorry/" in (res.url or ""):
                raise Blocked("HTTP %s" % res.status_code)
            if res.status_code != 200:
                raise RuntimeError("HTTP %s" % res.status_code)
            st, fl = parse_html(res.text)
            if st == "nodata" and a < tries - 1:
                time.sleep(2 + a * 3 + random.random())
                client(reset=True)
                continue
            if st == "empty" and API_ON and hasattr(q, "flight_data"):

                st2, fl2 = fetch_api(*spec(q))
                if st2 == "ok":
                    return "ok", fl2
            return st, fl
        except Blocked as e:
            last = e
            time.sleep(20 + a * 30 + random.random() * 5)
            client(reset=True)
        except Exception as e:
            last = e
            time.sleep(2 + a * 3 + random.random())
            client(reset=True)   # dopo un errore h2 ("excessive load") la connessione va rifatta
    if isinstance(last, Blocked):
        raise last
    return "error", []
