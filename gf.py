# -*- coding: utf-8 -*-
"""Fetch + parser tollerante per Google Flights (basato su flightsMI/pipeline.py).
Differenze dal parser di fast-flights: legge sia i voli "migliori" (payload[2]) sia gli "altri"
(payload[3]), salta le singole righe malformate invece di far fallire tutta la pagina,
ed estrae la durata totale del viaggio."""
import json, random, threading, time
from primp import Client
from selectolax.lexbor import LexborHTMLParser
from fast_flights import FlightQuery, Passengers, create_query

URL = "https://www.google.com/travel/flights"
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
    out = []
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
                    segs.append({"f": s[3], "t": s[6], "dd": _d(s[20]), "dt": _t(s[8]), "ad": _d(s[21]), "at": _t(s[10]), "m": s[11]})
                if not segs:
                    continue
                out.append({"price": price, "al": list(f[1] or []), "dur": f[9], "segs": segs, "best": best})
            except Exception:
                continue
    return ("ok" if out else "empty"), out

def build(o, d, dep, ret=None):
    fl = [FlightQuery(date=dep, from_airport=o, to_airport=d)]
    if ret:
        fl.append(FlightQuery(date=ret, from_airport=d, to_airport=o))
    return create_query(flights=fl, trip="round-trip" if ret else "one-way", passengers=Passengers(adults=1), currency="EUR", language="it")

def fetch(q, tries=3):
    """-> (status, flights, http_bytes). Solleva Blocked su 429/captcha persistente."""
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
