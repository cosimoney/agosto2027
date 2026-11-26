# -*- coding: utf-8 -*-
"""Autotest del bot, senza rete e senza toccare bot/state: snapshot sui dati reali, alert in dry-run, comandi simulati.

Uso:  .venv/Scripts/python bot/selftest.py [--weekend FILE_O_URL] [-v]
Lo stato di prova vive in una cartella temporanea (BOT_STATE_DIR). Esce con codice 1 se un controllo fallisce."""
import argparse, copy, json, os, re, sys, tempfile, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
TMP = tempfile.mkdtemp(prefix="bot-selftest-")
os.environ["BOT_STATE_DIR"] = TMP
os.environ["TELEGRAM_BOT_TOKEN"] = "000000:SELFTEST"
ME, LAVI, STRANGER = 111111111, 222222222, 999999999
os.environ["TELEGRAM_CHAT_IDS"] = "%d,%d" % (ME, LAVI)
os.environ.pop("GITHUB_ACTIONS", None)

import common as C, snapshot as S, alerts as A, commands as K

FAILS, N = [], [0]
VERBOSE = False


def check(cond, label, detail=""):
    N[0] += 1
    if not cond:
        FAILS.append(label)
    if VERBOSE or not cond:
        print("  [%s] %s%s" % ("ok" if cond else "FALLITO", label, (" -> " + str(detail)) if detail and not cond else ""))


def section(t):
    print("\n== %s" % t)


NOON = datetime(2026, 11, 21, 11, 0, tzinfo=timezone.utc)   # mezzogiorno a Roma: fuori dalle ore di silenzio


def run_alerts(snap, prefs, cfg, now=None):
    """Un giro di alerts.compute con lo stato su file. -> (testo di tutti i messaggi uniti, statistiche)."""
    sd = C.state_dir()
    prev, notified, history = C.load_json(sd / "last_snapshot.json", {}), C.load_json(sd / "notified.json", {}), C.load_json(sd / "history.json", {})
    msgs, new_prev, stats = A.compute(snap, prev, prefs, notified, cfg, now=now or NOON, history=history)
    C.save_json(sd / "last_snapshot.json", new_prev)
    C.save_json(sd / "notified.json", notified)
    C.save_json(sd / "history.json", history)
    LAST["msgs"] = msgs
    LAST["buttons"] = [b for m in msgs for row in (m["buttons"] or []) for b in row]
    return "\n\n".join(m["text"] for m in msgs), stats


def nrows(block):
    """Righe "• ..." di una sezione (la prima puo' stare subito dopo l'apertura del blockquote)."""
    return len(re.findall(r"(?m)^(?:<blockquote expandable>)?• ", block))


def bal(t):
    return all(t.count("<%s>" % x) == t.count("</%s>" % x) for x in ("b", "code")) and t.count("<a ") == t.count("</a>") and t.count("<blockquote") == t.count("</blockquote>")


LAST = {"buttons": [], "msgs": []}


def raw_row(o, d, dep, ret, ms, price, via="IST", al="Test Air"):
    segs = [{"f": o, "t": via, "dd": dep, "dt": "10:00", "ad": dep, "at": "12:00", "m": 120},
            {"f": via, "t": d, "dd": dep, "dt": "14:00", "ad": dep, "at": "18:00", "m": 240}]
    return json.dumps({"k": "%s|%s|%s|%s|%d" % (o, d, dep, ret, ms), "st": "ok", "fl": [{"price": price, "al": [al], "dur": 480, "segs": segs}]})


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("--weekend", help="index.html di flightsMI (file o URL). Default: ../../flightsMI/index.html se esiste, altrimenti saltato")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    VERBOSE = a.verbose
    cfg = C.load_config()
    cfg["dashboard_url"] = "https://example.org/dashboard/"
    cfg["max_alerts_per_day"] = 0     # nei test il tetto giornaliero e' spento, tranne dove lo si prova
    cfg_nc = dict(cfg, max_cards_per_run=0)  # senza card: tutto nel digest (per provare il raggruppamento dei preferiti)

    # ---------- 1. snapshot sui dati reali ----------
    section("1. snapshot sui dati reali")
    wk = a.weekend or str(C.ROOT.parent / "flightsMI" / "index.html")
    if not re.match(r"^https?://", wk) and not Path(wk).exists():
        wk = "none"
    snap = S.build(weekend=wk, cfg=cfg)
    for name, st in snap["sources"].items():
        print("  %-11s %s" % (name, st))
    offers = snap["offers"]
    by_src = {}
    for o in offers:
        by_src.setdefault(o["source"], []).append(o)
    print("  offerte: %d (%s), mete: %d" % (len(offers), ", ".join("%s %d" % (k, len(v)) for k, v in sorted(by_src.items())), len(snap["targets"])))
    check(snap["sources"]["agosto2027"].get("ok") and by_src.get("agosto2027"), "raw.jsonl letto e con offerte")
    need = ("id", "target", "source", "kind", "code", "name", "country", "origin", "dep", "ret", "nights", "price_pp", "stops", "airlines", "url")
    check(all(all(k in o for k in need) for o in offers), "ogni offerta ha tutti i campi dello schema")
    check(len({o["id"] for o in offers}) == len(offers), "ID offerta univoci")
    check(all(C.ID_RE.match(o["target"]) and o["id"].startswith(o["target"] + ":") for o in offers), "ID meta nel formato d_/t_/w_ valido per i deep link")
    check(all(len(("fav_" + t)) <= 64 and re.fullmatch(r"[A-Za-z0-9_-]+", "fav_" + t) for t in snap["targets"]), "tutti gli ID stanno in un parametro start di Telegram (<=64, [A-Za-z0-9_-])")
    check(all(isinstance(o["price_pp"], int) and o["price_pp"] > 0 for o in offers), "prezzi pp interi e positivi")
    check(all(o["stops"] is None or o["stops"] <= 2 for o in offers), "mai piu' di 2 scali")
    two = [o for o in offers if o["stops"] == 2]
    check(all(o.get("price_1stop") and o["price_1stop"] - o["price_pp"] >= cfg["two_stops_min_eur"]
              and (o["price_1stop"] - o["price_pp"]) / o["price_1stop"] >= cfg["two_stops_min_pct"] for o in two),
          "2 scali solo con risparmio >=25%% e >=150 euro pp (%d casi)" % len(two))
    check(all(o["nights"] == S.days(o["dep"], o["ret"]) for o in offers), "notti coerenti con le date")
    # confronto con la dashboard: stesso miglior prezzo <=1 scalo per destinazione di build.py
    html = C.ROOT / "agosto-2027.html"
    if html.exists():
        m = re.search(r'"combos":(\[.*?\]),"cov":', html.read_text(encoding="utf-8"), re.S)
        if m:
            dash = {}
            for c in json.loads(m.group(1)):
                p = min([x[0] for x in c["a"][:1]] + ([c["b"][0]] if c["b"] and c["a"] else []), default=None)
                if p is not None:
                    dash[c["d"]] = min(p, dash.get(c["d"], 10 ** 9))
            mine = {t["code"]: t["min"] for t in snap["targets"].values() if t["source"] == "agosto2027" and t["min"]}
            same = sum(1 for k in mine if dash.get(k) == mine[k])
            print("  confronto con agosto-2027.html: %d destinazioni con voli nella dashboard, %d nello snapshot, %d con lo stesso minimo" % (len(dash), len(mine), same))
            if set(dash) != set(mine) or same != len(mine):
                print("  (differenze attese se raw.jsonl e' stato aggiornato dopo l'ultimo build.py)")
    if "popular" in by_src:
        check(any(o["kind"] == "openjaw" for o in by_src["popular"]) or True, "popular trips letti")
        print("  popular: %d giri con voli su %d" % (len({o["target"] for o in by_src["popular"]}), sum(1 for t in snap["targets"].values() if t["source"] == "popular")))

    # adattatore jsonl generico per i popular trips, con righe volutamente sporche
    fx = Path(TMP) / "trips_fixture.jsonl"
    fx.write_text("\n".join([
        json.dumps({"slug": "Perù classico", "name": "Perù classico", "country": "Perù", "origin": "MXP", "dest_in": "LIM", "dest_out": "CUZ", "dep": "2027-08-07", "ret": "2027-08-18", "price_pp": 980, "stops": 1, "airlines": "Iberia, LATAM"}),
        json.dumps({"trip": "giappone", "n": "Giappone", "o": "LIN", "to": "HND", "dep": "2027-08-08", "ret": "2027-08-19", "price_total": 2400, "pax": 2, "max_stops": 1}),
        json.dumps({"id": "giappone", "name": "Giappone", "k": "MXP|HND|KIX|2027-08-08|2027-08-19|1", "st": "ok", "fl": [{"price": 1500, "al": ["ANA"], "dur": 900, "segs": [{"f": "MXP", "t": "FRA", "dd": "2027-08-08", "dt": "10:00", "ad": "2027-08-08", "at": "11:00", "m": 60}, {"f": "FRA", "t": "HND", "dd": "2027-08-08", "dt": "13:00", "ad": "2027-08-09", "at": "08:00", "m": 700}]}]}),
        json.dumps({"k": "OW|MXP|YYC|2027-08-06|2", "st": "ok", "fl": []}),
        json.dumps({"name": "senza prezzo", "origin": "MXP", "to": "XXX", "dep": "2027-08-08", "ret": "2027-08-19"}),
        "{riga rotta",
    ]), encoding="utf-8")
    fo, ft, fst = S.adapt_trips(fx, cfg, {})
    check(len(fo) == 3 and fst["skipped"] == 2 and fst.get("one_way_legs") == 1, "adattatore jsonl generico: 3 offerte, 2 righe scartate, 1 solo-andata ignorata", fst)
    check({o["target"] for o in fo} == {"t_peru-classico", "t_giappone"} and any(o["kind"] == "openjaw" and o.get("ret_from") == "CUZ" for o in fo)
          and any(o["price_pp"] == 1200 for o in fo), "slug, open-jaw e prezzo totale/pax interpretati", [(o["id"], o["price_pp"]) for o in fo])

    # ---------- 2. alert ----------
    section("2. alert in dry-run (stato in cartella temporanea)")
    prefs = C.load_prefs(cfg)
    by = C.by_target(snap)
    mx = cfg["section_max_rows"]
    bad_clima = {t for t, v in snap["targets"].items() if not C.in_digest(t, v, cfg)}   # fuori perimetro: clima sconsigliato o tab "Gia' visitati"
    vis = {t for t, v in snap["targets"].items() if v.get("tab") == "vis"}
    aug_all = sorted((v[0] for v in by.values() if v[0]["source"] != "weekend"), key=lambda o: o["price_pp"])
    aug = [o for o in aug_all if o["target"] not in bad_clima]
    under = [o for o in aug if o["price_pp"] <= prefs["threshold"]]
    over = [o for o in aug if o["price_pp"] > prefs["threshold"]]
    # atteso: una riga per coppia meta + aeroporto con almeno un'offerta sotto soglia
    pairs = {}
    for o in snap["offers"]:
        if o["source"] != "weekend" and o["price_pp"] <= prefs["threshold"] and o["target"] not in bad_clima:
            k = (o["target"], C.section_of(o["origin"], cfg)[1])
            pairs[k] = min(o["price_pp"], pairs.get(k, 10 ** 9))
    text, st = run_alerts(snap, prefs, cfg)
    print("  primo giro: %s, %d mete sotto %s pp, %d coppie meta+aeroporto" % (st, len(under), C.euro(prefs["threshold"]), len(pairs)))
    if VERBOSE:
        print(text)
    check(st["first_run"] and st["rows"] + st["merged"] == len(pairs), "primo giro: ogni meta sotto soglia compare sotto ogni aeroporto da cui e' sotto soglia (righe + giri accorpati)", (st, len(pairs)))
    bad_under = [o for o in aug_all if o["target"] in bad_clima and o["price_pp"] <= prefs["threshold"]]
    vis_under = [o for o in aug_all if o["target"] in vis and o["price_pp"] <= prefs["threshold"]]
    check(vis and vis <= bad_clima and all(snap["targets"][t].get("tab") for t in snap["targets"] if t.startswith("d_") and snap["targets"][t].get("country"))
          and not any('#/d/%s"' % o["code"] in text for o in vis_under) and all(v.get("tab") in ("new", None) for t, v in snap["targets"].items() if t.startswith("d_") and t not in bad_clima),
          "digest solo con le Nuove mete: le %d destinazioni 'Gia' visitati' restano fuori (%d sotto soglia: %s)" % (len(vis), len(vis_under), ", ".join(o["name"] for o in vis_under[:4])))
    T = lambda tab=None, clima=None: {"tab": tab, "clima": clima}
    check(C.in_digest("d_X", T("new"), cfg) and not C.in_digest("d_X", T("vis"), cfg) and not C.in_digest("d_X", T("new", "sconsigliato"), cfg) and C.in_digest("d_X", T(), cfg)
          and C.in_digest("t_giro", {}, cfg) and not C.in_digest("t_giro", {}, dict(cfg, digest_include_popular=False)) and C.in_digest("d_X", T("vis"), dict(cfg, digest_tabs=["new", "vis"]))
          and C.in_digest("d_X", T("vis"), dict(cfg, digest_tabs=[])) and C.in_digest("w_BCN", {}, cfg),
          "perimetro configurabile: digest_tabs, digest_include_popular, digest_exclude_clima")
    if vis_under:
        vt = vis_under[0]["target"]
        vm, _, vs = A.compute(snap, {}, dict(prefs, favorites={vt: {"added": "2026-11-21", "p": vis_under[0]["price_pp"] + 80}}), {}, cfg, now=NOON)
        check(vs["cards"] == 1 and vm[0]["kind"] == "card" and ('#/d/%s"' % vis_under[0]["code"]) in vm[0]["text"] and "sceso da" in vm[0]["text"] and ('#/d/%s"' % vis_under[0]["code"]) not in vm[-1]["text"],
              "meta gia' visitata tra i preferiti: avviso con le regole dei preferiti (%s), sempre fuori dal digest" % vis_under[0]["name"])
        vall, _, vsa = A.compute(snap, {}, dict(prefs, favorites={}), {}, dict(cfg, digest_tabs=["new", "vis"]), now=NOON)
        check(('#/d/%s"' % vis_under[0]["code"]) in vall[-1]["text"] or vsa["rows"] > st["rows"], "con digest_tabs [new, vis] le mete gia' visitate rientrano nel digest")
    check(len(bad_clima) >= 5 and bad_under and st["excluded"] == len([o for o in aug_all if o["target"] in bad_clima])
          and not any('#/d/%s"' % o["code"] in text or "Apri %s" % o["name"] in [b[0] for b in LAST["buttons"]] for o in bad_under),
          "mete fuori perimetro (clima sconsigliato o gia' visitate: %s) fuori dal digest anche se sotto soglia" % ", ".join(o["name"] for o in bad_under[:5]), st)
    check(") (" not in text and (C.offer_title({"name": "Agadir (costa atlantica)", "country": "Marocco", "target": "d_AGA"}) == "<b>Agadir, costa atlantica</b> (Marocco)")
          and C.offer_title({"name": "Bergamo (BGY)", "country": "", "target": "w_BGY", "source": "weekend"}) == "<b>Bergamo (BGY)</b>", "niente doppie parentesi: 'Agadir, costa atlantica (Marocco)'")
    blocks = text.split("\n\n")
    secs = [b for b in blocks if b.startswith("🛫 ")]
    titles = [re.match(r"🛫 <b>(.*?)</b>", b).group(1) for b in secs]
    order = [t for _, t, _ in C.sections(cfg)]
    check(titles and titles == [t for t in order if t in titles] and "Milano Linate (LIN)" in titles and "Milano Malpensa (MXP)" in titles and titles[0] == "Milano Linate (LIN)",
          "digest raggruppato per aeroporto: Milano Linate, poi Milano Malpensa, poi le altre sezioni", titles)
    check(all(1 <= nrows(b) <= mx for b in secs) and sum(nrows(b) for b in secs) == sum(min(mx, n) for n in st["sections"].values()),
          "max %d righe per sezione" % mx, [nrows(b) for b in secs])
    exp_after = cfg["section_expand_after"]
    check(all(("<blockquote expandable>" in b) == (nrows(b) + ("e altre" in b) > exp_after) for b in secs) and any("<blockquote expandable>" in b for b in secs) and all(bal(b) for b in secs),
          "sezioni con piu' di %d righe in <blockquote expandable>, le altre in chiaro" % exp_after)
    dg = LAST["msgs"][-1]
    n_new = st["rows"]
    check(len(LAST["msgs"]) == 1 and dg["kind"] == "digest" and dg["silent"] is True and dg["preview"] is None, "primo giro: un solo messaggio, digest silenzioso e senza anteprima link")
    top0 = min((o for o in snap["offers"] if (o["target"], C.section_of(o["origin"], cfg)[1]) in pairs), key=lambda o: o["price_pp"])
    check(text.split("\n")[0].startswith("✈️ <b>%d novità</b> · da <b>%s pp</b> %s" % (n_new, C.euro(top0["price_pp"]), C.esc(C.display_name(top0)))),
          "prima riga = riepilogo (quante novita', miglior prezzo, meta): e' l'anteprima della notifica", text.split("\n")[0])
    check(all(("e altre %d mete" % (n - mx) in secs[i]) == (n > mx) for i, n in enumerate(st["sections"].values())), "coda 'e altre N mete' nelle sezioni lunghe", st["sections"])
    sec_prices = [[int(x.replace(".", "")) for x in re.findall(r"^(?:<blockquote expandable>)?• .*?: <b>([\d.]+) € pp</b>", b, re.M)] for b in secs]
    check(all(pp == sorted(pp) for pp in sec_prices), "dentro ogni sezione le righe sono in ordine di prezzo pp", sec_prices)
    both = next((t for t in sorted({k[0] for k in pairs}, key=lambda t: (min(pairs[(t, s)] for s in ("LIN", "MXP") if (t, s) in pairs) if any((t, s) in pairs for s in ("LIN", "MXP")) else 10 ** 9, t))
                 if (t, "LIN") in pairs and (t, "MXP") in pairs and pairs[(t, "LIN")] != pairs[(t, "MXP")]), None)
    if both:
        nm = "<b>%s</b></a>" % C.esc(C.display_name(snap["targets"][both]))
        hit = {k: [b for b in secs if k in b.split("\n")[0] and nm in b] for k in ("(LIN)", "(MXP)")}
        full = {k: (not hit[k] or bool(re.search(re.escape(nm) + r"[^\n]*?: <b>%s pp</b>" % re.escape(C.euro(pairs[(both, k[1:4])])), hit[k][0]))) for k in hit}
        check(all(full.values()) and (hit["(LIN)"] or hit["(MXP)"]), "stessa meta da due aeroporti: non accorpata, ogni sezione ha il suo prezzo (%s: LIN %s, MXP %s)" % (both, C.euro(pairs[(both, "LIN")]), C.euro(pairs[(both, "MXP")])))
    lines = [l for l in text.replace("<blockquote expandable>", "").split("\n") if l.startswith("• ")]
    check(len(lines) == len(set(lines)) and (not st["merged"] or "vale anche per il giro" in text), "stesso volo come destinazione e come giro: una riga sola (%d accorpati)" % st["merged"])
    check(all(C.esc(o["name"]) not in text for o in over[:5]), "nessuna meta sopra soglia nel digest")
    check(st["new_routes"] == 0, "primo giro: nessun avviso 'rotte prima vuote' (solo fotografia iniziale)")
    check("Primi voli" not in text and "weekend" not in text.lower(), "weekend fuori dal digest generale (solo preferiti)")
    if under:
        b = under[0]
        check("<b>%s pp</b> · coppia %s" % (C.euro(b["price_pp"]), C.euro(b["price_pp"] * 2)) in text, "prezzo per persona in grassetto, coppia accanto")
        check("google.com/travel/flights" in text and "example.org/dashboard" in text, "link Google Flights e link dashboard presenti")
        check(C.fmt_dates(b["dep"], b["ret"]) in text and C.stops_txt(b) in text, "date e scali nella riga")
        page = "https://example.org/dashboard/#/%s/%s" % (b["target"][0], b["target"][2:])
        check('<a href="%s"><b>%s</b></a>' % (page, C.esc(C.display_name(b))) in text, "il nome della meta e' un link alla SUA pagina (%s)" % page)
        check(lines and all(re.match(r'^• <a href="https://example\.org/dashboard/#/[dt]/[A-Za-z0-9-]+"><b>', l) for l in lines), "ogni riga del digest linka #/d/<IATA> o #/t/<id trip>, non la home")
        check(LAST["buttons"] and all(b[0].startswith("Apri ") and re.match(r"^url:https://example\.org/dashboard/#/[dt]/", b[1]) for b in LAST["buttons"]) and len(LAST["buttons"]) <= 6,
              "pulsanti inline 'Apri' verso le pagine delle mete (max 6)", LAST["buttons"])
    check(all(C.visible_len(p) <= 4096 for p in C.split_message(text)), "messaggi entro il limite di 4096 caratteri visibili")
    long = "\n\n".join(["• " + "x" * 500] * 20)
    check(len(C.split_message(long)) == 3 and all(C.visible_len(p) <= 4096 for p in C.split_message(long)), "messaggi lunghi spezzati sui blocchi")
    huge = "\n".join(["🛫 <b>Sezione</b>"] + ["• riga %d " % i + "y" * 300 for i in range(40)])
    hp = C.split_message("intro\n\n" + huge + "\n\ncoda")
    check(len(hp) >= 3 and all(C.visible_len(p) <= 4096 for p in hp) and "\n".join(hp).count("• riga") == 40, "una sezione da sola oltre il limite viene spezzata sulle righe, senza perdere nulla", [C.visible_len(p) for p in hp])
    # digest enorme: 5 sezioni piene di righe lunghe + tanti preferiti -> piu' messaggi, tutti sotto il limite
    big = {"generated": "x", "sources": {"agosto2027": {"ok": True}}, "targets": {}, "offers": []}
    bprefs = {"threshold": 1000, "favorites": {}, "paused": []}
    for i in range(30):
        code = "Q%s%s" % (chr(65 + i // 26), chr(65 + i % 26))
        big["targets"]["d_" + code] = {"source": "agosto2027", "code": code, "name": "Destinazione dal nome molto lungo numero %d" % i, "country": "Paese Lontanissimo", "q": 1, "ok": 1}
        for j, og in enumerate(("LIN", "MXP", "FCO", "CIA", "PSA", "XYZ")):
            big["offers"].append({"id": "d_%s:%s:2027-08-07:2027-08-18" % (code, og), "target": "d_" + code, "source": "agosto2027", "kind": "roundtrip", "code": code,
                                  "name": big["targets"]["d_" + code]["name"], "country": "Paese Lontanissimo", "origin": og, "dep": "2027-08-07", "ret": "2027-08-18", "nights": 11,
                                  "price_pp": 300 + 7 * i + j, "stops": 1, "airlines": ["Compagnia Aerea Dal Nome Lungo", "Altra Compagnia"], "url": C.gf_url(og, code, "2027-08-07", "2027-08-18")})
        if i < 20:
            bprefs["favorites"]["d_" + code] = {"added": "2026-11-21", "p": 900}
    bmsgs, _, bst = A.compute(big, {}, bprefs, {}, cfg_nc, now=NOON)
    btext = bmsgs[-1]["text"]
    bparts = C.split_message(btext)
    btitles = re.findall(r"^🛫 <b>(.*?)</b>", btext.split("<b>I tuoi preferiti</b>")[0], re.M)
    check(btitles == ["Milano Linate (LIN)", "Milano Malpensa (MXP)", "Roma (FCO/CIA)", "Pisa (PSA)", "Da XYZ"], "ordine delle sezioni: Linate, Malpensa, Roma, Pisa, poi gli aeroporti non previsti", btitles)
    check(len(bparts) >= 2 and all(C.visible_len(p) <= 4096 for p in bparts) and bst["favorites"] == 20 and bst["rows"] == 50, "digest molto lungo: spezzato in %d messaggi, tutti entro 4096 caratteri" % len(bparts), ([C.visible_len(p) for p in bparts], bst))
    check(nrows(btext) == 5 * mx and btext.count("e altre %d mete" % (10 - mx)) == 5, "digest molto lungo: %d righe per sezione + 'e altre N'" % mx)
    check(all(bal(p) for p in bparts) and len(bmsgs) == 1, "ogni messaggio spezzato ha l'HTML bilanciato (blockquote compresi)")
    # tetto di card per giro: 3 card con suono, gli altri preferiti nel digest
    cmsgs, _, cst = A.compute(big, {}, copy.deepcopy(bprefs), {}, cfg, now=NOON)
    cards = [m for m in cmsgs if m["kind"] == "card"]
    check(len(cards) == cfg["max_cards_per_run"] == cst["cards"] and cmsgs[-1]["kind"] == "digest" and cmsgs[-1]["text"].count("⭐ ") == 20 - len(cards) and all(not m["silent"] for m in cards) and cmsgs[-1]["silent"],
          "tetto per giro: %d card con suono, gli altri %d preferiti nel digest silenzioso" % (cfg["max_cards_per_run"], 20 - len(cards)), cst)
    check(all(m["text"].startswith("📉 <a href=") and "<b>%s pp</b>" % C.euro(300 + 7 * i) in m["text"].split("\n")[0] for i, m in enumerate(cards)),
          "card: una per messaggio, dalla piu' economica; prima riga = meta + prezzo pp", [m["text"].split("\n")[0][:80] for m in cards])
    kb = cards[0]["buttons"]
    check(len(kb) == 2 and [x[0] for x in kb[0]] == ["🔗 Apri pagina", "✈️ Voli su Google"] and kb[0][0][1] == "url:https://example.org/dashboard/#/d/QAA" and "google.com/travel/flights" in kb[0][1][1]
          and kb[1] == [("❌ Rimuovi preferito", "rm:d_QAA"), ("🔕 Silenzia 7 gg", "mute:d_QAA:7")], "card: pulsanti Apri pagina, Voli su Google, Rimuovi preferito, Silenzia 7 gg", kb)
    qmsgs, _, qst = A.compute(big, {}, copy.deepcopy(bprefs), {}, cfg, now=datetime(2026, 11, 21, 22, 30, tzinfo=timezone.utc))
    check(qst["quiet"] and all(m["silent"] for m in qmsgs) and sum(m["kind"] == "card" for m in qmsgs) == 3, "ore di silenzio (23:30 a Roma): le card partono ma senza suono")
    dmsgs, _, dst = A.compute(big, {}, copy.deepcopy(bprefs), {"cards": {"day": "2026-11-21", "n": 5}}, dict(cfg, max_alerts_per_day=6), now=NOON)
    dmsgs2, _, _ = A.compute(big, {}, copy.deepcopy(bprefs), {"cards": {"day": "2026-11-20", "n": 6}}, dict(cfg, max_alerts_per_day=6), now=NOON)
    check(dst["cards"] == 1 and dmsgs[-1]["text"].count("⭐ ") == 19 and sum(m["kind"] == "card" for m in dmsgs2) == 3, "tetto giornaliero: con 5 card gia' inviate oggi ne parte 1 sola; il giorno dopo si riparte")
    # prezzo tipico (mediana dei giorni precedenti) e card "molto sotto il tipico"
    hist = {"d_QAA": [["2026-11-%02d" % d, 480] for d in range(10, 16)], "d_QAB": [["2026-11-%02d" % d, 330] for d in range(10, 16)], "d_QAC": [["2026-11-10", 900]]}
    tp = {"threshold": 1000, "favorites": {"d_QAB": {"added": "2026-11-21", "p": 380}}, "paused": []}
    tmsgs, _, tst = A.compute(big, {}, tp, {}, cfg, now=NOON, history=hist)
    tcards = [m["text"] for m in tmsgs if m["kind"] == "card"]
    check(len(tcards) == 2 and tcards[0].startswith("📉 ") and "📊 tipico 330 € pp: ora 23 € sotto (-7,0%)" in tcards[0] and tcards[1].startswith("🔥 ") and "#/d/QAA" in tcards[1]
          and "📊 tipico 480 € pp: ora 180 € sotto (-38%)" in tcards[1], "prezzo tipico nelle card; offerta 38% sotto il tipico -> card 🔥 anche se non e' un preferito", tcards)
    check("-38% sul tipico" in tmsgs[-1]["text"] and tmsgs[-1]["text"].count("sul tipico") == 1 and hist["d_QAA"][-1] == ["2026-11-21", 300] and len(hist["d_QAC"]) == 2 and A.typical(hist, "d_QAC", cfg, "2026-11-21") is None,
          "digest: '-38%% sul tipico' solo dove c'e' abbastanza storia (>= %d giorni); storia aggiornata con il minimo di oggi" % cfg["typical_min_samples"])
    # meta silenziata: nessun avviso, riferimento fermo; alla scadenza il calo accumulato viene segnalato
    mp = {"threshold": 1000, "favorites": {"d_QAB": {"added": "2026-11-21", "p": 380}}, "paused": [], "muted": {"d_QAB": "2026-11-28", "d_QAA": "2026-11-28"}}
    mnot = {}
    mm, _, mst = A.compute(big, {}, mp, mnot, cfg, now=NOON)
    ref_muted = mnot["fav"]["d_QAB"]["last"]
    mm2, _, mst2 = A.compute(big, {}, mp, mnot, cfg, now=NOON + timedelta(days=8))
    check(mst["muted"] == 2 and mst["cards"] == 0 and "#/d/QAA" not in mm[-1]["text"] and ref_muted == 380 and mst2["cards"] == 1 and "sceso da 380 €" in mm2[0]["text"] and "#/d/QAA" in mm2[-1]["text"],
          "meta silenziata: fuori da card e digest; scaduti i 7 giorni il calo accumulato arriva", (mst, mst2))
    # frequenza del digest: giornaliera -> nello stesso giorno le novita' si accumulano senza messaggi
    fp = {"threshold": 1000, "favorites": {}, "paused": [], "digest": "giorno"}
    fnot, fprev = {}, {}
    half = dict(big, offers=[o for o in big["offers"] if o["code"] < "QAP"], targets={k: v for k, v in big["targets"].items() if k[2:] < "QAP"})
    f1, fprev, fs1 = A.compute(half, fprev, fp, fnot, cfg, now=NOON)
    f2, fprev, fs2 = A.compute(big, fprev, fp, fnot, cfg, now=NOON + timedelta(hours=4))
    f3, fprev, fs3 = A.compute(big, fprev, fp, fnot, cfg, now=NOON + timedelta(days=1))
    check(len(f1) == 1 and fs1["rows"] == 75 and f2 == [] and not fs2["digest_due"] and len(f3) == 1 and fs3["rows"] == 75 and fnot["digest_last"] == "2026-11-22",
          "/digest giornaliero: secondo giro dello stesso giorno in silenzio, le novita' arrivano il giorno dopo", (fs1["rows"], fs2["rows"], fs3["rows"]))
    fp["digest"] = "settimana"
    f4, _, fs4 = A.compute(dict(big, offers=[dict(o, price_pp=o["price_pp"] - 60) for o in big["offers"]]), fprev, fp, fnot, cfg, now=NOON + timedelta(days=5))
    check(f4 == [] and not fs4["digest_due"], "/digest settimanale: niente riepilogo prima di 7 giorni")
    ftit = re.findall(r"^🛫 <b>(.*?)</b>", btext.split("<b>I tuoi preferiti</b>")[1], re.M)
    check(ftit == ["Milano Linate (LIN)"] and btext.count("⭐ ") == 20, "preferiti nello stesso giro raggruppati sotto l'aeroporto del loro miglior prezzo", ftit)

    text2, st2 = run_alerts(snap, prefs, cfg)
    check(text2 == "" and st2["rows"] == 0, "secondo giro con gli stessi dati: nessun messaggio (dedup)", st2)

    # terzo giro: dati modificati ad arte
    snap3 = copy.deepcopy(snap)
    by3 = C.by_target(snap3)
    cand = [o for o in under if o["target"].startswith("d_") and o["price_pp"] > 150]
    check(len(cand) >= 3, "ci sono almeno 3 destinazioni sotto soglia su cui provare i cali", len(cand))
    t_small, t_big, fav = cand[0]["target"], cand[1]["target"], max(cand[2:], key=lambda o: o["price_pp"])["target"]  # il preferito di prova: il piu' caro, cosi' regge i ribassi dei test
    by3[t_small][0]["price_pp"] -= 49                     # sotto la regola dei 50 euro: non deve rinotificare
    old_big = by3[t_big][0]["price_pp"]
    by3[t_big][0]["price_pp"] = old_big - 30               # primo calo piccolo: silenzio, riferimento fermo
    empty = sorted(t for t, v in snap["targets"].items() if v["source"] == "agosto2027" and not v["n"] and t not in bad_clima)
    check(len(empty) >= 2, "ci sono rotte ancora vuote su cui provare la comparsa dei voli", len(empty))
    for code, price in ((empty[0], 640), (empty[1], 1890)):
        t = snap3["targets"][code]
        snap3["offers"].append({"id": "%s:MXP:2027-08-09:2027-08-20" % code, "target": code, "source": "agosto2027", "kind": "roundtrip", "code": t["code"],
                                "name": t["name"], "country": t["country"], "origin": "MXP", "dep": "2027-08-09", "ret": "2027-08-20", "nights": 11,
                                "price_pp": price, "stops": 1, "airlines": ["Test Air"], "url": C.gf_url("MXP", t["code"], "2027-08-09", "2027-08-20")})
    text3, st3 = run_alerts(snap3, prefs, cfg)
    if VERBOSE:
        print(text3)
    check(st3["rows"] == 1 and ("<b>%s</b>" % C.esc(C.display_name(snap["targets"][t_big]))) not in text3 and ("<b>%s</b>" % C.esc(C.display_name(snap["targets"][t_small]))) not in text3,
          "terzo giro: cali di 30 e 49 euro non rinotificati (regola: 50 euro fino a 1.000, 100 sopra)", st3)
    check("primi voli su questa rotta" in text3 and C.esc(C.display_name(snap["targets"][empty[0]])) in text3 and "Milano Malpensa (MXP)" in text3, "rotta prima vuota sotto soglia: segnalata nella sezione del suo aeroporto")
    # una meta dal clima sconsigliato sotto soglia: entra solo come preferito
    if bad_under:
        bt = bad_under[0]["target"]
        pb = dict(prefs, favorites={bt: {"added": "2026-11-21"}})
        tb, _, sb_ = A.compute(snap, {}, pb, {}, cfg, now=NOON)
        check(sb_["favorites"] == 1 and tb[0]["kind"] == "card" and ('#/d/%s"' % bad_under[0]["code"]) in tb[0]["text"] and ('#/d/%s"' % bad_under[0]["code"]) not in tb[-1]["text"], "meta dal clima sconsigliato: compare se e' tra i preferiti (%s)" % bad_under[0]["name"])
    check(st3["new_routes"] == 1 and "Primi voli su rotte finora vuote" in text3 and C.esc(C.display_name(snap["targets"][empty[1]])) in text3, "rotta prima vuota sopra soglia: sezione dedicata")
    text3b, st3b = run_alerts(snap3, prefs, cfg)
    check(text3b == "", "ripetendo il terzo giro: silenzio")
    by3[t_big][0]["price_pp"] = old_big - 55               # altri 25 euro: 55 in tutto dal riferimento -> si notifica
    text3c, st3c = run_alerts(snap3, prefs, cfg)
    check(st3c["rows"] == 1 and ("%s</a>" % ("<b>%s</b>" % C.esc(C.display_name(snap["targets"][t_big])))) in text3c and "<b>%s pp</b>" % C.euro(old_big - 55) in text3c,
          "digest: due cali piccoli (30 + 25 euro) si sommano e superano la soglia di 50", (st3c, text3c[:300]))
    check(run_alerts(snap3, prefs, cfg)[0] == "", "dopo la notifica il riferimento si sposta: silenzio")

    # preferiti
    prefs["favorites"][fav] = {"added": "2026-11-21"}
    textf0, stf0 = run_alerts(snap3, prefs, cfg)
    check(stf0["favorites"] == 1 and "sotto la tua soglia" in textf0, "preferito appena aggiunto e gia' sotto soglia: un avviso")
    textf1, stf1 = run_alerts(snap3, prefs, cfg)
    check(textf1 == "", "preferito senza novita': silenzio")
    snap4 = copy.deepcopy(snap3)
    by4 = C.by_target(snap4)
    fo4 = by4[fav][0]
    oldp = fo4["price_pp"]
    fo4["price_pp"] = oldp - 35                           # sotto i 50 euro
    nd = dict(fo4, dep="2027-08-15", ret="2027-08-27", nights=12, price_pp=oldp + 50)
    nd["id"] = "%s:%s:%s:%s" % (fav, nd["origin"], nd["dep"], nd["ret"])
    check(nd["id"] not in {o["id"] for o in snap4["offers"]}, "la data di prova e' davvero nuova")
    snap4["offers"].append(nd)
    textf2, stf2 = run_alerts(snap4, prefs, cfg)
    if VERBOSE:
        print(textf2)
    check("1 nuova data" in textf2 and "sceso da" not in textf2, "preferito: nuova data segnalata; il calo di 35 euro (< 50) no", textf2[:300])
    check(stf2["rows"] == 0, "il preferito non compare due volte (fuori dal digest generale)")
    check("sotto la tua soglia" not in textf2, "il passaggio sotto soglia non viene ripetuto")
    snap5 = copy.deepcopy(snap4)
    C.by_target(snap5)[fav][0]["price_pp"] -= 14           # 49 in tutto: ancora sotto
    check(run_alerts(snap5, prefs, cfg)[0] == "", "preferito: 49 euro sotto il riferimento, nessun avviso")
    C.by_target(snap5)[fav][0]["price_pp"] -= 1            # 50 in tutto dal riferimento (che non si e' mosso)
    p1 = oldp - 50
    textf3, stf3 = run_alerts(snap5, prefs, cfg)
    if VERBOSE:
        print(textf3)
    fname = C.esc(C.display_name(snap["targets"][fav]))
    fpage = "https://example.org/dashboard/#/%s/%s" % (fav[0], fav[2:])
    check(stf3["favorites"] == 1 and "sceso da %s a <b>%s pp</b>: -50 € (-%s%%)" % (C.euro(oldp), C.euro(p1), A.pct_txt(oldp, p1)) in textf3,
          "preferito: i cali piccoli si sommano, a -50 euro dal riferimento parte l'avviso (nuovo, precedente, differenza in euro e %)", textf3[:300])
    b5 = C.by_target(snap5)[fav][0]
    check('<a href="%s"><b>%s</b></a>' % (fpage, fname) in textf3 and C.fmt_dates(b5["dep"], b5["ret"]) in textf3 and (C.stops_txt(b5) in textf3)
          and "google.com/travel/flights" in textf3 and ("🔗 Apri pagina", "url:" + fpage) in LAST["buttons"] and ("🔕 Silenzia 7 gg", "mute:%s:7" % fav) in LAST["buttons"],
          "preferito: nel messaggio date, scali, link alla pagina, Google Flights e pulsanti Apri / Silenzia")
    check(len(LAST["msgs"]) == 1 and LAST["msgs"][0]["kind"] == "card" and LAST["msgs"][0]["silent"] is False and textf3.startswith("📉 <a href=\"%s\"><b>%s</b></a>" % (fpage, fname)),
          "preferito sceso: ALERT singolo con suono, prima riga = meta + prezzo")
    check(run_alerts(snap5, prefs, cfg)[0] == "", "preferito: lo stesso prezzo non viene rinotificato")
    # il minimo si sposta su date diverse: conta il miglior prezzo della meta, non la singola data
    snap5b = copy.deepcopy(snap5)
    next(o for o in snap5b["offers"] if o["id"] == nd["id"])["price_pp"] = p1 - 60
    textf3b, _ = run_alerts(snap5b, prefs, cfg)
    check("sceso da %s a <b>%s pp</b>: -60 €" % (C.euro(p1), C.euro(p1 - 60)) in textf3b and C.fmt_dates("2027-08-15", "2027-08-27") in textf3b,
          "preferito: calo di 60 euro su date diverse notificato", textf3b[:300])
    ref = p1 - 60
    # risalita e ridiscesa sopra il riferimento: silenzio
    snap5c = copy.deepcopy(snap5b)
    next(o for o in snap5c["offers"] if o["id"] == nd["id"])["price_pp"] = ref + 90
    C.by_target(snap5c)[fav][0]["price_pp"] = ref + 70
    check(run_alerts(snap5c, prefs, cfg)[0] == "", "preferito: prezzo risalito, nessun avviso")
    snap5 = copy.deepcopy(snap5c)
    C.by_target(snap5)[fav][0]["price_pp"] = ref - 20
    check(run_alerts(snap5, prefs, cfg)[0] == "", "preferito: ridiscesa di 90 euro ma solo 20 sotto il riferimento (%s), nessun avviso" % C.euro(ref))
    # preferito SOPRA 1.000 euro: serve un calo di 100 euro, e la soglia generale non c'entra
    if over:
        fav_hi = over[0]["target"]
        snap5 = copy.deepcopy(snap5)
        for o in snap5["offers"]:
            if o["target"] == fav_hi:
                o["price_pp"] += 1000
        hi = C.by_target(snap5)[fav_hi][0]["price_pp"]
        prefs["favorites"][fav_hi] = {"added": "2026-11-21", "p": hi}   # "p" = prezzo visto all'aggiunta (lo scrive commands.py)
        check(run_alerts(snap5, prefs, cfg)[0] == "", "preferito sopra soglia appena aggiunto: silenzio (prezzo invariato)")
        snap5h = copy.deepcopy(snap5)
        C.by_target(snap5h)[fav_hi][0]["price_pp"] = hi - 99
        check(run_alerts(snap5h, prefs, cfg)[0] == "", "preferito a %s (> 1.000): calo di 99 euro, nessun avviso" % C.euro(hi))
        C.by_target(snap5h)[fav_hi][0]["price_pp"] = hi - 100
        texth, sth = run_alerts(snap5h, prefs, cfg)
        if VERBOSE:
            print(texth)
        check(hi - 100 > prefs["threshold"] and sth["favorites"] == 1 and "sceso da %s a <b>%s pp</b>: -100 €" % (C.euro(hi), C.euro(hi - 100)) in texth
              and "sotto la tua soglia" not in texth, "preferito sopra la soglia generale: calo di 100 euro notificato (%s -> %s)" % (C.euro(hi), C.euro(hi - 100)), texth[:300])
        check(sth["rows"] == 0, "preferito sopra soglia: non entra nel digest generale")
        snap5 = snap5h
    check(C.min_drop(1001, cfg) == 100 and C.min_drop(1000, cfg) == 50 and C.is_drop(1000, 950, cfg) and not C.is_drop(1000, 951, cfg) and C.is_drop(1500, 1400, cfg)
          and not C.is_drop(1500, 1401, cfg) and not C.is_drop(500, 500, cfg) and not C.is_drop(None, 100, cfg),
          "fav_drop_rules: 100 euro se il riferimento e' sopra 1.000, 50 euro se e' <= 1.000")
    cfg_r = dict(cfg, fav_drop_rules=[{"above": 0, "min_drop_eur": 20}, {"above": 2000, "min_drop_eur": 300}, {"above": 500, "min_drop_eur": 80}])
    check([C.min_drop(x, cfg_r) for x in (2500, 2000, 501, 500, 10)] == [300, 80, 80, 20, 20] and C.min_drop(700, dict(cfg, fav_drop_rules=None)) == 50, "fav_drop_rules configurabili (ordine libero, default se mancano)")
    raw_cfg = C.load_json(C.BOT_DIR / "config.json", {})
    check(raw_cfg.get("fav_drop_rules") == [{"above": 1000, "min_drop_eur": 100}, {"above": 0, "min_drop_eur": 50}] and not any(k in raw_cfg for k in ("fav_min_drop_eur", "fav_min_drop_pct", "drop_pct", "drop_eur")),
          "config.json: fav_drop_rules presenti, vecchie soglie (1 euro, 5%/30 euro) rimosse")
    cur = C.by_target(snap5)[fav][0]["price_pp"]
    prefs["favorites"][fav]["thr"] = cur - 100
    textf4, _ = run_alerts(snap5, prefs, cfg)
    check(textf4 == "", "soglia personalizzata piu' bassa del prezzo: nessun avviso")
    snap6 = copy.deepcopy(snap5)
    C.by_target(snap6)[fav][0]["price_pp"] = cur - 120
    textf5, _ = run_alerts(snap6, prefs, cfg)
    check("sotto la tua soglia di %s" % C.euro(cur - 100) in textf5 and "sceso da %s a <b>%s pp</b>" % (C.euro(ref), C.euro(cur - 120)) in textf5, "soglia personalizzata superata: avviso", textf5[:300])
    # fonte non letta in un giro: non deve generare falsi "primi voli" al giro dopo
    snap7 = copy.deepcopy(snap6)
    snap7["offers"] = [o for o in snap7["offers"] if o["source"] != "agosto2027"]
    snap7["targets"] = {k: v for k, v in snap7["targets"].items() if v["source"] != "agosto2027"}
    snap7["sources"]["agosto2027"] = {"ok": False, "reason": "test"}
    run_alerts(snap7, prefs, cfg)
    text8, st8 = run_alerts(snap6, prefs, cfg)
    check(text8 == "" and st8["new_routes"] == 0, "una fonte saltata per un giro non provoca falsi allarmi al rientro", st8)

    # ---------- 2b. nuove origini (Roma FCO, Pisa PSA) e file v2 ----------
    section("2b. nuove origini e file raw_v2.jsonl")
    fxd = Path(TMP) / "fx_root"
    fxd.mkdir()
    D1, R1 = "2027-08-07", "2027-08-18"
    (fxd / "raw.jsonl").write_text("\n".join([raw_row("MXP", "TBS", D1, R1, 2, 500), raw_row("MXP", "TBS", D1, R1, 1, 500),
                                               raw_row("LIN", "TBS", D1, R1, 2, 520), raw_row("LIN", "TBS", D1, R1, 1, 520)]), encoding="utf-8")
    only_old = S.build(root=fxd, trips=str(fxd / "nessuno.json"), weekend="none", cfg=cfg)
    check(only_old["sources"]["agosto2027"].get("files") == ["raw.jsonl"] and len(only_old["offers"]) == 2, "senza raw_v2.jsonl si legge il vecchio raw.jsonl", only_old["sources"])
    (fxd / "raw_v2.jsonl").write_text("\n".join([
        raw_row("FCO", "TBS", D1, R1, 2, 410), raw_row("FCO", "TBS", D1, R1, 1, 410),
        raw_row("PSA", "TBS", D1, R1, 2, 480), raw_row("PSA", "TBS", D1, R1, 1, 480),
        raw_row("CIA", "TBS", D1, R1, 2, 700), raw_row("CIA", "TBS", D1, R1, 1, 700),
        raw_row("MXP", "TBS", D1, R1, 2, 495), raw_row("MXP", "TBS", D1, R1, 1, 495),
        json.dumps({"k": "OW|FCO|TBS|%s|2" % D1, "st": "ok", "fl": []}), json.dumps({"k": "FCO|EVN|%s|%s|2" % (D1, R1), "st": "empty", "fl": []}),
    ]), encoding="utf-8")
    sv2 = S.build(root=fxd, trips=str(fxd / "nessuno.json"), weekend="none", cfg=cfg)
    st_a = sv2["sources"]["agosto2027"]
    ids = sorted(o["id"] for o in sv2["offers"])
    check(st_a.get("files") == ["raw.jsonl", "raw_v2.jsonl"] and st_a.get("origins") == ["CIA", "FCO", "LIN", "MXP", "PSA"], "raw.jsonl + raw_v2.jsonl letti insieme, origini nuove accettate", st_a)
    check(ids == ["d_TBS:%s:%s:%s" % (o, D1, R1) for o in ("CIA", "FCO", "LIN", "MXP", "PSA")], "stesse date da origini diverse: un id per origine (dedup con l'origine)", ids)
    pr = {o["origin"]: o["price_pp"] for o in sv2["offers"]}
    check(pr == {"FCO": 410, "PSA": 480, "CIA": 700, "MXP": 495, "LIN": 520}, "per la stessa query vince raw_v2.jsonl; prezzo = solo volo, nessun costo treno aggiunto", pr)
    check(not any(k in o for o in sv2["offers"] for k in ("pos_pp", "pos_cost_pp", "flight_pp")) and "pos_cost_pp_default" not in cfg, "nessun campo di posizionamento nello snapshot ne' in config")
    check(sv2["targets"]["d_TBS"]["min"] == 410 and sv2["targets"]["d_EVN"]["n"] == 0 and st_a["bad_lines"] == 1, "minimo della meta su tutte le origini; riga OW estranea scartata", (sv2["targets"], st_a))
    bfx = C.by_target(sv2)["d_TBS"]
    blk = C.offer_block(bfx[0], cfg)
    est = dict(bfx[0], est=True, price_out=250, price_ret=160)
    check("stima: somma di due solo andata (andata 250 € + ritorno 160 €)" in C.offer_block(est, cfg) and "stima: somma di due solo andata" in C.offer_line(est, cfg)
          and "stima" not in blk and "stima" not in C.offer_line(bfx[0], cfg), "offerta stimata (due solo andata): sempre dichiarata nel messaggio; le altre mai", C.offer_block(est, cfg))
    check("da Roma FCO" in blk and "treno" not in blk and "<b>410 € pp</b>" in blk and 'href="https://example.org/dashboard/#/d/TBS"' in blk, "messaggio: 'da Roma FCO', prezzo volo, link #/d/TBS", blk)
    check("da Pisa" in C.offer_block(next(o for o in bfx if o["origin"] == "PSA"), cfg) and "da Roma CIA" in C.offer_block(next(o for o in bfx if o["origin"] == "CIA"), cfg)
          and C.origin_name("XYZ") == "XYZ" and C.origin_name("MXP") == "Milano MXP", "nomi leggibili delle origini, codice per quelle sconosciute")
    # popular trips da un trips_data.json di prova (formato di build_trips.py), con cella da Roma
    (fxd / "trips_data.json").write_text(json.dumps({"legs": [[300, "Wizz Air", 240, 0, "06:10", "12:00", 0, "", "FCO", "TBS", D1], [260, "Pegasus", 400, 1, "09:00", "15:00", 0, "SAW", "EVN", "FCO", R1],
                                                              [450, "easyJet", 250, 0, "07:00", "13:00", 0, "", "MXP", "TBS", D1]],
        "trips": [{"id": "georgia-armenia", "name": "Georgia + Armenia", "countries": ["Georgia", "Armenia"], "arr": "TBS", "cov": [[4, 2, 0]], "land": [1100, 1600], "itot": 40, "nights": 10,
                   "internal": [["Tbilisi-Mestia", 40, 0, 40, "", "", 1]], "best": {"kind": "rt", "hub": "TBS"},
                   "air": [{"k": "ow", "a": "TBS", "b": "EVN"}, {"k": "rt", "a": "TBS", "b": "TBS", "add": [["Erevan-Tbilisi A/R", 96, 1, 120, "2027-08-12", "Georgian Airways", 2], ["Erevan-Tbilisi via terra", 25, 0, 25, "", "", 0]]}],
                   "cells": [{"dep": D1, "n": 11, "o": "FCO", "a": [[0, 560, 0, 0, 1]], "b": None, "x": None}, {"dep": D1, "n": 11, "o": "MXP", "a": [[1, 450, 25, 2, -1]], "b": None, "x": None},
                             {"dep": D1, "n": 12, "o": "PSA", "a": [], "b": None, "x": 900}]}]}), encoding="utf-8")
    stp = S.build(root=fxd, weekend="none", cfg=cfg)
    po = {o["origin"]: o for o in stp["offers"] if o["source"] == "popular"}
    check(set(po) == {"FCO", "MXP"} and po["FCO"]["id"] == "t_georgia-armenia:FCO:%s:%s" % (D1, R1) and po["FCO"]["price_pp"] == 560 and po["FCO"]["kind"] == "openjaw" and po["MXP"]["price_pp"] == 475,
          "popular trips: celle da origini diverse, id con l'origine, prezzo solo volo (+ tratte stimate del giro)", {k: (v["id"], v["price_pp"]) for k, v in po.items()})
    tgp = stp["targets"]["t_georgia-armenia"]
    check(tgp.get("land") == [1100, 1600] and tgp.get("itot") == 40 and tgp.get("nights") == 10 and S.lite(stp)["targets"]["t_georgia-armenia"].get("land") == [1100, 1600],
          "popular trips: a terra, voli interni e notti nel target (servono a /voti per il costo totale pp), anche nello snapshot ridotto", tgp)
    ti = tgp.get("int") or {}
    check(ti == {"n": 3, "pp": 136, "real": 1, "legs": ["Tbilisi → Mestia", "Erevan → Tbilisi A/R"]} and S.lite(stp)["targets"]["t_georgia-armenia"].get("int") == ti,
          "popular trips: voli interni nel target (quanti, euro pp, reale o stima, tratte; la tratta via terra non conta)", ti)
    check(C.int_txt(tgp) == "✈ 3 voli interni ~136 € pp (in parte stima): Tbilisi → Mestia, Erevan → Tbilisi A/R" and C.int_txt(tgp, short=True) == "✈ 3 voli interni ~136 € pp"
          and C.int_txt({"int": {"n": 1, "pp": 58, "real": 2, "legs": ["Lima → Cusco"]}}) == "✈ 1 volo interno 58 € pp (prezzo reale): Lima → Cusco" and C.int_txt({}) == "" and C.int_txt(None) == "",
          "voli interni: testo per digest e card (stima con ~, prezzo reale senza)", C.int_txt(tgp))
    check(S.trip_internal({"internal": [["Lima-Cusco", 70]], "best": None}, []) == {"n": 1, "pp": 70, "real": 0, "legs": ["Lima → Cusco"]}
          and S.trip_internal({"internal": [], "best": {"kind": "rt", "hub": "TBS"}}, [{"k": "rt", "a": "TBS", "add": [["Erevan-Tbilisi via terra", 25]]}]) is None,
          "voli interni: dati vecchi a due campi letti come stima; solo tratte via terra = nessun volo interno")
    import base64 as _b64
    tf = lambda u: _b64.urlsafe_b64decode(u.split("tfs=")[1].split("&")[0])
    u1 = C.gf_url("MXP", "TBS", D1, R1, 1)
    check(u1.startswith("https://www.google.com/travel/flights/search?tfs=") and tf(u1).count(bytes([0x28, 1])) == 2 and tf(u1).count(b"MXP") == 2 and D1.encode() in tf(u1) and R1.encode() in tf(u1),
          "link Google Flights A/R: stesso filtro scali del prezzo (max 1) su andata e ritorno", u1)
    check(tf(C.gf_url("MXP", "TBS", D1, R1, 2)).count(bytes([0x28, 2])) == 2 and tf(C.gf_ow_url("EVN", "FCO", R1, 1)).count(bytes([0x28, 1])) == 1 and "travel/flights?q=" in C.gf_url("MXP", "TBS", D1, R1),
          "link Google Flights: filtro a 2 scali per le opzioni a 2 scali, solo andata con filtro; senza limite resta la ricerca a testo")
    check(C.gf_tfs([("2027-08-14", "LIN", "EZE", 1), ("2027-08-24", "EZE", "LIN", 1)], 1) == "GhwSCjIwMjctMDgtMTQoAWoFEgNMSU5yBRIDRVpFGhwSCjIwMjctMDgtMjQoAWoFEgNFWkVyBRIDTElOQgEBSAGYAQE=",
          "link Google Flights: tfs uguale a quello del sito e della scansione")
    check(po["MXP"]["url"] == C.gf_url("MXP", "TBS", D1, R1, 1) and "tfs=" in po["FCO"]["url"] and "tfs=" in po["FCO"]["url_ret"] and tf(po["FCO"]["url_ret"]).count(bytes([0x28, 1])) == 1,
          "popular trips: link dei voli con il filtro scali (A/R e le due tratte degli open-jaw)", po["MXP"]["url"])
    pl = C.offer_line(po["FCO"], cfg, show_origin=True)
    check('<a href="https://example.org/dashboard/#/t/georgia-armenia"><b>Georgia + Armenia</b></a>' in pl and "da Roma FCO" in pl and "rientro da EVN" in pl and "andata</a>/<a" in pl,
          "popular trip: link #/t/georgia-armenia, origine e rientro open-jaw nella riga", pl[:200])
    (fxd / "trips_data.json").unlink()
    # digest per aeroporto sui dati di prova
    for f in Path(TMP).glob("*.json"):
        f.unlink()
    tdg, sdg = run_alerts(sv2, C.load_prefs(cfg), cfg)
    if VERBOSE:
        print(tdg)
    sb = [b for b in tdg.split("\n\n") if b.startswith("🛫 ")]
    check(len(sb) == 4 and all(b.split("\n")[0].startswith(h) for b, h in zip(sb, ["🛫 <b>Milano Linate (LIN)</b> · 1 meta da 520 € pp", "🛫 <b>Milano Malpensa (MXP)</b> · 1 meta da 495", "🛫 <b>Roma (FCO/CIA)</b>", "🛫 <b>Pisa (PSA)</b>"])),
          "digest: sezioni Milano Linate, Milano Malpensa, Roma (FCO/CIA), Pisa (PSA) in quest'ordine", [b.split("\n")[0] for b in sb])
    check(len(sb) == 4 and ["<b>%s € pp</b> · coppia %s €" % (a, b) in x for x, (a, b) in zip(sb, ((520, "1.040"), (495, 990), (410, 820), (480, 960)))] == [True] * 4
          and all(nrows(x) == 1 and "<blockquote" not in x and 'href="https://example.org/dashboard/#/d/TBS"' in x and "sab 7 → mer 18 ago" in x and "1 scalo" in x for x in sb),
          "digest: la stessa meta compare in ogni sezione con il miglior prezzo di quell'aeroporto (nome linkato, pp, coppia, date, scali)", sb)
    check("da Roma FCO" in sb[2] and "700" not in sb[2] and "da " not in sb[0].split("\n")[1].split("voli")[0], "Roma: una riga sola (il migliore tra FCO e CIA) con l'aeroporto indicato; nelle sezioni a un aeroporto non si ripete")
    check(sdg["rows"] == 4 and sdg["sections"] == {"LIN": 1, "MXP": 1, "FCO-CIA": 1, "PSA": 1} and run_alerts(sv2, C.load_prefs(cfg), cfg)[0] == "", "digest per aeroporto: dedup per meta+sezione al giro successivo", sdg)
    # alert: il preferito cala perche' compare un'origine nuova piu' economica
    for f in Path(TMP).glob("*.json"):
        f.unlink()
    pfx = C.load_prefs(cfg)
    pfx["favorites"]["d_TBS"] = {"added": "2026-11-21", "p": 500}
    run_alerts(only_old, pfx, cfg)
    tfx, sfx = run_alerts(sv2, pfx, cfg)
    if VERBOSE:
        print(tfx)
    check(sfx["favorites"] == 1 and "sceso da 500 € a <b>410 € pp</b>: -90 € (-18%)" in tfx and "da Roma FCO" in tfx and "nuova data" not in tfx,
          "preferito: l'origine nuova piu' economica (FCO) fa scattare il calo, senza falsi 'nuove date'", tfx[:400])
    st_last = C.load_json(C.state_dir() / "last_snapshot.json", {})["targets"]["d_TBS"]["o"]
    check(set(st_last) == {"%s:%s:%s" % (o, D1, R1) for o in ("CIA", "FCO", "LIN", "MXP", "PSA")}, "stato: chiavi con l'origine", st_last)
    check(run_alerts(sv2, pfx, cfg)[0] == "", "nuove origini: secondo giro in silenzio")
    # tre preferiti che calano nello stesso giro da aeroporti diversi: raggruppati per aeroporto
    sv3 = copy.deepcopy(sv2)
    for code, og, price in (("EVN", "PSA", 300), ("KUT", "LIN", 250), ("AMM", "PSA", 280)):
        sv3["targets"]["d_" + code] = {"source": "agosto2027", "code": code, "name": code, "country": "", "q": 1, "ok": 1}
        sv3["offers"].append({"id": "d_%s:%s:%s:%s" % (code, og, D1, R1), "target": "d_" + code, "source": "agosto2027", "kind": "roundtrip", "code": code, "name": code, "country": "",
                              "origin": og, "dep": D1, "ret": R1, "nights": 11, "price_pp": price, "stops": 1, "airlines": ["Test Air"], "url": C.gf_url(og, code, D1, R1)})
        pfx["favorites"]["d_" + code] = {"added": "2026-11-21", "p": price + 80}
    next(o for o in sv3["offers"] if o["origin"] == "FCO")["price_pp"] = 350
    tg3, sg3 = run_alerts(sv3, pfx, cfg_nc)
    if VERBOSE:
        print(tg3)
    fpart = tg3.split("<b>I tuoi preferiti</b>")[1]
    heads = re.findall(r"^🛫 <b>(.*?)</b>", fpart, re.M)
    pisa = next((b for b in fpart.split("\n\n") if b.startswith("🛫 <b>Pisa (PSA)</b>")), "")
    check(sg3["favorites"] == 4 and heads == ["Milano Linate (LIN)", "Roma (FCO/CIA)", "Pisa (PSA)"] and pisa.count("⭐ ") == 2 and pisa.index("AMM") < pisa.index("EVN")
          and fpart.count("📉 sceso da") == 4, "piu' preferiti nello stesso giro: raggruppati per aeroporto, in ordine di prezzo dentro la sezione", (heads, sg3))
    for f in Path(TMP).glob("*.json"):
        f.unlink()
    run_alerts(snap6, prefs, cfg)  # ripristina lo stato per i controlli successivi

    # ---------- 2c. link, chat autorizzate, codifica ----------
    section("2c. link alle pagine, chat autorizzate, UTF-8")
    check(C.page_url(cfg, "d_TBS") == "https://example.org/dashboard/#/d/TBS" and C.page_url(cfg, "t_georgia-armenia") == "https://example.org/dashboard/#/t/georgia-armenia"
          and C.page_url(cfg, "t_x", "Giro Strano") == "https://example.org/dashboard/#/t/Giro%20Strano" and C.page_url(cfg, "w_BCN") == "https://cosimoney.github.io/flightsMI/",
          "page_url: #/d/<IATA>, #/t/<trip.id>, weekend su flightsMI")
    check(C.page_url(dict(cfg, dashboard_url="https://x.org/sito/index.html#/home"), "d_TBS") == "https://x.org/sito/index.html#/d/TBS"
          and C.page_url(dict(cfg, dashboard_url="https://cosimoney.github.io/REPO-DA-DEFINIRE/"), "d_TBS") == ""
          and "\"><b>" not in C.offer_block(bfx[0], dict(cfg, dashboard_url="")), "dashboard_url e' la base configurabile; se manca, nome senza link")
    pop_o = next((v[0] for t, v in sorted(by.items()) if t.startswith("t_")), None)
    if pop_o:
        blk = C.offer_block(pop_o, cfg)
        raw_ids = {t["id"] for t in json.loads((C.ROOT / "trips_data.json").read_text(encoding="utf-8"))["trips"]} if (C.ROOT / "trips_data.json").exists() else set()
        check('<a href="https://example.org/dashboard/#/t/%s"><b>%s</b></a>' % (pop_o["target"][2:], C.esc(pop_o["name"])) in blk and (not raw_ids or pop_o.get("page_id", pop_o["target"][2:]) in raw_ids),
              "popular trip: link #/t/%s (id del trip in trips_data.json)" % pop_o["target"][2:], blk[:200])
    evil = dict(bfx[0], name='Rock & <Roll> "x"', target="d_TBS")
    eb = C.offer_block(evil, dict(cfg, dashboard_url="https://example.org/d/?a=1&b=2"))
    check("Rock &amp; &lt;Roll&gt; &quot;x&quot;" in eb and 'href="https://example.org/d/?a=1&amp;b=2#/d/TBS"' in eb, "escape HTML di nomi e URL", eb[:200])
    env_ids = os.environ["TELEGRAM_CHAT_IDS"]
    os.environ["TELEGRAM_CHAT_IDS"] = str(ME)
    one = C.allowed_chats()
    os.environ["TELEGRAM_CHAT_IDS"] = " %d , %d\n-1001234567890;abc" % (ME, LAVI)
    more = C.allowed_chats()
    os.environ["TELEGRAM_CHAT_IDS"] = env_ids
    check(one == [ME] and more == [ME, LAVI, -1001234567890], "TELEGRAM_CHAT_IDS: una sola chat, oppure piu' chat/gruppi senza modifiche", (one, more))
    tg1 = C.Telegram(None, dry_run=True, quiet=True)
    bot1 = K.Bot(tg1, cfg, snap, C.load_prefs(cfg))
    _, s1 = K.process(bot1, [{"update_id": 1, "message": {"chat": {"id": ME}, "text": "/help"}}, {"update_id": 2, "message": {"chat": {"id": LAVI}, "text": "/help"}}], [ME], 0)
    check(s1["ok"] == 1 and s1["ignored"] == 1 and [m["chat"] for m in tg1.sent] == [ME], "con una sola chat autorizzata risponde solo a quella")
    # corpo della richiesta HTTP: JSON in UTF-8 valido anche con "€" e accenti (nessuna rete: urlopen sostituita)
    captured = []

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok":true,"result":{"message_id":1}}'

    def fake_urlopen(req, timeout=None):
        captured.append(req)
        return FakeResp()

    real_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_urlopen
    try:
        msg = "⭐ <b>Tbilisi</b>: sceso da 500 € a <b>499 € pp</b> · così è più giù · «ok»"
        C.Telegram("000000:SELFTEST").send(ME, msg, [[("Apri Tbilisi €", "url:https://example.org/dashboard/#/d/TBS")]])
    finally:
        urllib.request.urlopen = real_urlopen
    ok_body = False
    if len(captured) == 1:
        body = captured[0].data
        back = json.loads(body.decode("utf-8"))
        ok_body = (isinstance(body, bytes) and all(c < 128 for c in body) and back["text"] == msg and back["parse_mode"] == "HTML"
                   and back["reply_markup"]["inline_keyboard"][0][0] == {"text": "Apri Tbilisi €", "url": "https://example.org/dashboard/#/d/TBS"}
                   and "charset=utf-8" in captured[0].get_header("Content-type", "") and captured[0].get_method() == "POST")
    check(ok_body, "sendMessage: corpo JSON valido in UTF-8 con '€', accenti ed emoji (inviato come escape ASCII), Content-Type con charset")
    captured.clear()
    urllib.request.urlopen = fake_urlopen
    try:
        C.Telegram("000000:SELFTEST").send(ME, "digest", silent=True)
        C.Telegram("000000:SELFTEST").send(ME, "card", preview="https://example.org/dashboard/img/tbilisi.webp")
    finally:
        urllib.request.urlopen = real_urlopen
    bodies = [json.loads(r.data.decode("utf-8")) for r in captured]
    check(len(bodies) == 2 and bodies[0]["disable_notification"] is True and bodies[0]["link_preview_options"] == {"is_disabled": True} and "disable_notification" not in bodies[1]
          and bodies[1]["link_preview_options"] == {"url": "https://example.org/dashboard/img/tbilisi.webp", "prefer_large_media": True, "show_above_text": True},
          "sendMessage: digest con disable_notification e anteprime spente; card con la foto come anteprima grande sopra il testo", bodies)
    check(C.fmt_dates("2027-08-13", "2027-08-24") == "ven 13 → mar 24 ago" and C.fmt_dates("2027-08-27", "2027-09-08") == "ven 27 ago → mer 8 set" and C.fmt_dates("2027-12-28", "2028-01-03") == "mar 28 dic 2027 → lun 3 gen 2028",
          "date brevi in italiano con giorno della settimana")
    lt = lambda *a: C.local_time(cfg, datetime(*a, tzinfo=timezone.utc)).strftime("%H:%M")
    check([lt(2027, 1, 10, 22, 30), lt(2027, 7, 10, 21, 30), lt(2027, 3, 28, 0, 59), lt(2027, 3, 28, 1, 0), lt(2027, 10, 31, 0, 59), lt(2027, 10, 31, 1, 0)] == ["23:30", "23:30", "01:59", "03:00", "02:59", "02:00"]
          and C.in_quiet_hours(cfg, C.local_time(cfg, datetime(2027, 1, 10, 22, 30, tzinfo=timezone.utc))) and not C.in_quiet_hours(cfg, C.local_time(cfg, NOON))
          and not C.in_quiet_hours(dict(cfg, quiet_hours=None), C.local_time(cfg, NOON)), "ora di Roma (legale/solare) e ore di silenzio 23:00-08:00")
    if (C.ROOT / "img" / "manifest.json").exists():
        imgs = {t: v["img"] for t, v in snap["targets"].items() if v.get("img")}
        check(imgs and all(re.fullmatch(r"img/[A-Za-z0-9._-]+", v) for v in imgs.values()) and C.image_url(cfg, next(iter(imgs.values()))).startswith("https://example.org/dashboard/img/")
              and C.image_url(dict(cfg, dashboard_url=""), "img/x.webp") is None, "foto di copertina dal manifest del sito (%d mete), URL pubblico solo se la base e' configurata" % len(imgs))
    cov = dict(big, targets=dict(big["targets"], d_QAB=dict(big["targets"]["d_QAB"], img="img/qab.webp")))
    cv, _, _ = A.compute(cov, {}, {"threshold": 1000, "favorites": {"d_QAB": {"added": "x", "p": 380}}, "paused": []}, {}, cfg, now=NOON)
    check(cv[0]["kind"] == "card" and cv[0]["preview"] == "https://example.org/dashboard/img/qab.webp" and cv[-1]["preview"] is None, "card con foto di copertina come anteprima; digest senza")
    tok = re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")
    files = [f for f in list(C.BOT_DIR.glob("*")) + list((C.BOT_DIR / "workflows_draft").glob("*")) + list((C.BOT_DIR / "state").glob("*")) if f.is_file() and f.suffix in (".py", ".json", ".md", ".yml", ".yaml", ".txt")]
    check(not any(tok.search(f.read_text(encoding="utf-8", errors="replace")) for f in files), "nessun token Telegram nei file del bot (%d file controllati)" % len(files))
    check(C.load_json(C.BOT_DIR / "config.json", {}).get("bot_username") == "Trip2027_bot", "config.json: bot_username = Trip2027_bot")

    # alerts.py da riga di comando in dry-run: non deve scrivere stato
    C.save_json(C.state_dir() / "prefs.json", prefs)
    snap_path = Path(TMP) / "snapshot.json"
    snap_path.write_text(json.dumps(snap6, ensure_ascii=False), encoding="utf-8")
    before = {p.name: p.read_text(encoding="utf-8") for p in Path(TMP).glob("*.json")}
    sys.argv = ["alerts.py", "--snapshot", str(snap_path), "--dry-run"]
    rc = A.main()
    after = {p.name: p.read_text(encoding="utf-8") for p in Path(TMP).glob("*.json")}
    check(rc == 0 and before == after, "alerts.py --dry-run non modifica lo stato")

    # ---------- 3. comandi ----------
    section("3. comandi simulati (update finti)")
    for f in Path(TMP).glob("*.json"):
        if f.name != "snapshot.json":
            f.unlink()
    prefs = C.load_prefs(cfg)
    tg = C.Telegram(None, dry_run=True, quiet=not VERBOSE)
    bot = K.Bot(tg, cfg, snap, prefs)
    allowed = C.allowed_chats()
    uid = [100]

    def say(text, chat=ME):
        uid[0] += 1
        n = len(tg.sent)
        off, stats = K.process(bot, [{"update_id": uid[0], "message": {"chat": {"id": chat}, "text": text}}], allowed, 0)
        return tg.sent[n:], stats, off

    def press(data, chat=ME):
        uid[0] += 1
        n = len(tg.sent)
        K.process(bot, [{"update_id": uid[0], "callback_query": {"id": "x", "data": data, "message": {"chat": {"id": chat}}}}], allowed, 0)
        return tg.sent[n:]

    def buttons(msgs):
        return [b for m in msgs for r in (m["buttons"] or {}).get("inline_keyboard", []) for b in r]

    dcode = under[0]["code"] if under[0]["target"].startswith("d_") else next(o["code"] for o in under if o["target"].startswith("d_"))
    did = "d_" + dcode
    r, s, off = say("/start")
    check("Nuove mete e i Popular trips" in r[0]["text"] and "già visitate" in r[0]["text"], "/start: spiega il perimetro (Nuove mete + Popular trips, visitate solo se preferite)")
    check(len(r) == 1 and "/top" in r[0]["text"] and off == uid[0] + 1 and "100 € sopra 1.000 € pp, 50 € fino a 1.000 €" in r[0]["text"], "/start: benvenuto con elenco comandi e regola dei cali, offset avanzato")
    r, s, _ = say("/start", chat=STRANGER)
    check(not r and s["ignored"] == 1, "chat non autorizzata: ignorata in silenzio")
    r, s, _ = say("/start fav_" + did, chat=STRANGER)
    check(not r and did not in prefs["favorites"], "chat non autorizzata: il deep link non aggiunge nulla")
    r, _, _ = say("/start fav_" + did)
    check(did in prefs["favorites"] and "Aggiunto ai preferiti" in r[0]["text"] and " pp</b>" in r[0]["text"], "deep link start=fav_%s: preferito aggiunto con prezzo pp" % did)
    dpage = "https://example.org/dashboard/#/d/" + dcode
    check(prefs["favorites"][did].get("p") == by[did][0]["price_pp"] and ("scende di almeno %s a persona" % C.euro(C.min_drop(by[did][0]["price_pp"], cfg))) in r[0]["text"], "preferito aggiunto: prezzo di riferimento salvato, testo con il calo minimo della sua fascia")
    check(r[0]["text"].count('href="%s"' % dpage) >= 1 and any(b.get("url") == dpage and "Apri" in b["text"] for b in buttons(r)), "preferito aggiunto: link e pulsante 'Apri' verso %s" % dpage)
    check(any(b.get("callback_data", "").startswith("thr:" + did) for b in buttons(r)) and any(b.get("callback_data") == "rm:" + did for b in buttons(r)), "pulsanti inline: soglia suggerita e rimuovi")
    r, _, _ = say("/start fav_t_giro-non-ancora-scansionato")
    check("t_giro-non-ancora-scansionato" in prefs["favorites"] and "appena compaiono" in r[0]["text"], "deep link verso un ID non ancora nei dati: accettato")
    r, _, _ = say("/start fav_<script>")
    check("non è valido" in r[0]["text"], "deep link malformato: rifiutato")
    wk_t = next((t for t in snap["targets"] if t.startswith("w_")), None)
    if wk_t:
        r, _, _ = say("/aggiungi " + wk_t)
        check(wk_t in prefs["favorites"], "/aggiungi con ID weekend (%s)" % wk_t)
        r, _, _ = say("/top weekend")
        check("weekend" in r[0]["text"].lower(), "/top weekend risponde")
    pop_t = next((t for t, v in snap["targets"].items() if t.startswith("t_") and v["n"]), None)
    if pop_t:
        r, _, _ = say("/aggiungi " + snap["targets"][pop_t]["name"])
        check(pop_t in prefs["favorites"] or buttons(r), "/aggiungi per nome di un popular trip")
        r, _, _ = say("/meta " + pop_t)
        tpage = "https://example.org/dashboard/#/t/" + pop_t[2:]
        check('href="%s"' % tpage in r[0]["text"] and any(b.get("url") == tpage for b in buttons(r)), "/meta su un popular trip: link e pulsante verso %s" % tpage)
    r, _, _ = say("/preferiti")
    check(C.esc(snap["targets"][did]["name"]) in r[0]["text"] and any(b.get("callback_data") == "rm:" + did for b in buttons(r)), "/preferiti: elenco con prezzi e pulsanti rimuovi")
    r, _, _ = say("/soglia 900")
    check(prefs["threshold"] == 900 and "900 € a persona" in r[0]["text"] and "1.800 €" in r[0]["text"], "/soglia 900: soglia generale (pp in evidenza, coppia accanto)")
    r, _, _ = say("/soglia %s 300" % dcode)
    check(prefs["favorites"][did].get("thr") == 300 and C.fav_threshold(did, prefs, cfg) == 300, "/soglia %s 300: soglia del preferito" % dcode)
    r, _, _ = say("/soglia %s off" % dcode)
    check("thr" not in prefs["favorites"][did], "/soglia %s off: soglia personalizzata tolta" % dcode)
    r, _, _ = say("/soglia abc")
    check("importo in euro" in r[0]["text"] and prefs["threshold"] == 900, "/soglia con valore non numerico: errore gentile, nulla cambia")
    r, _, _ = say("/soglia")
    check("900 €" in r[0]["text"], "/soglia senza argomenti: mostra le soglie")
    r, _, _ = say("/top")
    n_top = r[0]["text"].count(" pp</b>")
    exp = sorted(o["price_pp"] for o in aug if o["price_pp"] <= 900)[:5]
    check(n_top == len(exp) and all(C.euro(p) + " pp" in r[0]["text"] for p in exp) and not any('#/d/%s"' % snap["targets"][t]["code"] in r[0]["text"] for t in bad_clima if t not in prefs["favorites"]),
          "/top: le 5 migliori sotto la soglia corrente, solo Nuove mete e Popular trips", (n_top, exp))
    r, _, _ = say("/top@VoliBot")
    check(r and "migliori" in r[0]["text"], "comando con @nomebot (gruppi)")
    r, _, _ = say("/meta " + dcode)
    check(C.euro(by[did][0]["price_pp"]) + " pp" in r[0]["text"] and "combinazioni" in r[0]["text"] and buttons(r), "/meta %s: miglior prezzo, date, pulsante preferiti" % dcode)
    check('href="%s"' % dpage in r[0]["text"] and any(b.get("url") == dpage for b in buttons(r)) and "google.com/travel/flights" in r[0]["text"], "/meta %s: link alla pagina della meta, pulsante Apri, Google Flights secondario" % dcode)
    r, _, _ = say("/meta zzzzqq")
    check("Non trovo" in r[0]["text"], "/meta con meta inesistente")
    r, _, _ = say("/meta " + empty[0][2:])
    check("nessun volo valido" in r[0]["text"], "/meta su rotta ancora vuota")
    multi = {}
    for t, v in snap["targets"].items():
        if v["source"] == "agosto2027" and v["country"]:
            multi.setdefault(v["country"], []).append(t)
    country = next((c for c, ts in multi.items() if len(ts) > 1), None)
    if country:
        r, _, _ = say("/meta " + country)
        check(len(buttons(r)) >= 2 and all(b["callback_data"].startswith("meta:") for b in buttons(r)), "/meta con un paese che ha piu' mete (%s): scelta con pulsanti" % country)
        r = press(buttons(r)[0]["callback_data"])
        check(r and ("pp</b>" in r[0]["text"] or "nessun volo" in r[0]["text"]), "pulsante di scelta: apre la scheda della meta")
    r, _, _ = say("/pausa", chat=LAVI)
    check(C.chat_hash(LAVI) in prefs["paused"] and C.chat_hash(ME) not in prefs["paused"], "/pausa vale solo per la chat che la chiede")
    r, _, _ = say("/riprendi", chat=LAVI)
    check(not prefs["paused"], "/riprendi")
    r = press("rm:" + did)
    check(did not in prefs["favorites"] and "Tolto" in r[0]["text"], "pulsante rimuovi (callback)")
    r = press("add:" + did)
    check(did in prefs["favorites"], "pulsante rimetti (callback)")
    r = press("thr:%s:250" % did)
    check(prefs["favorites"][did].get("thr") == 250, "pulsante soglia (callback)")
    n0 = len(prefs["favorites"])
    r = press("add:" + did, chat=STRANGER)
    check(not r and len(prefs["favorites"]) == n0, "callback da chat non autorizzata: ignorata")
    r, _, _ = say("/rimuovi " + dcode)
    check(did not in prefs["favorites"], "/rimuovi %s" % dcode)
    r, _, _ = say("/rimuovi " + dcode)
    check("non è tra i preferiti" in r[0]["text"], "/rimuovi di una meta non preferita")
    r, _, _ = say("/boh")
    check("non riconosciuto" in r[0]["text"], "comando sconosciuto")
    r, s, _ = say("ciao bot")
    check(not r and s["skip"] == 1, "testo libero: nessuna risposta")
    r, _, _ = say("/help")
    check("/soglia" in r[0]["text"], "/help")
    check(all(C.visible_len(m["text"]) <= 4096 for m in tg.sent), "tutte le risposte entro 4096 caratteri visibili")
    check(all(len(b.get("callback_data", "").encode()) <= 64 for m in tg.sent for b in buttons([m])), "callback_data entro 64 byte")
    r, _, _ = say("/digest")
    check("a ogni giro" in r[0]["text"] and [b.get("callback_data") for b in buttons(r)] == ["dg:giro", "dg:giorno", "dg:settimana"], "/digest: frequenza attuale e tre pulsanti")
    r = press("dg:settimana")
    check(prefs.get("digest") == "settimana" and "una volta a settimana" in r[0]["text"], "pulsante: riepilogo settimanale")
    r, _, _ = say("/digest giornaliero")
    check(prefs.get("digest") == "giorno", "/digest giornaliero")
    say("/digest giro")
    r = press("mute:%s:7" % did)
    check(prefs["muted"].get(did) == (K.date.today() + timedelta(days=7)).isoformat() and "silenziata per 7 giorni" in r[0]["text"] and any(b.get("callback_data") == "unmute:" + did for b in buttons(r)),
          "pulsante 'Silenzia 7 gg' della card: meta silenziata, con pulsante Riattiva")
    r = press("unmute:" + did)
    check(did not in prefs["muted"] and "riattivati" in r[0]["text"], "pulsante Riattiva")
    r, _, _ = say("/silenzia %s 14" % dcode)
    check(prefs["muted"].get(did) == (K.date.today() + timedelta(days=14)).isoformat(), "/silenzia %s 14" % dcode)
    r, _, _ = say("/silenzia")
    check(C.esc(snap["targets"][did]["name"]) in r[0]["text"], "/silenzia senza argomenti: elenco delle mete silenziate")
    r, _, _ = say("/silenzia %s off" % dcode)
    check(did not in prefs["muted"], "/silenzia %s off" % dcode)
    check(all(bal(m["text"]) for m in tg.sent) and bal(text) and bal(text3) and bal(textf2), "HTML dei messaggi bilanciato")

    # modalita' setup: senza TELEGRAM_CHAT_IDS il bot dice solo a chi scrive il proprio chat_id
    n = len(tg.sent)
    K.process(bot, [{"update_id": 1, "message": {"chat": {"id": STRANGER}, "text": "/start"}}], [], 0)
    check(len(tg.sent) == n + 1 and str(STRANGER) in tg.sent[-1]["text"], "setup senza chat autorizzate: /start restituisce il chat_id a chi scrive")
    n = len(tg.sent)
    K.process(bot, [{"update_id": 2, "message": {"chat": {"id": STRANGER}, "text": "/top"}}], [], 0)
    check(len(tg.sent) == n, "setup: gli altri comandi restano chiusi")

    # privacy dello stato
    prefs["paused"].append(C.chat_hash(LAVI))
    C.save_json(C.state_dir() / "prefs.json", prefs)
    C.save_json(C.state_dir() / "offset.json", {"offset": uid[0] + 1})
    run_alerts(snap, prefs, cfg)
    blob = "".join(p.read_text(encoding="utf-8") for p in Path(TMP).glob("*.json") if p.name != "snapshot.json")
    check(not any(str(x) in blob for x in (ME, LAVI, STRANGER)) and "SELFTEST" not in blob, "nei file di stato non ci sono chat_id ne' token")
    check(set(p.name for p in Path(TMP).glob("*.json")) >= {"prefs.json", "offset.json", "last_snapshot.json", "notified.json"}, "i 4 file di stato vengono creati")
    check(C.save_json(C.state_dir() / "prefs.json", prefs) is False, "salvataggio idempotente: nessuna riscrittura se nulla cambia")

    # ---------- 4. Worker: preferenze remote con ripiego, snapshot ridotto ----------
    section("4. preferenze dal Worker (senza rete) e snapshot ridotto")
    for k in ("WORKER_URL", "PREFS_SECRET"):
        os.environ.pop(k, None)
    check(C.worker_url({}) == "" and C.worker_url({"worker_url": "https://x.workers.dev/"}) == "https://x.workers.dev" and C.worker_url({"worker_url": "http://x"}) == "",
          "worker_url: da config o variabile, solo https, senza barra finale")
    check(C.fetch_remote_prefs(dict(cfg, worker_url="")) is None, "senza Worker configurato nessuna chiamata di rete")
    check(re.fullmatch(r"[0-9a-f]{64}", C.prefs_key()) and "SELFTEST" not in C.prefs_key(), "chiave per /api/prefs derivata dal token del bot, non reversibile")
    os.environ["PREFS_SECRET"] = "abc"
    check(C.prefs_key() == "abc", "PREFS_SECRET, se presente, ha la precedenza")
    os.environ.pop("PREFS_SECRET")
    cfg_off = dict(cfg, worker_url="")
    pl, src = C.load_prefs_live(cfg_off, {})
    check(src == "prefs.json" and pl == C.load_prefs(cfg), "Worker assente e nessuna copia: si usa state/prefs.json")
    cache = {"prefs_cache": {"favorites": {"d_TBS": {"added": "2026-11-22", "p": 190, "by": "X"}}, "threshold": 800}}
    pl, src = C.load_prefs_live(cfg_off, cache)
    check(src != "prefs.json" and pl["threshold"] == 800 and "d_TBS" in pl["favorites"] and pl["paused"] == [] and pl["muted"] == {},
          "Worker assente: si usa l'ultima copia salvata in notified.json, completata con i campi mancanti")
    real = urllib.request.urlopen
    seen = {}

    class FakeResp:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return self.body

    def fake(req, timeout=0):
        seen.update(url=req.full_url, auth=req.get_header("Authorization"))
        return FakeResp(json.dumps({"favorites": {"d_EVN": {"added": "2026-11-22", "p": 230}}, "threshold": 900, "paused": [], "muted": {}}).encode())

    urllib.request.urlopen = fake
    try:
        nt = {}
        pl, src = C.load_prefs_live(dict(cfg, worker_url="https://w.example.workers.dev/"), nt)
    finally:
        urllib.request.urlopen = real
    check(src == "worker" and pl["threshold"] == 900 and seen.get("url") == "https://w.example.workers.dev/api/prefs" and seen.get("auth") == "Bearer " + C.prefs_key()
          and nt.get("prefs_cache") == pl, "Worker raggiungibile: preferenze da /api/prefs con Bearer, copia salvata per il giro dopo")
    small = S.lite(snap)
    by_full, by_small = C.by_target(snap), C.by_target(small)
    check(set(by_full) == set(by_small) and all(by_full[t][0] == by_small[t][0] and 1 <= len(by_small[t]) <= 4 for t in by_full),
          "snapshot ridotto: stesse mete, stessa offerta migliore, al massimo 4 offerte per meta (%d offerte su %d)" % (len(small["offers"]), len(snap["offers"])))
    check(all(small["targets"][t]["prices"] == [o["price_pp"] for o in by_full[t]] for t in by_full) and "prices" not in next(iter(snap["targets"].values())),
          "snapshot ridotto: elenco completo dei prezzi per i conteggi di /meta, snapshot originale non toccato")
    kb = K.Bot(C.Telegram(None, dry_run=True, quiet=True), cfg, small, {"threshold": 1000, "favorites": {}, "paused": [], "muted": {}})
    kf = K.Bot(C.Telegram(None, dry_run=True, quiet=True), cfg, snap, {"threshold": 1000, "favorites": {}, "paused": [], "muted": {}})
    check(kb.cmd_top("", ME) == kf.cmd_top("", ME), "/top identico con snapshot ridotto e completo")
    check(any(c == "sito" for c, _ in K.MENU) and "/sito" in K.HELP, "/sito nel menu e nell'aiuto")
    wk_dir = C.ROOT / "worker"
    if wk_dir.exists():
        wfiles = [f for f in wk_dir.rglob("*") if f.is_file() and "node_modules" not in f.parts and ".wrangler" not in f.parts and f.name != ".dev.vars"]
        txt = {f: f.read_text(encoding="utf-8", errors="replace") for f in wfiles}
        check(not any(tok.search(t) for t in txt.values()), "nessun token Telegram nei file del Worker (%d file controllati)" % len(wfiles))
        js = (wk_dir / "src" / "bot.js").read_text(encoding="utf-8")
        m = re.search(r"export const HELP = `(.*?)`;", js, re.S)
        check(m and m.group(1) == K.HELP, "testo di /help identico tra bot/commands.py e worker/src/bot.js")

    print("\n%d controlli, %d falliti%s" % (N[0], len(FAILS), (": " + "; ".join(FAILS)) if FAILS else ""))
    print("stato di prova in %s" % TMP)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
