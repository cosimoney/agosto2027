# -*- coding: utf-8 -*-
"""Voli interni dei Popular trips: prezzo reale letto su Google Flights al posto della stima fissa del catalogo.

Il catalogo (popular_trips.py) porta i voli interni come etichetta + stima in euro: ("Lima-Cusco", 70). Qui ogni etichetta
ha le sue tratte con gli aeroporti e il giorno del giro in cui si vola (giorno di partenza dall'Italia + notti gia' passate
nelle tappe prima): LEGS. Per ogni tratta si legge la PAGINA html di Google Flights (gf.fetch: mai GetShoppingResults),
solo andata oppure A/R quando l'etichetta e' un'andata e ritorno, con al massimo 1 scalo, e si tiene il prezzo piu' basso
(economy, 1 adulto, tariffa base: sulle low cost di solito senza bagaglio da stiva).

Se tutte le tratte di un'etichetta hanno un prezzo letto, quello sostituisce la stima (ed entra nel totale del giro) e il
sito lo segna «prezzo reale»; altrimenti resta la stima del catalogo, segnata «stima». Le etichette che non sono voli
(via terra, traghetti) o che Google non vende (piccoli aerei dei parchi, biglietti combinati) non stanno in LEGS.

Date: si chiede la tratta nel giorno giusto per la partenza piu' economica del giro. Una riga letta vale per tutte le
date del giro (i voli interni cambiano poco da un giorno all'altro): se la data migliore cambia, la riga vecchia resta in
uso finche' non arriva quella nuova.

Quante richieste: poche. INT_MAX per giro (default 60) e INT_BUDGET_MIN minuti (default 12); le righe lette restano valide
INT_KEEP giri (default 7), poi si rileggono dalle piu' vecchie (le pagine tornate vuote gia' dopo 2 giri). Prima le tratte mai lette, dai giri piu' economici.

Dati: internal_v2.jsonl sul branch "data", una riga per chiave:
  IO|da|a|giorno            {"st", "fl": [solo andata, dal piu' economico], "age"}
  IR|da|a|andata|ritorno    {"st", "fl": [andate dell'A/R con il prezzo totale], "age"}

  python internal.py show          cosa c'e' e cosa manca (nessuna richiesta)
  python internal.py run [MAX]     legge le tratte mancanti (richieste vere: poche in locale)
"""
import json, os, random, sys, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

FILE = os.environ.get("INTERNAL", "internal_v2.jsonl")
MAX_REQ = int(os.environ.get("INT_MAX") or 60)
BUDGET_MIN = float(os.environ.get("INT_BUDGET_MIN") or 12)
KEEP = int(os.environ.get("INT_KEEP") or 7)
KEEP_EMPTY = 2              # una pagina tornata senza voli si richiede prima: spesso e' solo vuota quel giorno
WORKERS = int(os.environ.get("INT_WORKERS") or 2)
MS = 1                      # al massimo 1 scalo anche sui voli interni
MAX_BLOCKED = 3
ONLY = set(filter(None, (os.environ.get("INT_ONLY") or "").split(",")))   # prove: solo questi giri (id)
lock = threading.Lock()
stats = {"req": 0, "ok": 0, "empty": 0, "fail": 0, "blocked": 0}

# giro -> etichetta del catalogo -> tratte. Tratta = (da, a, giorno) solo andata | (da, a, giorno, giorno del rientro) A/R.
# giorno = notti gia' passate quando si prende il volo (0 = giorno della partenza dall'Italia). Le tratte "per chiudere il
# giro" degli A/R su un hub stanno a inizio giro (giorno 1: si arriva il giorno dopo) o alla fine (ultimo giorno).
LEGS = {
    "bali-lombok": {"Lombok-Bali (volo Wings Air)": [("LOP", "DPS", 10)]},
    "bali-flores-komodo": {"Bali-Labuan Bajo A/R": [("DPS", "LBJ", 5, 8)]},
    "malesia-borneo": {"Kuala Lumpur-Kota Bharu": [("KUL", "KBR", 2)], "Kota Bharu-Sandakan (via KUL)": [("KBR", "SDK", 5)],
                       "Sandakan-Kota Kinabalu": [("SDK", "BKI", 8)], "Kota Kinabalu-Kuala Lumpur": [("BKI", "KUL", 10)]},
    "hokkaido": {"Tokyo-Sapporo A/R": [("HND", "CTS", 1, 10)]},
    "tanzania-safari-zanzibar": {"Zanzibar-Arusha": [("ZNZ", "ARK", 1)], "Zanzibar-Kilimanjaro": [("ZNZ", "JRO", 10)]},
    "kenya-zanzibar": {"Nairobi-Zanzibar": [("NBO", "ZNZ", 6)], "Zanzibar-Nairobi": [("ZNZ", "NBO", 10)]},
    "namibia-vicfalls": {"Windhoek-Victoria Falls": [("WDH", "VFA", 8)], "Victoria Falls-Windhoek": [("VFA", "WDH", 10)]},
    "botswana-vicfalls": {"Johannesburg-Maun": [("JNB", "MUB", 1)], "Victoria Falls-Johannesburg": [("VFA", "JNB", 10)],
                          "Victoria Falls-Maun": [("VFA", "MUB", 1)]},
    "sudafrica-kruger-garden": {"Nelspruit-Gqeberha": [("MQP", "PLZ", 4)], "Kruger/Nelspruit-Gqeberha (via JNB)": [("MQP", "PLZ", 4)],
                                "Città del Capo-Johannesburg": [("CPT", "JNB", 10)]},
    "madagascar-rn7": {"Tuléar-Antananarivo": [("TLE", "TNR", 9)]},
    "reunion-mauritius": {"Réunion-Mauritius": [("RUN", "MRU", 6)]},
    "peru-classico": {"Lima-Cusco": [("LIM", "CUZ", 3)], "Cusco-Lima": [("CUZ", "LIM", 10)]},
    "peru-bolivia": {"Lima-Cusco": [("LIM", "CUZ", 1)], "La Paz-Uyuni A/R": [("LPB", "UYU", 8, 10)], "La Paz-Lima": [("LPB", "LIM", 10)]},
    "atacama-uyuni": {"Santiago-Calama": [("SCL", "CJC", 2)], "Uyuni-La Paz": [("UYU", "LPB", 8)], "La Paz-Santiago": [("LPB", "SCL", 10)]},
    "ecuador-galapagos": {"Quito-Galápagos": [("UIO", "GPS", 4)], "Galápagos-Guayaquil": [("GPS", "GYE", 9)], "Guayaquil-Quito": [("GYE", "UIO", 10)]},
    "argentina-nord": {"Buenos Aires-Iguazú": [("AEP", "IGR", 3)], "Iguazú-Salta": [("IGR", "SLA", 5)], "Salta-Buenos Aires": [("SLA", "AEP", 10)]},
    "argentina-bariloche": {"Buenos Aires-Bariloche": [("AEP", "BRC", 4)], "Bariloche-Buenos Aires": [("BRC", "AEP", 10)]},
    "brasile-rota-emocoes": {"Fortaleza-São Luís": [("FOR", "SLZ", 1)]},
    "canada-rockies": {"Vancouver-Calgary": [("YVR", "YYC", 1)]},
    "giava-bali": {"Giacarta-Yogyakarta": [("CGK", "YIA", 1)], "Bali-Yogyakarta": [("DPS", "YIA", 1)]},
    "brasile-rio-iguacu": {"Rio-Foz do Iguaçu A/R": [("GIG", "IGU", 8, 10)]},
    "cina-via-della-seta": {"Pechino-Urumqi": [("PEK", "URC", 1)], "Lanzhou-Pechino": [("LHW", "PEK", 10)]},
    "cina-qinghai-gansu": {"Pechino-Xining A/R": [("PEK", "XNN", 1, 10)]},
    "flores-komodo-kelimutu": {"Bali-Labuan Bajo": [("DPS", "LBJ", 3)], "Ende-Bali (due tratte)": [("ENE", "DPS", 10)]},
    "sulawesi-toraja-bunaken": {"Makassar-Manado": [("UPG", "MDC", 6)], "Manado-Makassar": [("MDC", "UPG", 11)]},
    "baku-tbilisi": {"Tbilisi-Baku": [("TBS", "GYD", 11)]},
    "atacama-uyuni-salta": {"Santiago-Calama": [("SCL", "CJC", 1)], "Salta-Santiago (via Buenos Aires)": [("SLA", "SCL", 11)],
                            "Buenos Aires-Calama (via Santiago)": [("EZE", "CJC", 1)], "Salta-Buenos Aires": [("SLA", "AEP", 11)]},
    "pantanal-bonito": {"Cuiabá-Campo Grande (via San Paolo o Brasilia)": [("CGB", "CGR", 6)], "San Paolo-Cuiabá": [("GRU", "CGB", 1)],
                        "Campo Grande-San Paolo": [("CGR", "GRU", 11)]},
    "messico-oaxaca": {"Oaxaca-Città del Messico": [("OAX", "MEX", 11)]},
    "azzorre-isole": {"Ponta Delgada-Pico": [("PDL", "PIX", 4)], "Horta-Terceira": [("HOR", "TER", 8)], "Terceira-Ponta Delgada": [("TER", "PDL", 10)]},
    "groenlandia-nuuk-ilulissat": {"Nuuk-Ilulissat": [("GOH", "JAV", 2)]},
    "kruger-mozambico": {"Mbombela (Kruger)-Vilanculos": [("MQP", "VNX", 4)], "Vilanculos-Johannesburg": [("VNX", "JNB", 10)]},
    "zambia-malawi": {"Lusaka-Mfuwe": [("LUN", "MFU", 1)], "Lilongwe-Lusaka": [("LLW", "LUN", 10)]},
    "capo-verde-isole": {"Praia-Fogo e Praia-São Vicente": [("RAI", "SFL", 2), ("RAI", "VXE", 4)], "Sal-São Vicente A/R": [("SID", "VXE", 1, 10)]},
    "sao-tome-principe": {"São Tomé-Príncipe A/R": [("TMS", "PCP", 6, 10)]},
    "zimbabwe-hwange-mana": {"Harare-Victoria Falls (Fastjet)": [("HRE", "VFA", 10)]},
    "sudafrica-namaqualand-kgalagadi": {"Upington-Città del Capo (Airlink)": [("UTN", "CPT", 10)]},
    "angola-sud": {"Luanda-Lubango e Namibe-Luanda (TAAG)": [("LAD", "SDD", 3), ("MSZ", "LAD", 9)]},
    "peru-nord": {"Lima-Huaraz A/R": [("LIM", "ATA", 1, 5)], "Lima-Chachapoyas o Jaén A/R": [("LIM", "JAE", 6, 10)]},
    "canada-yukon": {"Vancouver-Whitehorse A/R (Air North)": [("YVR", "YXY", 1, 10)]},
    "bali-sumba-komodo": {"Bali-Tambolaka": [("DPS", "TMC", 2)], "Waingapu-Bali": [("WGP", "DPS", 7)], "Bali-Labuan Bajo A/R": [("DPS", "LBJ", 7, 10)]},
    "borneo-tanjung-puting-giava": {"Giacarta-Pangkalan Bun": [("CGK", "PKN", 1)], "Pangkalan Bun-Semarang": [("PKN", "SRG", 4)],
                                    "Yogyakarta-Bali": [("YIA", "DPS", 8)], "Bali-Giacarta": [("DPS", "CGK", 10)]},
    "ladakh-zanskar": {"Delhi-Leh A/R": [("DEL", "IXL", 1, 10)]},
    "sarawak-mulu": {"Kuching-Mulu via Miri": [("KCH", "MZV", 6)], "Miri-Kuching": [("MYY", "KCH", 11)]},
    "islanda-groenlandia-est": {"Reykjavík-Kulusuk A/R (Icelandair)": [("KEF", "KUS", 5, 9)]},
    "usa-california-utah": {"Las Vegas-San Francisco": [("LAS", "SFO", 1)]},
}
LAND = ("terra", "treno", "bus", "traghett", "fast boat", "auto ")   # etichette che non sono voli


def log(*a):
    print(*a, flush=True)


def is_flight(label):
    s = str(label).lower()
    return not any(w in s for w in LAND) or "volo" in s


def count(label):
    """Quanti voli sono un'etichetta: 2 se e' un'andata e ritorno o due tratte, altrimenti 1."""
    s = str(label)
    return 2 if ("A/R" in s or " e " in s or "due tratte" in s) else 1


def load(path=None):
    out = {}
    path = path or FILE
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for ln in f:
                try:
                    r = json.loads(ln); out[r["k"]] = r
                except Exception:
                    pass
    return out


def save(rows, path=None):
    with open(path or FILE, "w", encoding="utf-8", newline="\n") as f:
        for r in rows.values():
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- chiavi e lettura (nessuna richiesta)

def _plus(d, n):
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def key(spec, dep):
    """Chiave della tratta per un giro che parte dall'Italia il giorno dep."""
    if len(spec) == 4:
        return "IR|%s|%s|%s|%s" % (spec[0], spec[1], _plus(dep, spec[2]), _plus(dep, spec[3]))
    return "IO|%s|%s|%s" % (spec[0], spec[1], _plus(dep, spec[2]))


def _prefix(spec):
    return "%s|%s|%s|" % ("IR" if len(spec) == 4 else "IO", spec[0], spec[1])


def _cheapest(r):
    fl = [x for x in (r or {}).get("fl") or [] if x.get("segs") and len(x["segs"]) - 1 <= MS and x.get("price", 0) > 0]
    return min(fl, key=lambda x: (x["price"], x.get("dur") or 0)) if fl else None


def _row(rows, spec, dep=None):
    """Riga con voli per la tratta: quella del giorno giusto se c'e', altrimenti la piu' fresca letta per un altro giorno."""
    if dep:
        r = rows.get(key(spec, dep))
        if r and _cheapest(r):
            return r
    pre = _prefix(spec)
    cand = [r for k, r in rows.items() if k.startswith(pre) and _cheapest(r)]
    return min(cand, key=lambda r: (r.get("age", 0), r["k"])) if cand else None


def lookup(rows, tid, label, dep=None):
    """Prezzo reale di un'etichetta di volo interno. -> {"p": euro pp, "d": giorno del primo volo, "al": compagnie,
    "st": scali (il massimo fra le tratte)} oppure None se anche una sola tratta non e' stata letta (resta la stima)."""
    specs = (LEGS.get(tid) or {}).get(label)
    if not specs:
        return None
    tot, al, st, day = 0, [], 0, None
    for sp in specs:
        r = _row(rows, sp, dep)
        f = _cheapest(r)
        if not f:
            return None
        tot += f["price"]
        st = max(st, len(f["segs"]) - 1)
        for a in f.get("al") or []:
            if a not in al:
                al.append(a)
        day = day or r["k"].split("|")[3]
    return {"p": int(round(tot)), "d": day, "al": al, "st": st}


def entry(rows, tid, e, dep=None):
    """Voce del catalogo (etichetta, stima) -> voce per il sito:
    [etichetta, euro pp usati nel totale, 1 = prezzo reale | 0 = stima, stima del catalogo, giorno letto, compagnie, quanti voli]"""
    label, est = e[0], e[1]
    r = lookup(rows, tid, label, dep) if is_flight(label) else None
    n = count(label) if is_flight(label) else 0
    if r:
        return [label, r["p"], 1, est, r["d"], " + ".join(r["al"]), n]
    return [label, est, 0, est, "", "", n]


# ---------------------------------------------------------------- cosa chiedere

def picks():
    """[{tid, dep, tot}] dai dati correnti: per ogni giro la partenza piu' economica (build_trips.py in memoria)."""
    import build_v2
    sys.modules.pop("build_trips", None)
    out = list(getattr(build_v2.run("build_trips", "v2"), "INT_PICKS", []))
    sys.modules.pop("build_trips", None)
    return [p for p in out if not ONLY or p["tid"] in ONLY]


def plan(pk, rows):
    """Richieste da fare, in ordine: prima le tratte mai lette, poi quelle lette per un altro giorno, poi le piu' vecchie;
    dentro ogni fascia dai giri piu' economici. -> ([(chiave, tratta, giorno di partenza)], chiavi e tratte che servono)"""
    todo, wanted, pairs, seen = [], set(), set(), set()
    for p in sorted(pk, key=lambda p: p["tot"]):
        for label, specs in (LEGS.get(p["tid"]) or {}).items():
            if label not in p["labels"]:
                continue
            for sp in specs:
                k = key(sp, p["dep"])
                wanted.add(k); pairs.add(_prefix(sp))
                if k in seen:
                    continue
                seen.add(k)
                r = rows.get(k)
                if r is None:
                    state = 1 if _row(rows, sp) else 0
                    if state == 1 and any(x.get("age", 0) == 0 for kk, x in rows.items() if kk.startswith(_prefix(sp))):
                        continue           # letta in questo giro per un altro giorno: basta quella
                elif r.get("age", 0) >= (KEEP if _cheapest(r) else KEEP_EMPTY):
                    state = 2
                else:
                    continue
                todo.append(((state, 0 if p["must"].get(label) else 1, p["tot"]), k, sp, p["dep"]))
    todo.sort(key=lambda x: x[0])
    return [x[1:] for x in todo], wanted, pairs


def _query(k):
    from fast_flights import FlightQuery, Passengers, create_query
    p = k.split("|")
    fl = [FlightQuery(date=p[3], from_airport=p[1], to_airport=p[2], max_stops=MS)]
    if p[0] == "IR":
        fl.append(FlightQuery(date=p[4], from_airport=p[2], to_airport=p[1], max_stops=MS))
    return create_query(flights=fl, trip="round-trip" if p[0] == "IR" else "one-way", passengers=Passengers(adults=1), currency="EUR", language="it")


def _slim(fl, n=3):
    return sorted(fl, key=lambda x: (x["price"], x.get("dur") or 0))[:n]


def work(k, rows, state):
    import gf
    with lock:
        if time.time() > state["deadline"] or stats["blocked"] >= MAX_BLOCKED or stats["req"] >= state["max"]:
            return
        stats["req"] += 1
    time.sleep(0.6 + random.random() * 0.9)
    try:
        st, fl = gf.fetch(_query(k), tries=2)
    except gf.Blocked:
        with lock:
            stats["blocked"] += 1
        return
    except Exception:
        st, fl = "error", []
    if st not in ("ok", "empty"):
        with lock:
            stats["fail"] += 1
        return
    with lock:
        rows[k] = {"k": k, "st": st, "fl": _slim(fl), "age": 0}
        stats[st] += 1


def run(budget_min=None, max_req=None, prev=None, bump=True):
    """Aggiorna internal_v2.jsonl. prev = file del giro prima (le righe restano, con age + 1 se bump).
    -> riepilogo per scan_meta.json. Le richieste si fermano al tetto, alla scadenza o dopo MAX_BLOCKED blocchi."""
    t0 = time.time()
    budget_min = BUDGET_MIN if budget_min is None else budget_min
    max_req = MAX_REQ if max_req is None else max_req
    rows = load()
    for k, r in (load(prev) if prev else {}).items():
        if k not in rows:
            rows[k] = dict(r, age=r.get("age", 0) + (1 if bump else 0))
    pk = picks()
    todo, wanted, pairs = plan(pk, rows)
    log("voli interni: %d giri, %d tratte da chiedere (tetto %d richieste, %.0f minuti)" % (len(pk), len(todo), max_req, budget_min))
    state = {"deadline": t0 + budget_min * 60, "max": max_req}
    if todo and max_req > 0 and budget_min > 0:
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            list(as_completed([ex.submit(work, k, rows, state) for k, _, _ in todo[:max_req]]))
    if not ONLY:
        # restano le righe che servono; quelle lette per un altro giorno solo finche' manca la riga del giorno giusto
        pre = lambda k: "|".join(k.split("|")[:3]) + "|"
        have = {pre(k) for k in rows if k in wanted and _cheapest(rows[k])}
        rows = {k: r for k, r in rows.items() if k in wanted or (pre(k) in pairs and pre(k) not in have and r.get("age", 0) < KEEP * 3)}
    save(rows)
    left, _, _ = plan(pk, rows)
    real = sum(1 for p in pk for lb in p["labels"] if lookup(rows, p["tid"], lb))
    res = dict(stats, trips=len(pk), labels=sum(len(p["labels"]) for p in pk), real=real, todo=len(todo), left=len(left), rows=len(rows),
               minutes=round((time.time() - t0) / 60, 1))
    log("VOLI INTERNI", json.dumps(res, ensure_ascii=False))
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "show"
    if cmd == "run":
        run(max_req=int(sys.argv[2]) if len(sys.argv) > 2 else 10, bump=False)
    else:
        rows, pk = load(), picks()
        todo, wanted, _ = plan(pk, rows)
        print("giri con voli interni:", len(pk), "| etichette:", sum(len(p["labels"]) for p in pk), "| con prezzo reale:",
              sum(1 for p in pk for lb in p["labels"] if lookup(rows, p["tid"], lb)), "| righe:", len(rows), "| da chiedere:", len(todo))
        for p in pk:
            for lb in p["labels"]:
                r = lookup(rows, p["tid"], lb)
                print("  %-34s %-46s %s" % (p["tid"], lb, ("%d EUR reale (%s, %s)" % (r["p"], r["d"], " + ".join(r["al"]))) if r else ("stima" if lb in (LEGS.get(p["tid"]) or {}) else "stima (fuori tabella)")))
