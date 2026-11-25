# -*- coding: utf-8 -*-
"""Coordinate delle tappe (itinerari delle mete e Popular trips) -> stage_coords.json, usato da build_v2.py per la mappa del giro.

Si lancia a mano, una volta, quando si aggiungono mete o giri (serve data.json: python build_v2.py):
    python stage_coords.py            geocodifica solo le tappe che mancano in stage_coords.json
    python stage_coords.py --report   non chiama la rete: elenca le tappe senza coordinate e quelle da controllare
    python stage_coords.py --repick   rifa' la scelta del risultato per tutte le voci non corrette a mano (usa la cache)
    python stage_coords.py --retry    riprova anche le tappe rimaste senza coordinate
Geocoder: Nominatim (OpenStreetMap), secondo le sue regole: una richiesta al secondo, User-Agent che identifica lo script,
risposte tenute in cache (stage_geocache.tmp, fuori dal repo) cosi' una ripresa non rifa' le stesse domande.
Ogni tappa e' cercata dentro un riquadro attorno alla meta (o agli aeroporti del giro), cosi' un nome uguale in un altro
paese non vince. Le voci con "src": "manual" sono state corrette a mano e non vengono mai riscritte ("was" = coordinate
scartate). "seen" = voce segnata ma gia' controllata a mano a quella data: --report non la ripropone (--repick la toglie).
Chiave: "<nome tappa>|<paese della meta o paesi del giro>".  flag = motivo per cui la voce va guardata (vedi FLAGS)."""
import json, math, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "stage_coords.json")
CACHE = os.path.join(ROOT, "stage_geocache.tmp")
UA = "agosto2027-site/1.0 (geocodifica una tantum delle tappe)"
URL = "https://nominatim.openstreetmap.org/search"
PAUSE = 1.1                      # secondi tra due richieste (regola Nominatim: al massimo 1 al secondo)
BOX = (14.0, 18.0)               # mezzo lato del riquadro di ricerca attorno all'ancora: gradi di latitudine, di longitudine
FAR_KM = 1300                    # oltre questa distanza dall'ancora la voce va controllata
JUNK_TYPES = {"shop", "highway", "road", "residential", "building", "amenity", "office", "railway", "trunk", "primary", "secondary", "tertiary",
              "unclassified", "track", "path", "footway", "bridge", "isolated_dwelling", "neighbourhood", "craft", "man_made", "house", "commercial", "industrial"}
SAME_IMP = 0.03                  # candidati con importanza entro questo scarto dal migliore: tra loro vince il piu' vicino alla meta
OUTLIER_KM = 450                 # una tappa a piu' di cosi' da ogni altra tappa dello stesso giro va controllata
AREA_TYPES = {"country", "state", "region", "province", "county", "state_district", "archipelago", "continent"}
FLAGS = {"area": "il risultato e' una regione, non un punto: la coordinata e' il suo centro", "poi": "il risultato e' una via, un negozio o un edificio",
         "ambiguous": "piu' luoghi con questo nome a oltre 300 km l'uno dall'altro: scelto il piu' importante (a parita', il piu' vicino alla meta)",
         "othercountry": "trovata solo in un paese diverso da quello della meta", "outlier": "lontana da tutte le altre tappe dello stesso giro",
         "approx": "messa a mano in un punto rappresentativo (barca, trekking, zona senza un centro)", "missing": "non trovata",
         "variant": "trovata cercando solo una parte del nome", "far": "lontana dalla meta", "unbounded": "trovata nel paese ma fuori dal riquadro della meta"}
# paese come scritto in dests.py / popular_trips.py -> (codici ISO per countrycodes, nomi con cui Nominatim chiude l'indirizzo in italiano)
COUNTRY = {
    "Angola": ("ao", ("Angola",)), "Argentina": ("ar", ("Argentina",)), "Armenia": ("am", ("Armenia",)),
    "Australia": ("au", ("Australia",)), "Azerbaigian": ("az", ("Azerbaigian",)), "Azzorre (Portogallo)": ("pt", ("Portogallo",)),
    "Bolivia": ("bo", ("Bolivia",)), "Botswana": ("bw", ("Botswana",)), "Brasile": ("br", ("Brasile",)),
    "Canada": ("ca", ("Canada",)), "Capo Verde": ("cv", ("Capo Verde",)), "Cile": ("cl", ("Cile",)),
    "Cina": ("cn", ("Cina",)), "Costa Rica": ("cr", ("Costa Rica",)), "Ecuador": ("ec", ("Ecuador",)),
    "Emirati Arabi": ("ae", ("Emirati Arabi Uniti",)), "Fiji": ("fj", ("Figi",)), "Filippine": ("ph", ("Filippine",)),
    "Fær Øer (Danimarca)": ("fo", ("Fær Øer", "Isole Fær Øer", "Faroe", "Danimarca",)), "Gabon": ("ga", ("Gabon",)), "Georgia": ("ge", ("Georgia",)),
    "Giappone": ("jp", ("Giappone",)), "Giordania": ("jo", ("Giordania",)), "Groenlandia (Danimarca)": ("gl", ("Groenlandia", "Danimarca",)),
    "Guatemala": ("gt", ("Guatemala",)), "India": ("in", ("India",)), "Indonesia": ("id", ("Indonesia",)),
    "Islanda": ("is", ("Islanda",)), "Kazakistan": ("kz", ("Kazakistan",)), "Kenya": ("ke", ("Kenya",)),
    "Kirghizistan": ("kg", ("Kirghizistan",)), "Madagascar": ("mg", ("Madagascar",)), "Madeira (Portogallo)": ("pt", ("Portogallo",)),
    "Malawi": ("mw", ("Malawi",)), "Malesia": ("my", ("Malesia",)), "Marocco": ("ma", ("Marocco",)),
    "Mauritius": ("mu", ("Mauritius",)), "Messico": ("mx", ("Messico",)), "Mongolia": ("mn", ("Mongolia",)),
    "Mozambico": ("mz", ("Mozambico",)), "Namibia": ("na", ("Namibia",)), "Norvegia": ("no", ("Norvegia",)),
    "Nuova Zelanda": ("nz", ("Nuova Zelanda",)), "Pakistan": ("pk", ("Pakistan",)), "Perù": ("pe", ("Perù",)),
    "Polinesia Francese": ("pf,fr", ("Francia", "Polinesia francese",)), "Riunione (Francia)": ("re,fr", ("Francia", "Riunione",)), "Rwanda": ("rw", ("Ruanda",)),
    "Scozia (Regno Unito)": ("gb", ("Regno Unito",)), "Seychelles": ("sc", ("Seychelles",)), "Singapore": ("sg", ("Singapore",)),
    "Sri Lanka": ("lk", ("Sri Lanka",)), "Stati Uniti": ("us", ("Stati Uniti d'America",)), "Sudafrica": ("za", ("Sudafrica",)),
    "Svalbard (Norvegia)": ("sj,no", ("Norvegia", "Svalbard e Jan Mayen",)), "São Tomé e Príncipe": ("st", ("São Tomé e Príncipe", "Sao Tomé e Principe",)), "Tagikistan": ("tj", ("Tagikistan",)),
    "Tanzania": ("tz", ("Tanzania",)), "Thailandia": ("th", ("Thailandia",)), "Turchia": ("tr", ("Turchia",)),
    "Uganda": ("ug", ("Uganda",)), "Zambia": ("zm", ("Zambia",)), "Zimbabwe": ("zw", ("Zimbabwe",)),
}
# aeroporti dei giri che non sono tra le mete di dests.COORDS (lat, lon; fonte OurAirports)
EXTRA_AIRPORTS = {"CPH": (55.62, 12.65), "GRU": (-23.43, -46.47), "GYE": (-2.16, -79.88), "KUT": (42.18, 42.48), "MDC": (1.55, 124.93),
                  "MYY": (4.32, 113.99), "OSS": (40.61, 72.79), "PHX": (33.43, -112.01), "SFO": (37.62, -122.38), "YDF": (49.21, -57.39), "YVR": (49.19, -123.18)}

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(h)))

def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return default

def save(path, obj, **kw):
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, **kw)
        f.write("\n")
    os.replace(tmp, path)

def airports():
    sys.path.insert(0, ROOT)
    import dests
    a = {k: [round(v[0], 4), round(v[1], 4)] for k, v in dests.COORDS.items()}
    for k, v in EXTRA_AIRPORTS.items():
        a.setdefault(k, [v[0], v[1]])
    return a

def wanted(air):
    """{chiave: {"name", "ctx", "anchors": [(lat, lon), ...]}} per tutte le tappe mostrate dal sito (da data.json)."""
    raw = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))["raw"]
    out = {}
    dest = {d["code"]: d for d in raw["dests"]}
    for code, itins in raw["trips"].items():
        d = dest.get(code)
        if not d or d.get("lat") is None:
            continue
        for it in itins:
            for s in it["t"]:
                out.setdefault("%s|%s" % (s[0], d["country"]), {"name": s[0], "ctx": d["country"], "anchors": []})["anchors"].append((d["lat"], d["lon"]))
    for t in raw["trips_popular"]["trips"]:
        ctx = "+".join(t["countries"])
        an = [tuple(air[c]) for c in (t["arr"], t["dep"]) if c in air]
        for s in t["stages"]:
            out.setdefault("%s|%s" % (s[0], ctx), {"name": s[0], "ctx": ctx, "anchors": []})["anchors"].extend(an)
    return out

def variants(name):
    """Il nome intero, poi le sue parti: dentro e fuori dalle parentesi, prima di ' e ', ' o ', '/', '+', ','."""
    v = [name]
    m = re.match(r"^(.*?)\s*\((.*?)\)\s*(.*)$", name)
    if m:
        v += [m.group(2), (m.group(1) + " " + m.group(3)).strip()]
    for x in list(v):
        p = re.split(r"\s+(?:e|o|ed)\s+|\s*/\s*|\s*\+\s*|\s*,\s*|\s+[-–]\s+", x)
        if len(p) > 1:
            v.append(p[0])
    seen, res = set(), []
    for x in v:
        x = x.strip(" .")
        if len(x) >= 3 and x.lower() not in seen:
            seen.add(x.lower()); res.append(x)
    return res

class Geo:
    def __init__(self):
        self.cache = load(CACHE, {})
        self.last = 0.0
        self.calls = 0

    def ask(self, q, box=None, cc=None):
        p = {"q": q, "format": "jsonv2", "limit": 5, "accept-language": "it", "addressdetails": 0}
        if box:
            p.update({"viewbox": "%.2f,%.2f,%.2f,%.2f" % box, "bounded": 1})
        if cc:
            p["countrycodes"] = ",".join(cc)
        key = urllib.parse.urlencode(sorted(p.items()))
        if key in self.cache:
            return self.cache[key]
        wait = PAUSE - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(URL + "?" + key, headers={"User-Agent": UA})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.loads(r.read().decode("utf-8"))
                break
            except Exception as e:      # rete o limite: si aspetta e si riprova, poi si lascia la tappa per la prossima volta
                time.sleep(5 * (attempt + 1))
                data = None
        self.last = time.time(); self.calls += 1
        if data is None:
            return None
        self.cache[key] = [{"lat": float(x["lat"]), "lon": float(x["lon"]), "name": x.get("display_name", ""), "type": x.get("addresstype") or x.get("type") or "",
                            "imp": round(float(x.get("importance") or 0), 3)} for x in data]
        if self.calls % 20 == 0:
            save(CACHE, self.cache)
        return self.cache[key]

def countries(ctx):
    """Paesi del contesto ("Georgia+Armenia") -> (codici ISO per Nominatim, nomi con cui Nominatim chiude l'indirizzo in italiano)."""
    cc, names = [], set()
    for c in ctx.split("+"):
        codes, ends = COUNTRY.get(c, ("", ()))
        cc += [x for x in codes.split(",") if x and x not in cc]
        names.update(ends)
    return cc, names

def rank(res, an, names):
    """Ordina i candidati: prima quelli nel paese giusto, poi luoghi veri prima di regioni e di vie/negozi, poi per importanza
    (a pari importanza il piu' vicino alla meta). -> (migliore, nel paese?, ambiguo?)"""
    if not res:
        return None, False, False
    dist = lambda r: min(km((r["lat"], r["lon"]), a) for a in an)
    inc = lambda r: not names or r["name"].split(", ")[-1] in names
    kind = lambda r: 2 if r["type"] in JUNK_TYPES else 1 if r["type"] in AREA_TYPES else 0
    pool = [r for r in res if inc(r)] or res
    k0 = min(kind(r) for r in pool)
    pool = [r for r in pool if kind(r) == k0]
    top = max(r["imp"] for r in pool)
    best = min([r for r in pool if top - r["imp"] <= SAME_IMP], key=dist)
    amb = any(km((r["lat"], r["lon"]), (best["lat"], best["lon"])) > 300 for r in pool)
    return best, inc(best), amb

def find(geo, w):
    """1) nome (e sue parti) dentro il riquadro della meta, tenendo i risultati nel paese giusto; 2) se non ce ne sono, la stessa
    ricerca in tutto il paese (countrycodes); 3) in mancanza d'altro il risultato di un altro paese dentro il riquadro, segnato."""
    an = w["anchors"]
    lat = [a[0] for a in an]; lon = [a[1] for a in an]
    box = (min(lon) - BOX[1], max(lat) + BOX[0], max(lon) + BOX[1], min(lat) - BOX[0])      # x1,y1,x2,y2 = ovest, nord, est, sud
    cc, names = countries(w["ctx"])
    vs = variants(w["name"])
    def entry(r, q, i, extra, amb):
        d = min(km((r["lat"], r["lon"]), a) for a in an)
        flags = [f for f, on in (("variant", i > 0), ("far", d > FAR_KM), ("area", r["type"] in AREA_TYPES), ("poi", r["type"] in JUNK_TYPES), ("ambiguous", amb)) if on] + extra
        e = {"lat": round(r["lat"], 4), "lon": round(r["lon"], 4), "q": q, "name": r["name"], "type": r["type"], "km": int(round(d)), "src": "nominatim"}
        if flags:
            e["flag"] = flags
        return e
    other = None
    for i, q in enumerate(vs):
        res = geo.ask(q, box)
        if res is None:
            return None
        r, ok, amb = rank(res, an, names)
        if r and ok:
            return entry(r, q, i, [], amb)
        if r and other is None:
            other = (r, q, i)
    if cc:
        for i, q in enumerate(vs):
            res = geo.ask(q, None, cc)
            if res is None:
                return None
            r, ok, amb = rank(res, an, set())
            if r:
                return entry(r, q, i, ["unbounded"], amb)
    if other:
        return entry(other[0], other[1], other[2], ["othercountry"], False)
    return {"lat": None, "lon": None, "q": vs[0], "src": "nominatim", "flag": ["missing"]}

def outliers(doc):
    """Tappe lontane da tutte le altre dello stesso giro (di solito un omonimo sbagliato): {chiave: km dalla tappa piu' vicina}."""
    raw = json.load(open(os.path.join(ROOT, "data.json"), encoding="utf-8"))["raw"]
    dest = {d["code"]: d for d in raw["dests"]}
    groups = [([s[0] for s in it["t"]], dest[c]["country"]) for c, its in raw["trips"].items() if c in dest for it in its]
    groups += [([s[0] for s in t["stages"]], "+".join(t["countries"])) for t in raw["trips_popular"]["trips"]]
    out = {}
    for names, ctx in groups:
        pts = [(n, doc["places"].get("%s|%s" % (n, ctx)) or {}) for n in names]
        pts = [(n, (p["lat"], p["lon"])) for n, p in pts if p.get("lat") is not None]
        for n, ll in pts:
            others = [km(ll, o) for m, o in pts if o != ll]
            if len(others) >= 2 and min(others) > OUTLIER_KM:
                k = "%s|%s" % (n, ctx)
                out[k] = max(out.get(k, 0), int(min(others)))
    return out

def report(doc, want):
    pl = doc["places"]
    miss = sorted(k for k in want if k not in pl or pl[k].get("lat") is None)
    flagged = sorted(k for k in want if k in pl and pl[k].get("lat") is not None and pl[k].get("flag") and pl[k].get("src") != "manual")
    seen = [k for k in flagged if pl[k].get("seen")]
    flagged = [k for k in flagged if not pl[k].get("seen")]
    ok = sum(1 for k in want if k in pl and pl[k].get("lat") is not None)
    print("tappe: %d | con coordinate: %d (a mano: %d, di cui indicative: %d) | segnate e gia' guardate: %d | da guardare: %d | senza coordinate: %d" % (
        len(want), ok, sum(1 for k in want if pl.get(k, {}).get("src") == "manual"), sum(1 for k in want if "approx" in pl.get(k, {}).get("flag", [])),
        len(seen), len(flagged), len(miss)))
    for k in flagged:
        e = pl[k]
        print("  ? %-55s %s  [%s, %d km] %s" % (k[:55], ",".join(e["flag"]), e.get("type", ""), e.get("km", -1), e.get("name", "")[:70]))
    for k in miss:
        print("  - senza coordinate:", k)

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    air = airports()
    want = wanted(air)
    doc = load(OUT, {})
    doc.setdefault("places", {})
    doc["_about"] = "Coordinate delle tappe per la mappa del giro. Generato da stage_coords.py (Nominatim / OpenStreetMap, ODbL); le voci src=manual sono corrette a mano."
    doc["airports"] = air
    if "--report" not in sys.argv:
        geo = Geo()
        if "--repick" in sys.argv:      # rifa' la scelta per tutte le voci non corrette a mano (dalla cache: di norma senza rete)
            doc["places"] = {k: v for k, v in doc["places"].items() if v.get("src") == "manual"}
        todo = [k for k in want if k not in doc["places"] or (doc["places"][k].get("lat") is None and doc["places"][k].get("src") != "manual" and "--retry" in sys.argv)]
        print("da geocodificare:", len(todo), "di", len(want))
        for n, k in enumerate(todo):
            e = find(geo, want[k])
            if e is None:
                print("rete: mi fermo, si riprende dalla cache"); break
            doc["places"][k] = e
            if n % 25 == 24:
                save(OUT, doc, indent=0, sort_keys=True)
                print("  %d/%d" % (n + 1, len(todo)), flush=True)
        save(CACHE, geo.cache)
    far = outliers(doc)
    for k, e in doc["places"].items():
        fl = [f for f in e.get("flag", []) if f != "outlier"] + (["outlier"] if k in far and e.get("src") != "manual" else [])
        e.pop("flag", None)
        if fl:
            e["flag"] = fl
    doc["places"] = {k: doc["places"][k] for k in sorted(doc["places"])}
    save(OUT, doc, indent=0, sort_keys=True)
    report(doc, want)

if __name__ == "__main__":
    main()
