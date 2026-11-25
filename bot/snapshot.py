# -*- coding: utf-8 -*-
"""Normalizza le fonti delle dashboard in bot/snapshot.json (lista di offerte uniformi).

Uso:  python bot/snapshot.py [--raw FILE] [--trips FILE] [--weekend URL|file|none] [--out bot/snapshot.json]

Fonti di default (nella radice del repo):
  agosto 2027    raw.jsonl + raw_v2.jsonl: si leggono quelli che esistono, in quest'ordine, e per la stessa query vince
                 raw_v2.jsonl (la riscansione con le nuove origini). Con --raw si legge solo il file indicato.
  popular trips  trips_data.json, altrimenti trips_raw_v2.jsonl, altrimenti trips_raw.jsonl.
Origini: qualsiasi codice IATA che compare nei dati viene accettato (LIN, MXP, FCO, PSA, ...). Il prezzo e' sempre e solo
quello del volo: nessun costo di treno o posizionamento viene aggiunto. L'origine fa parte dell'id dell'offerta.

Offerta:
  {id, target, source, kind, code, name, country, origin, dep, ret, nights, price_pp, stops, airlines, url, ...}
  source  "agosto2027" | "popular" | "weekend"
  kind    "roundtrip" | "openjaw" | "weekend"
  target  ID usato da preferiti e deep link: d_<IATA> destinazione agosto, t_<slug> popular trip, w_<IATA> weekend
  id      <target>:<origine>:<andata>:<ritorno>   es. d_TBS:MXP:2027-08-07:2027-08-18
  price_pp  prezzo A/R per persona in euro (le query sono per 1 adulto)
  campi extra facoltativi: via (scali), dur (minuti andata), price_1stop (solo se stops=2), dep_time, ret_from (open-jaw)
  est = True: il prezzo NON e' un A/R ma la somma di due solo andata (estimate.py), per le celle dove Google non da'
        l'A/R; price_out / price_ret = le due tratte, stops = scali della tratta peggiore. Va sempre dichiarata come stima.
Regola scali (come build.py): max 1 scalo; 2 scali solo se risparmio >= 25% e >= 150 euro pp sul miglior 1 scalo.

Popular trips, due ingressi (--trips):
 1) trips_data.json prodotto da build_trips.py (PREFERITO, verificato sui dati veri). trips_raw.jsonl contiene solo le
    singole tratte ("OW|da|a|data|ms"): e' build_trips.py a comporre gli open-jaw come somma di due solo-andata, quindi
    il bot legge il risultato gia' composto:  trips[].{id,name,countries,air[],cov[],cells[]}, legs[]
      cella   = {dep, n, o, a:[opzioni <=1 scalo, dalla piu' economica], b: opzione 2 scali che rispetta la regola | null}
      opzione = [indice in air, prezzo voli Google pp, extra stimato pp, indice leg andata, indice leg ritorno | -1]
    price_pp = voli + extra (extra = tratte stimate per chiudere il giro, riportato in extra_est); ID = t_<id del trip>.
 2) un .jsonl generico "una riga per combinazione" (adattatore tollerante, utile se il formato cambia):
      slug (id, trip, trip_id), name (n, title), country, origin (o, from), dest_in (to, in, arr, code),
      dest_out (out, ret_from, back_from: rientro open-jaw), dep, ret (date ISO), price_pp (price, pp) oppure
      price_total + pax, stops (max_stops), airlines (al), url (link); oppure stile raw.jsonl con k="ORIG|IN|OUT|andata|ritorno[|ms]"
      e fl=[{price, al, segs}]. Le righe "OW|..." e quelle non interpretabili sono contate in sources.popular e ignorate.
Se --trips manca: vedi "Fonti di default" sopra."""
import argparse, importlib.util, json, re, sys, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C

IATA = re.compile(r"^[A-Z]{3}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def pick(d, *names):
    for n in names:
        if d.get(n) not in (None, "", []):
            return d[n]
    return None


def read_jsonl(path):
    rows, bad = [], 0
    with open(path, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            try:
                r = json.loads(ln)
                if isinstance(r, dict):
                    rows.append(r)
                else:
                    bad += 1
            except ValueError:
                bad += 1
    return rows, bad


def load_dests(root):
    """Anagrafica destinazioni da dests.py (solo dati). Se manca, nome = codice."""
    p = Path(root) / "dests.py"
    if not p.exists():
        return {}
    try:
        sys.dont_write_bytecode = True  # non lasciare .pyc nella cartella della dashboard
        spec = importlib.util.spec_from_file_location("_dests", p)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return {d["code"]: d for d in m.DESTS}
    except Exception as e:
        print("dests.py non leggibile (%s): uso i codici come nomi" % type(e).__name__)
        return {}


def load_covers(root):
    """Foto di copertina dal manifest del sito (img/manifest.json di photos.py): {id meta: "img/file.webp"}."""
    try:
        m = json.loads((Path(root) / "img" / "manifest.json").read_text(encoding="utf-8"))
        ph = m.get("photos") or {}
        out = {"d_" + c: ph[k]["f"] for c, k in (m.get("cover") or {}).items() if k in ph and ph[k].get("f")}
        out.update({"t_" + c: ph[k]["f"] for c, k in (m.get("pop") or {}).items() if k in ph and ph[k].get("f")})
        return out
    except Exception:
        return {}


def sig(f):
    return (f["price"], tuple((s["f"], s["t"], s["dt"]) for s in f["segs"]))


def load_estimates(root, raw, dests):
    """Stime "somma di due solo andata" per le celle senza A/R: estimate.py della radice sui solo andata di
    trips_raw_v2.jsonl. [] se manca uno dei due (o se qualcosa va storto: le offerte vere non devono dipenderne)."""
    root = Path(root)
    if not (root / "estimate.py").exists() or not (root / "trips_raw_v2.jsonl").exists():
        return []
    try:
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(root))
        try:
            import estimate
        finally:
            sys.path.remove(str(root))
        return estimate.combos(raw, estimate.load(str(root / "trips_raw_v2.jsonl")), list(dests.values()) or None)
    except Exception as e:
        print("stime non calcolate (%s: %s)" % (type(e).__name__, str(e)[:120]))
        return []


def flight_fields(f):
    s = f["segs"]
    return {"stops": len(s) - 1, "airlines": list(f.get("al") or []), "via": [x["t"] for x in s[:-1]], "dur": f.get("dur"), "dep_time": s[0].get("dt")}


# ---------- agosto 2027 ----------
def adapt_raw(paths, cfg, dests):
    """paths: uno o piu' file nello stesso formato; per la stessa chiave vince l'ultimo file dell'elenco."""
    raw, bad = {}, 0
    paths = [paths] if isinstance(paths, (str, Path)) else list(paths)
    for path in paths:
        rows, b = read_jsonl(path)
        bad += b
        raw.update({r["k"]: r for r in rows if isinstance(r.get("k"), str) and "st" in r})
    targets, offers = {}, []
    for code, d in dests.items():
        targets["d_" + code] = {"source": "agosto2027", "code": code, "name": d["city"], "country": d["country"], "q": 0, "ok": 0}
        if d.get("tab"):
            targets["d_" + code]["tab"] = d["tab"]  # "new" = Nuove mete, "vis" = Gia' visitati (alerts.py: digest_tabs)
        if d.get("g"):
            targets["d_" + code]["clima"] = d["g"]  # giudizio sul clima di agosto: alerts.py tiene fuori dal digest gli "sconsigliato"
    for k, r in raw.items():
        try:
            o, dc, dep, ret, ms = k.split("|")
        except ValueError:
            bad += 1
            continue
        if not (IATA.match(o) and IATA.match(dc) and ISO.match(dep) and ISO.match(ret)):
            bad += 1  # es. righe "OW|..." finite nel file sbagliato
            continue
        if ms != "2":
            continue
        tid = "d_" + dc
        t = targets.setdefault(tid, {"source": "agosto2027", "code": dc, "name": dc, "country": "", "q": 0, "ok": 0})
        t["q"] += 1
        if r["st"] != "ok":
            continue
        t["ok"] += 1
        r1 = raw.get("%s|%s|%s|%s|1" % (o, dc, dep, ret)) or {}
        f1 = sorted(r1.get("fl") or [], key=lambda f: (f["price"], f.get("dur") or 0))
        if not f1:
            continue  # nessuna opzione con max 1 scalo: fuori regola, come nella dashboard
        s1 = {sig(f) for f in f1}
        # f2 = opzioni che richiedono 2 scali in almeno una tratta (stessa definizione di build.py)
        f2 = sorted([f for f in (r.get("fl") or []) if sig(f) not in s1 and not (len(f["segs"]) - 1 <= 1 and f["price"] >= f1[0]["price"])],
                    key=lambda f: (f["price"], f.get("dur") or 0))
        best, extra = f1[0], {}
        if f2:
            p1, p2 = f1[0]["price"], f2[0]["price"]
            if p1 - p2 >= cfg["two_stops_min_eur"] and (p1 - p2) / p1 >= cfg["two_stops_min_pct"]:
                best, extra = f2[0], {"price_1stop": p1, "stops": 2}
        off = {"id": "%s:%s:%s:%s" % (tid, o, dep, ret), "target": tid, "source": "agosto2027", "kind": "roundtrip", "code": dc,
               "name": t["name"], "country": t["country"], "origin": o, "dep": dep, "ret": ret, "nights": days(dep, ret),
               "price_pp": best["price"], "url": C.gf_url(o, dc, dep, ret)}
        off.update(flight_fields(best))
        off.update(extra)
        offers.append(off)
    n_est = 0
    for e in (load_estimates(Path(paths[-1]).parent, raw, dests) if paths else []):
        if not e["a"]:
            continue  # solo con 2 scali: fuori regola, come sopra
        tid = "d_" + e["d"]
        t = targets.setdefault(tid, {"source": "agosto2027", "code": e["d"], "name": e["d"], "country": "", "q": 0, "ok": 0})
        out, back = e["b"] or e["a"]
        off = {"id": "%s:%s:%s:%s" % (tid, e["o"], e["dep"], e["ret"]), "target": tid, "source": "agosto2027", "kind": "roundtrip", "code": e["d"],
               "name": t["name"], "country": t["country"], "origin": e["o"], "dep": e["dep"], "ret": e["ret"], "nights": e["n"],
               "price_pp": out["price"] + back["price"], "url": C.gf_url(e["o"], e["d"], e["dep"], e["ret"]),
               "est": True, "price_out": out["price"], "price_ret": back["price"]}
        off.update(flight_fields(out))
        off["stops"] = max(off["stops"], len(back["segs"]) - 1)
        off["airlines"] += [a for a in (back.get("al") or []) if a not in off["airlines"]]
        if e["b"]:
            off["price_1stop"] = e["a"][0]["price"] + e["a"][1]["price"]
        offers.append(off)
        t["est"] = t.get("est", 0) + 1
        n_est += 1
    return offers, targets, {"ok": True, "queries": len(raw), "bad_lines": bad, "files": [Path(p).name for p in paths], "estimates": n_est,
                             "origins": sorted({o["origin"] for o in offers})}


# ---------- popular trips ----------
def adapt_trips(path, cfg, dests):
    rows, bad = read_jsonl(path)
    best, targets, skipped, ow = {}, {}, bad, 0
    for r in rows:
        try:
            if str(r.get("k") or "").startswith("OW|"):
                ow += 1  # singola tratta solo-andata: la compone build_trips.py, qui non basta a fare un'offerta
                continue
            origin = pick(r, "origin", "o", "from")
            d_in = pick(r, "dest_in", "to", "in", "arr", "code", "dest", "d")
            d_out = pick(r, "dest_out", "out", "ret_from", "back_from")
            dep, ret = pick(r, "dep", "out_date", "dep_date"), pick(r, "ret", "back_date", "ret_date")
            ms = pick(r, "stops", "max_stops")
            if isinstance(r.get("k"), str):
                p = r["k"].split("|")
                di = [i for i, x in enumerate(p) if ISO.match(x)]
                if len(di) >= 2 and di[0] >= 2:
                    origin, d_in = origin or p[0], d_in or p[1]
                    if di[0] >= 3:
                        d_out = d_out or p[2]
                    dep, ret = dep or p[di[0]], ret or p[di[1]]
                    if len(p) > di[1] + 1 and p[di[1] + 1].isdigit() and ms is None:
                        ms = int(p[di[1] + 1])
            if r.get("st") == "empty":
                name = pick(r, "name", "n", "title")
                sl = C.slug(pick(r, "slug", "id", "trip", "trip_id") or name or "")
                if sl:
                    targets.setdefault("t_" + sl, {"source": "popular", "code": d_in or "", "name": name or sl, "country": r.get("country") or "", "q": 0, "ok": 0})["q"] += 1
                continue
            price, extra = pick(r, "price_pp", "pp", "price"), {}
            if price is None and r.get("price_total"):
                price = float(r["price_total"]) / max(1, int(r.get("pax") or 2))
            airlines = pick(r, "airlines", "al") or []
            if isinstance(airlines, str):
                airlines = [a.strip() for a in re.split(r"[,+]", airlines) if a.strip()]
            fl = [f for f in (r.get("fl") or []) if isinstance(f, dict) and f.get("price") and f.get("segs")]
            if fl:  # stile raw.jsonl: stessa regola scali della dashboard
                ok1 = sorted([f for f in fl if len(f["segs"]) - 1 <= 1], key=lambda f: f["price"])
                two = sorted([f for f in fl if len(f["segs"]) - 1 == 2], key=lambda f: f["price"])
                f = ok1[0] if ok1 else None
                if f and two and f["price"] - two[0]["price"] >= cfg["two_stops_min_eur"] and (f["price"] - two[0]["price"]) / f["price"] >= cfg["two_stops_min_pct"]:
                    extra, f = {"price_1stop": f["price"]}, two[0]
                if f is None:
                    skipped += 1
                    continue
                price = f["price"]
                extra.update(flight_fields(f))
                airlines = extra.pop("airlines")
                ms = extra.pop("stops")
            name = pick(r, "name", "n", "title")
            sl = C.slug(pick(r, "slug", "id", "trip", "trip_id") or name or "")
            if not (sl and origin and d_in and dep and ret and price) or not (ISO.match(dep) and ISO.match(ret)):
                skipped += 1
                continue
            price = int(round(float(price)))
            ms = int(ms) if ms is not None else None
            if price <= 0 or (ms is not None and ms > 2):
                skipped += 1
                continue
            tid = "t_" + sl
            dd = dests.get(d_in, {})
            t = targets.setdefault(tid, {"source": "popular", "code": d_in, "name": name or sl, "country": r.get("country") or dd.get("country") or "", "q": 0, "ok": 0})
            t["q"] += 1
            t["ok"] += 1
            oj = bool(d_out and d_out != d_in)
            off = {"id": "%s:%s:%s:%s" % (tid, origin, dep, ret), "target": tid, "source": "popular", "kind": "openjaw" if oj else "roundtrip",
                   "code": d_in, "name": t["name"], "country": t["country"], "origin": origin, "dep": dep, "ret": ret, "nights": days(dep, ret),
                   "price_pp": price, "stops": ms, "airlines": airlines,
                   "url": pick(r, "url", "link") or (None if oj else C.gf_url(origin, d_in, dep, ret))}
            if oj:
                off["ret_from"] = d_out
            off.update(extra)
            if off["id"] not in best or price < best[off["id"]]["price_pp"]:
                best[off["id"]] = off
        except Exception:
            skipped += 1
    st = {"ok": True, "format": "jsonl", "rows": len(rows), "skipped": skipped}
    if ow:
        st.update(one_way_legs=ow, note="tratte solo-andata ignorate: passare trips_data.json (build_trips.py)")
    return list(best.values()), targets, st


def ow_url(f, t, d):
    return "https://www.google.com/travel/flights?q=%s&curr=EUR&hl=it" % urllib.parse.quote("Flights from %s to %s on %s one way" % (f, t, d))


def adapt_trips_data(path, cfg):
    blob = json.loads(Path(path).read_text(encoding="utf-8"))
    legs, offers, targets, skipped = blob.get("legs") or [], [], {}, 0
    for t in blob.get("trips") or []:
        try:
            sl = t["id"] if re.fullmatch(r"[a-z0-9-]{2,58}", str(t["id"])) else C.slug(t["id"])
            tid, air = "t_" + sl, t.get("air") or []
            country = ", ".join(t.get("countries") or [])
            cov = t.get("cov") or []
            targets[tid] = {"source": "popular", "code": t.get("arr") or "", "name": t["name"], "country": country,
                            "q": sum(c[0] for c in cov), "ok": sum(c[1] for c in cov)}
            if t.get("g"):
                targets[tid]["clima"] = t["g"]
            if sl != str(t["id"]):
                targets[tid]["page_id"] = str(t["id"])  # il link #/t/<id> usa l'id originale del trip
        except Exception:
            skipped += 1
            continue
        for c in t.get("cells") or []:
            try:
                if not c.get("a"):
                    continue  # solo opzioni con 2 scali: fuori regola
                op, extra = c["a"][0], {}
                if c.get("b"):
                    extra, op = {"price_1stop": op[1] + op[2], "stops": 2}, c["b"]
                a = air[op[0]]
                out = legs[op[3]]
                back = legs[op[4]] if len(op) > 4 and op[4] is not None and op[4] >= 0 else None
                dep, ret = c["dep"], (date.fromisoformat(c["dep"]) + timedelta(days=c["n"])).isoformat()
                oj = bool(a.get("k") == "ow" and a.get("b") and a["b"] != a["a"])
                al = []
                for lg in (out, back):
                    for x in (lg[1].split(" + ") if lg else []):
                        if x and x not in al:
                            al.append(x)
                off = {"id": "%s:%s:%s:%s" % (tid, c["o"], dep, ret), "target": tid, "source": "popular", "kind": "openjaw" if oj else "roundtrip",
                       "code": a["a"], "name": t["name"], "country": country, "origin": c["o"], "dep": dep, "ret": ret, "nights": c["n"],
                       "price_pp": int(round(op[1] + op[2])), "stops": max(out[3], back[3] if back else 0), "airlines": al,
                       "via": [x for x in str(out[7]).split("·") if x], "dur": out[2], "dep_time": out[4],
                       "url": ow_url(c["o"], a["a"], dep) if oj else C.gf_url(c["o"], a["a"], dep, ret)}
                if oj:
                    off["ret_from"] = a["b"]
                    off["url_ret"] = ow_url(a["b"], back[9] if back else c["o"], ret)
                if op[2]:
                    off["extra_est"] = op[2]
                if "page_id" in targets[tid]:
                    off["page_id"] = targets[tid]["page_id"]
                off.update(extra)
                offers.append(off)
            except Exception:
                skipped += 1
    return offers, targets, {"ok": True, "format": "trips_data.json", "trips": len(targets), "skipped": skipped}


# ---------- weekend (flightsMI, sola lettura) ----------
def read_text(src):
    if re.match(r"^https?://", src):
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0 (flights-bot)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")
    return Path(src).read_text(encoding="utf-8")


def js_const(html, name):
    for ln in html.split("\n"):
        ln = ln.strip()
        if ln.startswith("const %s = " % name):
            return json.loads(ln[len("const %s = " % name):].rstrip().rstrip(";"))
    raise ValueError("const %s non trovata" % name)


def adapt_weekend(src, today=None):
    """DATA = righe {origin,dest,city,dep,ret,dep_time,arr_time,airline,price} (diretti, prezzo A/R 'da');
    PAIRS["orig|dest|dep|dep_time"] = {ora_ritorno: prezzo esatto}. RETURNS (orari di rientro) non serve ai prezzi."""
    html = read_text(src)
    data = js_const(html, "DATA")
    try:
        pairs = js_const(html, "PAIRS")
    except ValueError:
        pairs = {}
    today = today or date.today().isoformat()
    best, targets = {}, {}
    for h in data:
        try:
            if h["dep"] < today or not IATA.match(h["dest"]):
                continue
            price = h["price"]
            pp = [v for v in (pairs.get("%s|%s|%s|%s" % (h["origin"], h["dest"], h["dep"], h["dep_time"])) or {}).values() if isinstance(v, (int, float)) and v > 0]
            if pp:
                price = min(price, min(pp))
            tid = "w_" + h["dest"]
            targets.setdefault(tid, {"source": "weekend", "code": h["dest"], "name": h["city"], "country": "", "q": 0, "ok": 0})
            off = {"id": "%s:%s:%s:%s" % (tid, h["origin"], h["dep"], h["ret"]), "target": tid, "source": "weekend", "kind": "weekend",
                   "code": h["dest"], "name": h["city"], "country": "", "origin": h["origin"], "dep": h["dep"], "ret": h["ret"],
                   "nights": days(h["dep"], h["ret"]), "price_pp": int(round(price)), "stops": 0,
                   "airlines": [a.strip() for a in str(h.get("airline") or "").split(",") if a.strip()], "dep_time": h.get("dep_time"),
                   "url": C.gf_url(h["origin"], h["dest"], h["dep"], h["ret"])}
            if off["id"] not in best or off["price_pp"] < best[off["id"]]["price_pp"]:
                best[off["id"]] = off
        except Exception:
            continue
    return list(best.values()), targets, {"ok": True, "rows": len(data)}


def build(raw=None, trips=None, weekend=None, cfg=None, today=None, root=None):
    cfg = cfg or C.load_config()
    root = Path(root) if root else (Path(raw).parent if raw else C.ROOT)
    raws = [Path(raw)] if raw else [root / n for n in ("raw.jsonl", "raw_v2.jsonl")]
    raws = [p for p in raws if p.exists()]
    cand = [root / n for n in ("trips_data.json", "trips_raw_v2.jsonl", "trips_raw.jsonl")]
    trips = Path(trips) if trips else next((p for p in cand if p.exists()), cand[0])
    weekend = weekend if weekend is not None else cfg.get("weekend_source")
    dests = load_dests(root)
    offers, targets, sources = [], {}, {}
    jobs = [("agosto2027", bool(raws), lambda: adapt_raw(raws, cfg, dests)),
            ("popular", trips.exists(), lambda: adapt_trips_data(trips, cfg) if trips.suffix == ".json" else adapt_trips(trips, cfg, dests)),
            ("weekend", bool(weekend) and weekend != "none", lambda: adapt_weekend(weekend, today))]
    for name, present, fn in jobs:
        if not present:
            sources[name] = {"ok": False, "reason": "assente"}
            continue
        try:
            o, t, st = fn()
        except Exception as e:
            sources[name] = {"ok": False, "reason": "%s: %s" % (type(e).__name__, str(e)[:120])}
            continue
        offers += o
        targets.update(t)
        st["offers"] = len(o)
        sources[name] = st
    covers = load_covers(root)
    for tid, t in targets.items():
        img = covers.get(tid) or covers.get("t_" + str(t.get("page_id") or ""))
        if img:
            t["img"] = img
    by = {}
    for o in offers:
        by.setdefault(o["target"], []).append(o["price_pp"])
    for tid, t in targets.items():
        t["n"] = len(by.get(tid, []))
        t["min"] = min(by[tid]) if tid in by else None
    offers.sort(key=lambda o: o["id"])
    return {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": sources, "targets": targets, "offers": offers}


def lite(snap, alt=3):
    """Versione ridotta per il Worker (comandi /top, /meta, preferiti): per ogni meta l'offerta migliore e le prime
    `alt` con date diverse, piu' l'elenco di tutti i prezzi (targets[id]["prices"]) per i conteggi. Stesso schema."""
    by = C.by_target(snap)
    targets = {tid: dict(t) for tid, t in snap["targets"].items()}
    offers = []
    for tid, lst in by.items():
        keep, seen = [lst[0]], {(lst[0]["dep"], lst[0]["ret"])}
        for o in lst[1:]:
            if len(keep) > alt:
                break
            if (o["dep"], o["ret"]) not in seen:
                seen.add((o["dep"], o["ret"]))
                keep.append(o)
        offers += keep
        targets.setdefault(tid, {})["prices"] = [o["price_pp"] for o in lst]
    return {"generated": snap.get("generated"), "lite": True, "sources": snap.get("sources", {}), "targets": targets, "offers": offers}


def main():
    ap = argparse.ArgumentParser(description="Normalizza le fonti in snapshot.json")
    ap.add_argument("--raw", help="un solo file; default: raw.jsonl + raw_v2.jsonl (vince v2)")
    ap.add_argument("--trips", help="trips_data.json (preferito) oppure un .jsonl generico")
    ap.add_argument("--weekend", help="URL o file dell'index.html di flightsMI, oppure 'none'")
    ap.add_argument("--out", default=str(C.BOT_DIR / "snapshot.json"))
    a = ap.parse_args()
    snap = build(a.raw, a.trips, a.weekend)
    Path(a.out).write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    small = lite(snap)
    lp = Path(a.out).with_name(Path(a.out).stem + "_lite.json")
    lp.write_text(json.dumps(small, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    for name, st in snap["sources"].items():
        print("%-11s %s" % (name, st))
    print("snapshot ridotto per il Worker: %d offerte, %d KB -> %s" % (len(small["offers"]), lp.stat().st_size // 1024, lp))
    print("snapshot: %d offerte, %d mete (%d con voli) -> %s" % (len(snap["offers"]), len(snap["targets"]),
          sum(1 for t in snap["targets"].values() if t["n"]), a.out))
    if not any(s.get("ok") for s in snap["sources"].values()):
        sys.exit("ERRORE: nessuna fonte leggibile")


if __name__ == "__main__":
    main()
