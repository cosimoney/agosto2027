# -*- coding: utf-8 -*-
"""Storico del prezzo piu' basso per meta e per popular trip: bot/state/price_history.json (su main, NON sul branch data).

  python price_history.py update     aggiunge il giro presente nella cartella (raw_v2.jsonl, trips_raw_v2.jsonl, scan_meta.json)
  python price_history.py show ID    stampa le righe di un target (es. d_CMB, t_sri-lanka)

Lo chiama pipeline.py build, dopo build.py / build_trips.py e prima di build_v2.py (che inietta lo storico nel sito).
Il workflow della scansione committa il file insieme allo stato del bot.

Formato (una riga di testo per giorno e per target, cosi' il diff di un giro e' una riga per target):
  {"v": 1,
   "runs": {"2026-11-22": {"src": "actions" | "locale", "g": ["2026-11-22T16:28:38Z", ...], "n": 1,
                           "q": query fatte, "ok": query con voli, "r": ok / q, "p": 1 se copertura bassa}},
   "t": {"d_CMB": [riga, ...], "t_sri-lanka": [riga, ...]}}
  riga = {"d": "2026-11-22", "A": "MIL", "MIL": voce, "ROM": voce, "PSA": voce, "k": 165, "p": 1, "l": {"MIL": 821}}
    A    gruppo di origine con il minimo assoluto del giorno (MIL = Linate + Malpensa, ROM = Fiumicino, PSA = Pisa)
    voce destinazione = [prezzo A/R pp, origine, andata, giorni, scali]
                        stima (somma di due solo andata, build.py "e": 1) = gli stessi 5 campi + [0, 0, 1]:
                        l'ottavo campo a 1 dice che quel prezzo non e' un A/R (sul sito il punto e' segnato come stima)
    voce trip         = [voli pp, origine, andata, giorni, scali, totale stimato pp, extra stimato pp]
                        (minimo per voli + extra, come sul sito; il totale comprende voli interni e spese a terra)
    k    query con voli del target nel giro migliore del giorno
    p    1 = dato parziale: in tutti i giri del giorno la copertura era molto sotto il solito (del giro o del target)
    l    solo con piu' giri nello stesso giorno: prezzo dell'ULTIMO giro per i gruppi in cui e' diverso dal minimo
         del giorno (null = l'ultimo giro non ha trovato voli)
Prezzi con la regola scali del sito: max 1 scalo, 2 scali solo se si risparmia >= 25% e >= 150 euro pp.
Piu' giri nello stesso giorno: resta il minimo del giorno, "l" porta l'ultimo valore. Lo stesso giro (stesso
"generated" in scan_meta.json) non viene contato due volte: ripubblicare il sito non cambia nulla.
Giro in ABORT (fail_reason.txt presente o scan_meta.json assente): non si scrive nulla.
Crescita: una riga per giorno per target, al massimo KEEP_DAYS giorni."""
import json, os, statistics, sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(ROOT, "bot", "state", "price_history.json")
GROUPS = ("MIL", "ROM", "PSA")
OORDER = ("LIN", "MXP", "FCO", "CIA", "PSA")
KEEP_DAYS = 400
RUN_PARTIAL = 0.8      # giro parziale: ok/query sotto l'80% del valore tipico degli altri giorni
TGT_PARTIAL = 0.6      # target parziale: query con voli sotto il 60% della sua mediana
WINDOW = 30            # giorni usati come riferimento per la copertura


def empty():
    return {"v": 1, "runs": {}, "t": {}}


def load(path=PATH):
    try:
        with open(path, encoding="utf-8") as f:
            h = json.load(f)
        if isinstance(h, dict) and isinstance(h.get("t"), dict) and isinstance(h.get("runs"), dict):
            return h
    except (OSError, ValueError):
        pass
    return empty()


def save(h, path=PATH):
    d = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    out = ['{"v":1,"runs":{']
    out.append(",\n".join("%s:%s" % (d(k), d(h["runs"][k])) for k in sorted(h["runs"])))
    out.append('},"t":{')
    out.append(",\n".join("%s:[\n%s]" % (d(k), ",\n".join(d(r) for r in h["t"][k])) for k in sorted(h["t"])))
    out.append("}}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    os.replace(tmp, path)


def _group(o, blob):
    for g, os_ in ((blob.get("meta") or {}).get("groups") or {}).items():
        if o in os_:
            return g
    return {"LIN": "MIL", "MXP": "MIL", "FCO": "ROM", "CIA": "ROM", "PSA": "PSA"}.get(o)


def _orank(o):
    return OORDER.index(o) if o in OORDER else 9


def rank(e):
    """Ordine fra due voci: prezzo (per i trip voli + extra), poi aeroporto."""
    return (e[0] + (e[6] if len(e) > 6 else 0), _orank(e[1]))


def snapshot(blob):
    """blob di build_v2.load_data() -> {target: {"g": {gruppo: voce}, "k": query con voli}} (solo target con un prezzo)."""
    out = {}
    cov = blob.get("cov") or {}
    for c in blob.get("combos") or []:
        g = _group(c["o"], blob)
        if not g:
            continue
        for f in ((c.get("a") or [])[:1] + ([c["b"]] if c.get("b") else [])):
            e = [f[0], c["o"], c["dep"], c["n"], f[3]] + ([0, 0, 1] if c.get("e") else [])
            t = out.setdefault("d_" + c["d"], {"g": {}, "k": (cov.get(c["d"]) or [0, 0])[1]})
            if g not in t["g"] or rank(e) < rank(t["g"][g]):
                t["g"][g] = e
    pop = blob.get("trips_popular") or {}
    legs = pop.get("legs") or []
    for t in pop.get("trips") or []:
        mid = (t["land"][0] + t["land"][1]) / 2
        best = {}
        for c in t.get("cells") or []:
            g = _group(c["o"], blob)
            if not g:
                continue
            for op in ((c.get("a") or [])[:1] + ([c["b"]] if c.get("b") else [])):
                st = max(legs[i][3] for i in (op[3], op[4]) if i >= 0)
                e = [op[1], c["o"], c["dep"], c["n"], st, int(round(op[1] + op[2] + t["itot"] + mid)), op[2]]
                if g not in best or rank(e) < rank(best[g]):
                    best[g] = e
        if best:
            out["t_" + t["id"]] = {"g": best, "k": sum(x[1] for x in t.get("cov") or [])}
    return out


def run_info(blob, meta, src=None):
    """Dati del giro: giorno (Europe/Rome) dal "generated" di scan_meta.json, copertura = query con voli / query."""
    gen = meta.get("generated") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        dt = datetime.strptime(gen, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        try:
            from zoneinfo import ZoneInfo
            day = dt.astimezone(ZoneInfo("Europe/Rome")).date().isoformat()
        except Exception:
            day = (dt + timedelta(hours=1)).date().isoformat()
    except ValueError:
        day = gen[:10]
    m, pm = blob.get("meta") or {}, (blob.get("trips_popular") or {}).get("meta") or {}
    q, ok = (m.get("q") or 0) + (pm.get("q") or 0), (m.get("ok") or 0) + (pm.get("ok") or 0)
    if not src:
        src = "actions" if os.environ.get("GITHUB_ACTIONS") and not meta.get("manual") else "locale"
    return {"day": day, "gen": gen, "src": src, "q": q, "ok": ok}


def _typical(vals):
    """Valore "solito": terzo quartile (i giorni buoni), cosi' qualche giro povero non abbassa il riferimento."""
    vals = sorted(vals)
    return vals[min(len(vals) - 1, (3 * len(vals)) // 4)] if vals else None


def update(h, snap, run):
    """Aggiunge un giro allo storico (sul posto). -> True se e' cambiato qualcosa, False se il giro era gia' contato."""
    day = run["day"]
    r = h["runs"].get(day)
    if r and run["gen"] in (r.get("g") or []):
        return False
    ratio = round(run["ok"] / run["q"], 4) if run.get("q") else 0.0
    others = [v.get("r") or 0 for d, v in sorted(h["runs"].items())[-WINDOW:] if d != day and v.get("r")]
    ref = _typical(others)
    run_partial = bool(ref and ratio < RUN_PARTIAL * ref)
    if r:
        r["g"] = (r.get("g") or []) + [run["gen"]]
        r["n"] = r.get("n", 1) + 1
        if run["src"] not in r["src"].split("+"):
            r["src"] += "+" + run["src"]
        if ratio >= (r.get("r") or 0):
            r.update({"q": run["q"], "ok": run["ok"], "r": ratio})
        if not run_partial:
            r.pop("p", None)
    else:
        r = h["runs"][day] = {"src": run["src"], "g": [run["gen"]], "n": 1, "q": run["q"], "ok": run["ok"], "r": ratio}
        if run_partial:
            r["p"] = 1
    for tid, t in snap.items():
        rows = h["t"].setdefault(tid, [])
        prev_k = [x.get("k") or 0 for x in rows[-WINDOW:] if x["d"] != day and x.get("k")]
        ref_k = statistics.median(prev_k) if prev_k else 0
        partial = run_partial or bool(ref_k >= 8 and t["k"] < TGT_PARTIAL * ref_k)
        old = rows[-1] if rows and rows[-1]["d"] == day else None
        row = {"d": day}
        last = {}
        for g in GROUPS:
            new, was = t["g"].get(g), old.get(g) if old else None
            if new and was:
                row[g] = min(new, was, key=rank)
                if rank(new)[0] != rank(row[g])[0]:
                    last[g] = new[0]
            elif new or was:
                row[g] = new or was
                if not new:
                    last[g] = None
        row["A"] = min((g for g in GROUPS if g in row), key=lambda g: rank(row[g]))
        row["k"] = max(t["k"], old.get("k", 0) if old else 0)
        if partial and (old is None or old.get("p")):
            row["p"] = 1
        if last:
            row["l"] = last
        out = {"d": day, "A": row["A"]}
        out.update({k: row[k] for k in GROUPS + ("k", "p", "l") if k in row})
        if old:
            rows[-1] = out
        else:
            rows.append(out)
            rows.sort(key=lambda x: x["d"])
        del rows[:-KEEP_DAYS]
    if r["n"] > 1:   # target con un prezzo in un giro precedente di oggi e nessuno in questo: l'ultimo giro non li ha trovati
        for tid, rows in h["t"].items():
            if tid not in snap and rows and rows[-1]["d"] == day:
                rows[-1]["l"] = {g: None for g in GROUPS if g in rows[-1]}
    for d in sorted(h["runs"])[:-KEEP_DAYS]:
        del h["runs"][d]
    return True


def compact(h, ids=None):
    """Forma leggera per il sito (RAW.hist): voci uguali scritte una volta sola, righe come indici.
    {days: [giorni], runs: [[fonte, parziale 0/1, giri del giorno]], e: [voci],
     t: {target: [[indice giorno, voce MIL, voce ROM, voce PSA (-1 = nessuna), 1 se parziale, {gruppo: ultimo prezzo}?]]}}"""
    days = sorted(h["runs"])
    for rows in h["t"].values():
        for r in rows:
            if r["d"] not in h["runs"]:
                days.append(r["d"])
    days = sorted(set(days))
    di = {d: i for i, d in enumerate(days)}
    ents, eix, t = [], {}, {}
    def ix(e):
        if not e:
            return -1
        k = tuple(e)
        if k not in eix:
            eix[k] = len(ents); ents.append(list(e))
        return eix[k]
    for tid in sorted(h["t"]):
        if ids is not None and tid not in ids:
            continue
        rows = []
        for r in h["t"][tid]:
            row = [di[r["d"]]] + [ix(r.get(g)) for g in GROUPS] + [1 if r.get("p") else 0]
            if r.get("l"):
                row.append(r["l"])
            rows.append(row)
        if rows:
            t[tid] = rows
    runs = [[(h["runs"].get(d) or {}).get("src", ""), 1 if (h["runs"].get(d) or {}).get("p") else 0, (h["runs"].get(d) or {}).get("n", 1)] for d in days]
    return {"days": days, "runs": runs, "e": ents, "t": t}


def update_from_files(path=PATH, src=None):
    """Giro presente nella cartella -> storico. Non scrive nulla se il giro e' in ABORT o senza scan_meta.json."""
    if os.path.exists(os.path.join(ROOT, "fail_reason.txt")):
        print("storico prezzi: giro in ABORT (fail_reason.txt), nessuna scrittura"); return False
    try:
        with open(os.path.join(ROOT, "scan_meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError):
        print("storico prezzi: scan_meta.json assente, nessuna scrittura"); return False
    import build_v2
    blob = build_v2.load_data("v2")
    h = load(path)
    run = run_info(blob, meta, src or os.environ.get("HIST_SRC"))
    snap = snapshot(blob)
    if not snap:
        print("storico prezzi: nessun prezzo nel giro, nessuna scrittura"); return False
    if not update(h, snap, run):
        print("storico prezzi: giro %s gia' registrato" % run["gen"]); return False
    save(h, path)
    r = h["runs"][run["day"]]
    print("storico prezzi: %s (%s) %d target, copertura %.1f%%%s, giri del giorno %d -> %s" % (
        run["day"], run["src"], len(snap), 100 * (run["ok"] / run["q"] if run["q"] else 0), " PARZIALE" if r.get("p") else "", r["n"], os.path.relpath(path, ROOT)))
    return True


if __name__ == "__main__":
    os.chdir(ROOT); sys.path.insert(0, ROOT)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "update":
        update_from_files()
    elif cmd == "show" and len(sys.argv) > 2:
        h = load()
        for r in h["t"].get(sys.argv[2], []):
            print(json.dumps(r, ensure_ascii=False), h["runs"].get(r["d"], {}).get("src", ""))
    else:
        sys.exit(__doc__)
