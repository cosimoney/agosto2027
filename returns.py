# -*- coding: utf-8 -*-
"""Orari del RITORNO per gli A/R, e tabella degli itinerari (tratte complete) per il sito.

Il problema: la pagina di Google Flights di un A/R elenca solo le andate (con il prezzo totale A/R). Il ritorno di quel
biglietto compare dopo aver scelto l'andata.

Come si ricava (una richiesta per cella, sempre e solo la PAGINA html, mai GetShoppingResults):
  1. gf.ReturnQuery: la stessa ricerca A/R con i voli dell'andata gia' scelti (compagnia + numero di volo di ogni
     tratta, letti dal parser). La pagina porta i ritorni di QUEL biglietto con il prezzo totale: se il piu' economico
     ha lo stesso prezzo dell'A/R e' il ritorno vero del biglietto (kind 1).
  2. ripiego, se l'andata non ha i numeri di volo (righe vecchie) o la pagina torna vuota: solo andata meta -> Italia
     nello stesso giorno e con lo stesso limite di scali; il piu' economico e' un ritorno INDICATIVO (kind 2), sul
     biglietto A/R puo' cambiare.

Quante richieste: non tutte le celle. Prima l'opzione migliore di ogni meta / popular trip per citta' di partenza (quella
che la pagina apre da sola), poi le altre celle dalla piu' economica, fino a RET_MAX richieste (default 2500) e
RET_BUDGET_MIN minuti (default 45) per giro: sono pagine come quelle della scansione (che ne legge circa 21.000 a giro
senza blocchi), quindi un decimo in piu'; al terzo blocco ci si ferma comunque. Le righe gia' lette restano valide finche' andata e prezzo non cambiano
(al massimo RET_KEEP giri, default 6), quindi la copertura cresce di giro in giro senza rifare le stesse richieste.
Un blocco di Google (429 / captcha) mette in pausa tutti per RET_PAUSE secondi; dopo RET_MAX_BLOCKED blocchi ci si ferma.
Nella pipeline questo passo gira PRIMA delle stime: quelle usano GetShoppingResults, che blocca in fretta, e subito dopo
anche le pagine tornano bloccate (giro del 26/11: 4 blocchi su 38 richieste, fermo dopo 33 righe).

Dati: returns_v2.jsonl, una riga per chiave (sta sul branch "data" con gli altri file del giro):
  R|orig|meta|andata|ritorno|ms|BA573-BA245   {"st", "p": prezzo A/R letto, "fl": [ritorni, dal piu' economico], "age"}
  OW|meta|orig|ritorno|ms                     {"st", "fl": [solo andata, dal piu' economico], "age"}

  python returns.py show            cosa c'e' e cosa manca (nessuna richiesta)
  python returns.py run [MAX]       cerca i ritorni mancanti (richieste vere: poche in locale)
"""
import json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

RET = os.environ.get("RETURNS", "returns_v2.jsonl")
MAX_REQ = int(os.environ.get("RET_MAX") or 2500)
BUDGET_MIN = float(os.environ.get("RET_BUDGET_MIN") or 45)
KEEP = int(os.environ.get("RET_KEEP") or 6)          # giri per cui una riga letta resta valida senza rifarla
WORKERS = int(os.environ.get("RET_WORKERS") or 3)
MAX_BLOCKED = int(os.environ.get("RET_MAX_BLOCKED") or 8)   # dopo tanti blocchi (429 / captcha) ci si ferma: restano le righe lette
PAUSE = float(os.environ.get("RET_PAUSE") or 90)             # secondi di pausa per tutti dopo un blocco, come nella scansione
pause_until = [0.0]
ONLY = set(filter(None, (os.environ.get("RET_ONLY") or "").split(",")))   # prove: solo queste mete / hub (codici IATA)
lock = threading.Lock()
stats = {"req": 0, "ok": 0, "empty": 0, "fail": 0, "blocked": 0, "same": 0, "ow": 0}

# citta' degli scali piu' comuni: vale finche' la riga non porta la sua (campo "ly" del parser)
HUBS = {"LHR": "Londra", "LGW": "Londra", "LCY": "Londra", "STN": "Londra", "CDG": "Parigi", "ORY": "Parigi", "AMS": "Amsterdam",
        "FRA": "Francoforte", "MUC": "Monaco di Baviera", "ZRH": "Zurigo", "GVA": "Ginevra", "VIE": "Vienna", "BRU": "Bruxelles",
        "MAD": "Madrid", "BCN": "Barcellona", "LIS": "Lisbona", "OPO": "Porto", "DUB": "Dublino", "CPH": "Copenaghen",
        "ARN": "Stoccolma", "OSL": "Oslo", "HEL": "Helsinki", "WAW": "Varsavia", "ATH": "Atene", "IST": "Istanbul",
        "SAW": "Istanbul", "DOH": "Doha", "DXB": "Dubai", "AUH": "Abu Dhabi", "JED": "Gedda", "RUH": "Riad", "CAI": "Il Cairo",
        "ADD": "Addis Abeba", "CMN": "Casablanca", "TLV": "Tel Aviv", "AMM": "Amman", "KWI": "Kuwait City", "BAH": "Bahrein",
        "MCT": "Mascate", "JFK": "New York", "EWR": "New York", "BOS": "Boston", "IAD": "Washington", "ATL": "Atlanta",
        "ORD": "Chicago", "DFW": "Dallas", "MIA": "Miami", "IAH": "Houston", "LAX": "Los Angeles", "SFO": "San Francisco",
        "SEA": "Seattle", "DEN": "Denver", "YYZ": "Toronto", "YUL": "Montréal", "YVR": "Vancouver", "MEX": "Città del Messico",
        "PTY": "Panama", "BOG": "Bogotá", "LIM": "Lima", "SCL": "Santiago", "GRU": "San Paolo", "GIG": "Rio de Janeiro",
        "EZE": "Buenos Aires", "DEL": "Delhi", "BOM": "Mumbai", "SIN": "Singapore", "KUL": "Kuala Lumpur", "BKK": "Bangkok",
        "HKG": "Hong Kong", "PEK": "Pechino", "PKX": "Pechino", "PVG": "Shanghai", "CAN": "Canton", "ICN": "Seul",
        "NRT": "Tokyo", "HND": "Tokyo", "TPE": "Taipei", "FCO": "Roma", "MXP": "Milano", "LIN": "Milano", "VCE": "Venezia",
        "NAP": "Napoli", "BLQ": "Bologna", "KEF": "Reykjavik", "JNB": "Johannesburg", "NBO": "Nairobi", "SYD": "Sydney",
        "MEL": "Melbourne", "AKL": "Auckland", "TAS": "Tashkent", "ALA": "Almaty", "GYD": "Baku", "TBS": "Tbilisi",
        "BEG": "Belgrado", "OTP": "Bucarest", "BUD": "Budapest", "PRG": "Praga", "DUS": "Düsseldorf", "BER": "Berlino",
        "HAM": "Amburgo", "LYS": "Lione", "NCE": "Nizza", "PMI": "Palma di Maiorca", "TUN": "Tunisi", "ALG": "Algeri"}


def log(*a):
    print(*a, flush=True)


def load(path=None):
    out = {}
    path = path or RET
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                try:
                    r = json.loads(ln); out[r["k"]] = r
                except Exception:
                    pass
    return out


def save(rows, path=None):
    with open(path or RET, "w", encoding="utf-8", newline="\n") as f:
        for r in rows.values():
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- chiavi e lettura (nessuna richiesta)

def sel_key(o, d, dep, ret, ms, f):
    """Chiave del ritorno di un A/R con QUESTA andata; None se l'andata non ha i numeri di volo."""
    segs = f.get("segs") or []
    if not segs or any(not (s.get("c") and s.get("n")) for s in segs):
        return None
    return "R|%s|%s|%s|%s|%d|%s" % (o, d, dep, ret, ms, "-".join(s["c"] + s["n"] for s in segs))


def ow_key(o, d, ret, ms):
    return "OW|%s|%s|%s|%d" % (d, o, ret, ms)


def _cheapest(fl, ms=None):
    fl = [x for x in fl or [] if x.get("segs") and (ms is None or len(x["segs"]) - 1 <= ms)]
    return min(fl, key=lambda x: (x["price"], x.get("dur") or 0)) if fl else None


def lookup(rows, ow, o, d, dep, ret, ms, f):
    """Ritorno da mostrare per l'andata f dell'A/R o->d. -> (volo, kind) | None.
    kind 1 = ritorno dello stesso biglietto A/R (pagina con l'andata scelta, stesso prezzo totale);
    kind 2 = indicativo: il piu' economico del giorno come solo andata, o letto quando il prezzo dell'A/R era un altro;
    kind 3 = ritorno dello stesso biglietto con PIU' scali del limite ms: l'opzione non rispetta la regola scali, chi
             costruisce il sito la scarta (build.py, build_trips.py). Non dovrebbe capitare, perche' la ricerca porta il
             limite su entrambe le tratte: e' una rete di sicurezza se Google lo ignorasse sul ritorno.
    rows = returns_v2.jsonl; ow = righe "OW|..." gia' presenti nei dati del giro (stime e open-jaw), usate come ripiego."""
    k = sel_key(o, d, dep, ret, ms, f)
    r = rows.get(k) if k else None
    if r and r.get("st") == "ok":
        x = _cheapest(r.get("fl"))
        if x and x["price"] == f["price"]:
            return x, (1 if len(x["segs"]) - 1 <= ms else 3)
        x = _cheapest(r.get("fl"), ms)
        if x:
            return x, 2
    for src in (rows, ow or {}):
        for m in ((ms,) if src is rows else (ms, 2, 1)):
            x = _cheapest((src.get(ow_key(o, d, ret, m)) or {}).get("fl"), ms)
            if x:
                return x, 2
    return None


# ---------------------------------------------------------------- tabella degli itinerari (per il sito)

def _days(a, b):
    try:
        return (date.fromisoformat(b) - date.fromisoformat(a)).days
    except Exception:
        return 0


class Itin:
    """Tratte complete dei voli, senza ripetizioni: il sito le legge per indice.
      rows[i] = [[da, a, partenza, arrivo, giorni+ partenza, giorni+ arrivo, minuti, sigla compagnia, numero volo], ...]
                (giorni+ contati dalla data di partenza del volo; sigla e numero mancano nelle righe vecchie)
      al = {sigla: compagnia}    ap = {IATA: citta'} (scali; mete e aeroporti di partenza il sito li conosce gia')"""
    def __init__(self):
        self.rows, self.ix, self.al, self.ap = [], {}, {}, {}

    def add(self, f):
        segs = f.get("segs") or []
        if not segs:
            return -1
        d0 = segs[0].get("dd")
        t = tuple((s["f"], s["t"], s.get("dt") or "", s.get("at") or "", _days(d0, s.get("dd")), _days(d0, s.get("ad")), s.get("m") or 0)
                  + ((s["c"], s["n"]) if s.get("c") and s.get("n") else ()) for s in segs)
        for s in segs:
            if s.get("c") and s.get("a"):
                self.al.setdefault(s["c"], s["a"])
        codes = {s["t"] for s in segs[:-1]} | {s["f"] for s in segs[1:]}
        for c, city in (f.get("ly") or {}).items():
            if c in codes:
                self.ap[c] = city
        for c in codes:
            if c not in self.ap and c in HUBS:
                self.ap[c] = HUBS[c]
        if t not in self.ix:
            self.ix[t] = len(self.rows); self.rows.append([list(x) for x in t])
        return self.ix[t]

    def export(self):
        return {"rows": self.rows, "al": self.al, "ap": self.ap}


# ---------------------------------------------------------------- cosa chiedere

def picks():
    """Opzioni A/R mostrate dal sito, con l'andata scelta: [{o, d, dep, ret, ms, f, tot, tgt}] (build.py e build_trips.py
    eseguiti in memoria, come fa build_v2.py: nessun file scritto)."""
    import build_v2
    out = []
    for mod in ("build_trips", "build"):
        sys.modules.pop(mod, None)
        out += list(getattr(build_v2.run(mod, "v2"), "PICKS", []))
    sys.modules.pop("build", None); sys.modules.pop("build_trips", None)
    return [p for p in out if not ONLY or p["d"] in ONLY]


def plan(pk, rows):
    """Richieste da fare, in ordine: prima l'opzione migliore di ogni voce per citta' di partenza, poi le altre celle
    dalla piu' economica (a giro fra le voci); dentro ogni fascia prima le mancanti, poi quelle con il prezzo cambiato,
    poi le piu' vecchie. -> ([(classe, pick)], chiavi che servono ancora)"""
    import origins
    best, rank, wanted = {}, {}, set()
    for p in sorted(pk, key=lambda p: p["tot"]):
        g = (p["tgt"], origins.GROUP.get(p["o"], p["o"]), p["ms"])
        p["rank"] = rank[g] = rank.get(g, -1) + 1
        best.setdefault(g, p)
    todo = []
    for p in pk:
        k = sel_key(p["o"], p["d"], p["dep"], p["ret"], p["ms"], p["f"])
        k2 = ow_key(p["o"], p["d"], p["ret"], p["ms"])
        wanted.update(x for x in (k, k2) if x)
        r = rows.get(k) if k else None
        if r is None and k2 in rows and (k is None or rows[k2].get("after") == k):
            r = rows[k2]                       # ripiego gia' fatto per questa andata
        if r is None:
            state = 0
        elif r.get("age", 0) >= KEEP:
            state = 2
        elif r.get("st") == "ok" and k and r is rows.get(k) and r.get("p") != p["f"]["price"]:
            state = 1
        else:
            continue                           # letta di recente, andata e prezzo uguali: resta
        todo.append(((p["rank"] > 0 or p["ms"] > 1, state, p["rank"], p["tot"]), p))
    todo.sort(key=lambda x: x[0])
    return [p for _, p in todo], wanted


# ---------------------------------------------------------------- richieste

def _ow_query(o, d, ret, ms):
    from fast_flights import FlightQuery, Passengers, create_query
    fl = [FlightQuery(date=ret, from_airport=d, to_airport=o, max_stops=ms)]
    return create_query(flights=fl, trip="one-way", passengers=Passengers(adults=1), currency="EUR", language="it")


def _slim(fl, n=3):
    return sorted(fl, key=lambda x: (x["price"], x.get("dur") or 0))[:n]


def work(p, rows, state):
    """Una cella: pagina con l'andata scelta, poi (se serve) il solo andata del ritorno. Scrive in rows."""
    import gf
    if time.time() > state["deadline"] or stats["blocked"] >= MAX_BLOCKED:
        return
    o, d, dep, ret, ms, f = p["o"], p["d"], p["dep"], p["ret"], p["ms"], p["f"]
    k, k2 = sel_key(o, d, dep, ret, ms, f), ow_key(o, d, ret, ms)
    steps = ([("sel", k)] if k else []) + [("ow", k2)]
    for kind, key in steps:
        with lock:
            if kind == "ow" and key in rows and rows[key].get("age", 0) < KEEP:
                if rows[key].get("st") != "ok" and k:
                    rows[key]["after"] = k
                return                     # solo andata di quel giorno gia' letto (lo condividono piu' celle)
            if key in state["done"]:

                if kind == "sel" or rows.get(key, {}).get("st") == "ok":
                    return
                continue
            if stats["req"] >= state["max"]:
                return
            stats["req"] += 1; state["done"].add(key)
        w = pause_until[0] - time.time()
        if w > 0:
            time.sleep(min(w, max(0.0, state["deadline"] - time.time())))
        time.sleep(0.6 + random.random() * 0.9)
        try:
            q = gf.ReturnQuery(o, d, dep, ret, ms, f["segs"]) if kind == "sel" else _ow_query(o, d, ret, ms)
            st, fl = gf.fetch(q, tries=2)
        except gf.Blocked:
            with lock:
                stats["blocked"] += 1; state["done"].discard(key)
                pause_until[0] = time.time() + PAUSE
            return
        except Exception:
            st, fl = "error", []
        if st not in ("ok", "empty"):
            with lock:
                stats["fail"] += 1
            return
        row = {"k": key, "st": st, "fl": _slim(fl), "age": 0}
        if kind == "sel":
            row["p"] = f["price"]
        elif k:
            row["after"] = k               # ripiego per questa andata: finche' non cambia non si richiede
        with lock:
            rows[key] = row
            stats[st] += 1
            if kind == "ow":
                stats["ow"] += 1
            elif st == "ok" and _cheapest(fl)["price"] == f["price"]:
                stats["same"] += 1
        if st == "ok":
            return


def run(budget_min=None, max_req=None, prev=None, bump=True):
    """Aggiorna returns_v2.jsonl. prev = file del giro prima (le righe ancora utili restano, con age + 1 se bump).
    -> riepilogo per scan_meta.json. Le richieste si fermano al tetto, alla scadenza o dopo MAX_BLOCKED blocchi."""
    t0 = time.time()
    budget_min = BUDGET_MIN if budget_min is None else budget_min
    max_req = MAX_REQ if max_req is None else max_req
    rows = load()
    for k, r in (load(prev) if prev else {}).items():
        if k not in rows:
            rows[k] = dict(r, age=r.get("age", 0) + (1 if bump else 0))
    pk = picks()
    todo, wanted = plan(pk, rows)
    if not ONLY:
        rows = {k: r for k, r in rows.items() if k in wanted}
    log("ritorni: %d opzioni A/R, %d gia' lette, %d da chiedere (tetto %d richieste, %.0f minuti)" % (len(pk), len(pk) - len(todo), len(todo), max_req, budget_min))
    state = {"deadline": t0 + budget_min * 60, "max": max_req, "done": set()}
    if todo and max_req > 0 and budget_min > 0:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(work, p, rows, state) for p in todo[:max_req * 3]]
            for i, _ in enumerate(as_completed(futs)):
                if (i + 1) % 100 == 0:
                    log("  ritorni %d/%d %s" % (i + 1, len(todo), stats))
    save(rows)
    left, _ = plan(pk, rows)
    res = dict(stats, picks=len(pk), todo=len(todo), left=len(left), rows=len(rows), minutes=round((time.time() - t0) / 60, 1))
    log("RITORNI", json.dumps(res, ensure_ascii=False))
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    if cmd == "run":
        run(max_req=int(sys.argv[2]) if len(sys.argv) > 2 else 20, bump=False)
    else:
        rows, pk = load(), picks()
        todo, wanted = plan(pk, rows)
        nonum = sum(1 for p in pk if not sel_key(p["o"], p["d"], p["dep"], p["ret"], p["ms"], p["f"]))
        print("opzioni A/R:", len(pk), "| senza numeri di volo (righe vecchie):", nonum, "| righe:", len(rows), "| da chiedere:", len(todo),
              "| di cui opzioni migliori:", sum(1 for p in todo if p["rank"] == 0))
