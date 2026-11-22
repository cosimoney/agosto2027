# -*- coding: utf-8 -*-
"""template_v2.html + v2.css + v2.js + dati + img/manifest.json -> agosto-2027-v2.html

Dati: esegue in memoria build.py (RAW) e build_trips.py (RAW.trips_popular) senza far loro scrivere nulla
(agosto-2027.html e trips_data.json restano come sono).
Foto: solo quelle davvero presenti in img/. Uso: python build_v2.py [--raw v1|v2|auto]
Storico prezzi: bot/state/price_history.json (price_history.py) entra nel blob come RAW.hist, in forma compatta e solo
per le mete e i trip della pagina; se il file manca il grafico dell'andamento non compare.
"""
import io, json, os, re, sys, types, contextlib

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT); sys.path.insert(0, ROOT)
OUTPUTS = {"agosto-2027.html", "trips_data.json", "origins.json"}   # file che build.py / build_trips.py scriverebbero: qui non si toccano

def _open(path, mode="r", *a, **k):
    if ("w" in mode or "a" in mode) and os.path.basename(str(path)) in OUTPUTS:
        return io.StringIO()
    return open(path, mode, *a, **k)

def run(mod, raw):
    """Esegue build.py / build_trips.py in memoria (stesso codice, nessun file scritto) e restituisce il modulo.
    raw = 'v2' (raw_v2.jsonl, trips_raw_v2.jsonl) oppure 'v1' (raw.jsonl, trips_raw.jsonl: scansione precedente, solo LIN e MXP)."""
    src = open(mod + ".py", encoding="utf-8").read()
    if raw == "v1":
        src = src.replace("trips_raw_v2.jsonl", "trips_raw.jsonl").replace("raw_v2.jsonl", "raw.jsonl")
    m = types.ModuleType(mod)
    m.__file__ = os.path.join(ROOT, mod + ".py"); m.open = _open
    sys.modules[mod] = m
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(src, mod + ".py", "exec"), m.__dict__)
    return m

def load_data(raw):
    os.environ.pop("RAW", None)
    for k in ("build", "build_trips"): sys.modules.pop(k, None)
    trips = run("build_trips", raw).blob      # prima, cosi' un eventuale "import build_trips" dentro build.py riusa questo
    blob = dict(run("build", raw).blob)
    blob.setdefault("trips_popular", trips)
    return blob

def valid(blob):
    return len({c["d"] for c in blob["combos"] if c["a"]}) + sum(1 for t in blob["trips_popular"]["trips"] if t["best"])

def pick():
    """--raw v1 | v2 | auto (default). auto = la scansione che oggi da' piu' mete e trip con voli validi:
    finche' la nuova scansione (4 aeroporti) e' in corso vince la precedente, poi passa da sola alla nuova."""
    want = sys.argv[sys.argv.index("--raw") + 1] if "--raw" in sys.argv else "auto"
    res, err = {}, {}
    for raw in (["v2", "v1"] if want == "auto" else [want]):
        try:
            res[raw] = load_data(raw)
        except BaseException as e:
            err[raw] = repr(e)
    if not res:
        raise SystemExit("dati non caricabili: %s" % err)
    best = max(res, key=lambda r: valid(res[r]))
    return res[best], "scansione %s (%s)" % (best, ", ".join("%s: %d con voli" % (r, valid(b)) for r, b in res.items()) + ("; errori: %s" % err if err else ""))

def manifest():
    p = os.path.join("img", "manifest.json")
    man = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
    ph = {k: v for k, v in man.get("photos", {}).items() if os.path.exists(os.path.join(ROOT, v["f"]))}
    return {"photos": ph, "cover": {c: k for c, k in man.get("cover", {}).items() if k in ph},
            "gallery": {c: [k for k in ks if k in ph] for c, ks in man.get("gallery", {}).items()},
            "pop": {c: k for c, k in man.get("pop", {}).items() if k in ph}, "stage": [x for x in man.get("stage", []) if x[1] in ph]}

def worker_url():
    """Base del Worker dei preferiti: variabile WORKER_URL, altrimenti "worker_url" in bot/config.json. '' = stella solo via Telegram."""
    u = os.environ.get("WORKER_URL") or ""
    if not u:
        try:
            u = json.load(open(os.path.join("bot", "config.json"), encoding="utf-8")).get("worker_url") or ""
        except (OSError, ValueError):
            u = ""
    u = u.strip().rstrip("/")
    return u if re.fullmatch(r"https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/-]*)?", u) else ""

def history(blob):
    """RAW.hist: storico del prezzo piu' basso per target (vedi price_history.compact)."""
    try:
        import price_history
        ids = {"d_" + d["code"] for d in blob["dests"]} | {"t_" + t["id"] for t in blob["trips_popular"]["trips"]}
        return price_history.compact(price_history.load(), ids)
    except Exception as e:
        print("storico prezzi non caricato:", repr(e))
        return {"days": [], "runs": [], "e": [], "t": {}}

def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

def main():
    blob, src1 = pick()
    blob["hist"] = history(blob)
    man = manifest()
    js = open("v2.js", encoding="utf-8").read()
    assert "/*__DATA__*/" in js and "/*__PHOTOS__*/" in js and "/*__API__*/" in js
    api = worker_url()
    js = js.replace("/*__API__*/", api, 1).replace("/*__DATA__*/", dump(blob), 1).replace("/*__PHOTOS__*/", dump(man), 1)
    tpl = open("template_v2.html", encoding="utf-8").read()
    out = tpl.replace("/*__CSS__*/", open("v2.css", encoding="utf-8").read(), 1).replace("/*__JS__*/", js, 1)
    open("agosto-2027-v2.html", "w", encoding="utf-8", newline="\n").write(out)
    sys.stdout.reconfigure(encoding="utf-8")
    codes = {c["d"] for c in blob["combos"] if c["a"]}
    pop = [t["id"] for t in blob["trips_popular"]["trips"] if t["best"]]
    print("dati:", src1)
    print("storico prezzi:", len(blob["hist"]["days"]), "giorni,", len(blob["hist"]["t"]), "target,", len(dump(blob["hist"])), "caratteri")
    print("preferiti:", "Worker " + api if api else "solo link Telegram (worker_url non impostato)")
    print("html bytes", len(out.encode("utf-8")), "| foto", len(man["photos"]), "| mete con voli", len(codes), "senza cover:", sorted(codes - set(man["cover"])),
          "| trip con voli", len(pop), "senza cover dedicata:", sorted(set(pop) - set(man["pop"])), "| origini:", sorted({c["o"] for c in blob["combos"]}))

if __name__ == "__main__":
    main()
