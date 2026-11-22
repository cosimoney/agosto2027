# -*- coding: utf-8 -*-
"""Confronta bot/snapshot.json con lo stato precedente e manda gli avvisi del giro.

Uso:  python bot/alerts.py [--snapshot bot/snapshot.json] [--dry-run] [--save-state]

Due tipi di messaggio (vedi SETUP.md, "Formato dei messaggi"):

 A. ALERT ("card"), con suono, uno per messaggio: un preferito con novita' (calo oltre soglia, primi voli, passaggio
    sotto la sua soglia, nuove date) oppure un'offerta del digest molto sotto il prezzo tipico della meta
    (card_discount_pct, default 30%). Prima riga = meta + prezzo pp (e' quello che si legge nell'anteprima della
    notifica), poi date/aeroporto/scali, il contesto del prezzo ("sceso da X", "tipico Y") e i pulsanti: Apri pagina,
    Voli su Google, Rimuovi/Aggiungi preferito, Silenzia 7 giorni. Se la meta ha una foto di copertina (img/manifest.json
    del sito) viene mostrata come anteprima grande sopra il testo. Limiti: max_cards_per_run per giro e
    max_alerts_per_day al giorno; quello che eccede finisce nel digest. Nelle ore di silenzio (quiet_hours) le card
    partono lo stesso ma senza suono.

 B. DIGEST del giro, silenzioso (disable_notification), senza anteprime dei link: riga di riepilogo in testa
    ("5 novita' · da 190 € pp Tbilisi (MXP)"), poi le offerte sotto soglia raggruppate per aeroporto di partenza:
    "Milano Linate (LIN)", "Milano Malpensa (MXP)", "Roma (FCO/CIA)", "Pisa (PSA)". In ogni sezione una riga per meta con
    il miglior prezzo DA QUELL'AEROPORTO, in ordine di prezzo, max section_max_rows righe piu' "e altre N"; le sezioni
    con piu' di 3 righe stanno in un <blockquote expandable> (chiuso mostra le prime righe, si apre con un tocco).
    Frequenza scelta con /digest: a ogni giro, una volta al giorno, una volta a settimana (le novita' si accumulano).

Regole:
 - Soglia generale: una coppia meta+aeroporto entra nel digest la prima volta che scende sotto soglia e poi solo a ogni
   nuovo minimo "vero" secondo fav_drop_rules (100 euro se il riferimento e' sopra 1000 euro pp, 50 euro se e' <= 1000).
 - Preferiti: stesso criterio sul miglior prezzo pp della meta (qualsiasi data e aeroporto), anche sopra la soglia
   generale. Riferimento = prezzo dell'ultimo calo notificato (per un preferito appena aggiunto, il prezzo mostrato
   all'aggiunta). Un calo sotto soglia NON sposta il riferimento: i cali piccoli si sommano.
 - Perimetro del digest (common.in_digest): solo le destinazioni della tab "Nuove mete" (digest_tabs: ["new"]) e i
   Popular trips (digest_include_popular). Le destinazioni "Gia' visitati" e quelle con clima "sconsigliato"
   (digest_exclude_clima) compaiono solo se sono tra i preferiti, con le normali regole dei preferiti.
 - Una meta silenziata (pulsante "Silenzia 7 gg" o /silenzia) non genera avvisi fino alla scadenza; i riferimenti restano
   fermi, quindi alla riattivazione un calo accumulato viene segnalato.
 - Prezzo tipico = mediana dei minimi giornalieri della meta nelle scansioni precedenti (state/history.json); viene
   mostrato solo con almeno typical_min_samples giorni di storia.
 - Rotte prima vuote su cui compaiono voli: nel digest, anche sopra soglia.

Preferiti e soglie: la fonte di verita' e' il Worker Cloudflare (worker/, KV), che li riceve dal sito e dal bot. Qui si
leggono con GET <WORKER_URL>/api/prefs; se il Worker non risponde si usa l'ultima copia ricevuta (notified.json,
"prefs_cache") e in mancanza state/prefs.json.

File di stato scritti SOLO da questo script:
  state/last_snapshot.json  {generated, targets: {id meta: {s: fonte, n, min, o: {"ORIG:andata:ritorno": prezzo}}}}
  state/notified.json       {global: {"<id meta>@<sezione>": {min}}, fav: {id meta: {thr, last, under}},
                             cards: {day, n}, digest_last: "YYYY-MM-DD", prefs_cache: ultima copia delle preferenze}
  state/history.json        {id meta: [["YYYY-MM-DD", minimo pp del giorno], ...]}  (ultimi 90 giorni)
Gli id delle offerte (e quindi le chiavi di dedup) contengono l'origine: <meta>:<ORIG>:<andata>:<ritorno>.
In --dry-run i messaggi vengono stampati e lo stato NON viene scritto, a meno di --save-state.
Senza TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_IDS esce con codice 0 senza fare nulla (lo scan non deve fallire per il bot)."""
import argparse, copy, statistics, sys, time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C

HISTORY_DAYS = 90
DIGEST_EVERY = {"giro": 0, "giorno": 1, "settimana": 7}


def pct_txt(old, new):
    p = 100.0 * (old - new) / old if old else 0
    if p >= 10:
        return "%d" % round(p)
    return ("%.1f" % p).replace(".", ",") if p >= 0.05 else "<0,1"


def okey(o):
    return o["id"].split(":", 1)[1]


def typical(history, tid, cfg, today=None):
    """Mediana dei minimi giornalieri della meta nei giorni PRECEDENTI a oggi. None se la storia e' troppo corta."""
    vals = [v for d, v in (history or {}).get(tid, []) if d != today and isinstance(v, (int, float)) and v > 0]
    return int(round(statistics.median(vals))) if len(vals) >= cfg["typical_min_samples"] else None


def typical_txt(typ, price):
    if not typ:
        return ""
    if price < typ:
        return "📊 tipico %s pp: ora %s sotto (-%s%%)" % (C.euro(typ), C.euro(typ - price), pct_txt(typ, price))
    return "📊 tipico %s pp" % C.euro(typ)


def card_buttons(o, cfg, fav):
    tid = o["target"]
    r1 = [C.url_button("🔗 Apri pagina", C.page_url(cfg, tid, o.get("page_id"))), C.url_button("✈️ Voli su Google", o.get("url") or "")]
    r2 = [("❌ Rimuovi preferito", "rm:%s" % tid) if fav else ("⭐ Preferito", "add:%s" % tid), ("🔕 Silenzia %d gg" % cfg["mute_days"], "mute:%s:%d" % (tid, cfg["mute_days"]))]
    return [r for r in ([b for b in r1 if b], [b for b in r2 if len(b[1].encode()) <= 64]) if r]


def compute(snap, prev, prefs, notified, cfg, now=None, history=None):
    """-> (messaggi, nuovo last_snapshot, statistiche). Modifica notified e history sul posto.
    messaggio = {"kind": "card"|"digest", "text", "buttons", "silent", "preview": URL immagine | None}."""
    now = now or datetime.now(timezone.utc)
    local = C.local_time(cfg, now)
    today = local.date().isoformat()
    history = history if history is not None else {}
    by = C.by_target(snap)
    favs = prefs["favorites"]
    tinfo = snap.get("targets", {})
    muted = {t for t, until in (prefs.get("muted") or {}).items() if str(until) >= today}
    ptar = prev.get("targets") or {}
    first_run = not ptar
    prev_sources = {t.get("s") for t in ptar.values()}
    ok_sources = {s for s, st in snap.get("sources", {}).items() if st.get("ok")}
    nf = notified.setdefault("fav", {})
    for tid in [t for t in nf if t not in favs]:
        del nf[tid]  # tolto dai preferiti: se torna, riparte da zero
    # digest non dovuto in questo giro (frequenza giornaliera/settimanale): si calcola su una copia, cosi' le novita'
    # restano "non viste" e si accumulano fino al prossimo invio
    every = DIGEST_EVERY.get(prefs.get("digest") or cfg.get("digest_frequency") or "giro", 0)
    last_dg = notified.get("digest_last")
    try:
        digest_due = every == 0 or not last_dg or (date.fromisoformat(today) - date.fromisoformat(last_dg)).days >= every
    except ValueError:
        digest_due = True
    ng = notified.setdefault("global", {})
    if not digest_due:
        ng = copy.deepcopy(ng)

    def is_new_route(tid, src):
        if first_run or src not in prev_sources:
            return False  # primo giro (o fonte appena collegata): si fa solo la fotografia di partenza
        p = ptar.get(tid)
        return p is None or not p.get("n")

    mx = cfg["section_max_rows"]
    sec_info = {}  # chiave sezione -> (posizione, titolo, piu' aeroporti)

    def sec(o):
        i, key, title, multi = C.section_of(o.get("origin"), cfg)
        sec_info[key] = (i, title, multi)
        return key

    def sec_order(keys):
        return sorted(keys, key=lambda k: (sec_info[k][0], k))

    def cover(o):
        if not cfg.get("card_cover"):
            return None
        return C.image_url(cfg, (tinfo.get(o["target"]) or {}).get("img"))

    # 1) digest generale: per ogni meta, il miglior prezzo sotto soglia da ciascun aeroporto
    by_sec, new_routes, hot = {}, [], []
    n_clima = 0
    for tid, offers in by.items():
        if tid in favs or tid in muted:
            continue
        src = offers[0]["source"]
        if src == "weekend" and not cfg["weekend_global_alerts"]:
            continue
        if not C.in_digest(tid, tinfo.get(tid), cfg):
            n_clima += 1  # fuori perimetro (tab "Gia' visitati", clima sconsigliato...): solo se e' tra i preferiti
            continue
        thr = C.default_threshold(src, prefs, cfg)
        fresh = is_new_route(tid, src)
        if offers[0]["price_pp"] > thr:
            if fresh:
                new_routes.append((offers[0], len(offers)))
            continue
        per = {}
        for o in offers:  # gia' in ordine di prezzo
            if o["price_pp"] > thr:
                break
            per.setdefault(sec(o), [o, 0])[1] += 1
        notified_now = False
        for key, (best, n) in per.items():
            e = ng.setdefault("%s@%s" % (tid, key), {})
            if e.get("min") is None or C.is_drop(e["min"], best["price_pp"], cfg):
                e["min"] = best["price_pp"]  # il riferimento si sposta solo quando si notifica
                by_sec.setdefault(key, []).append((best, n, fresh))
                notified_now = notified_now or best is offers[0]
        typ = typical(history, tid, cfg, today)
        if notified_now and typ and offers[0]["price_pp"] <= typ * (1 - cfg["card_discount_pct"]):
            hot.append((offers[0], typ))  # molto sotto il tipico: merita una card con suono
    if not digest_due:
        by_sec, new_routes, hot = {}, [], []
    new_routes.sort(key=lambda r: r[0]["price_pp"])
    hot.sort(key=lambda h: h[0]["price_pp"] / float(h[1]))
    # stesso identico volo come destinazione e come popular trip (stesso aeroporto): una riga sola, il giro va in coda
    flight = lambda o: (o["code"], o["origin"], o["dep"], o["ret"], o["price_pp"], o.get("ret_from"))
    also, n_rows = {}, 0
    for key, rws in by_sec.items():
        rws.sort(key=lambda r: (r[0]["price_pp"], r[0]["source"] != "agosto2027", r[0]["name"]))
        first, merged = {}, []
        for r in rws:
            k = flight(r[0])
            if k in first and r[0]["source"] == "popular":
                also.setdefault(first[k], []).append(r[0]["name"])
                continue
            first.setdefault(k, r[0]["id"])
            merged.append(r)
        by_sec[key] = merged
        n_rows += len(merged)

    # 2) preferiti
    fav_events = []  # (chiave sezione, offerta, testo, c'e' un calo)
    for tid in sorted(favs):
        offers = by.get(tid)
        if not offers:
            continue
        best, src, p = offers[0], offers[0]["source"], ptar.get(tid)
        price = best["price_pp"]
        e = nf.setdefault(tid, {})
        for k in ("min", "keys"):
            e.pop(k, None)  # campi del vecchio formato
        if e.get("last") is None:
            # riferimento iniziale: il prezzo mostrato da commands.py al momento dell'aggiunta, altrimenti quello di oggi
            e["last"] = (favs.get(tid) or {}).get("p") or price
        if tid in muted:
            continue  # silenziata: nessun avviso e riferimenti fermi
        reasons = []
        if is_new_route(tid, src):
            reasons.append("🆕 primi voli pubblicati su questa rotta (%s)" % ("1 combinazione" if len(offers) == 1 else "%d combinazioni" % len(offers)))
        thr = C.fav_threshold(tid, prefs, cfg)
        if e.get("thr") != thr:
            e.update(thr=thr, under=False)  # soglia cambiata: il passaggio sotto soglia si rivaluta
        last = e["last"]
        dropped = C.is_drop(last, price, cfg)
        if dropped:
            reasons.append("📉 sceso da %s a <b>%s pp</b>: -%s (-%s%%)" % (C.euro(last), C.euro(price), C.euro(last - price), pct_txt(last, price)))
            e["last"] = price  # solo qui: un calo sotto soglia lascia il riferimento dov'e'
        if p and p.get("n"):
            old = {tuple(k.split(":")[1:]) for k in p.get("o", {})}
            fresh_dates = [o for o in offers if (o["dep"], o["ret"]) not in old]
            if fresh_dates:
                f = fresh_dates[0]
                reasons.append("📅 %d nuov%s: la migliore %s a %s pp" % (len(fresh_dates), "a data" if len(fresh_dates) == 1 else "e date", C.fmt_dates(f["dep"], f["ret"]), C.euro(f["price_pp"])))
        if price <= thr and not e.get("under"):
            reasons.append("🎯 sotto la tua soglia di %s pp" % C.euro(thr))
        e["under"] = price <= thr
        if reasons:
            tt = typical_txt(typical(history, tid, cfg, today), price)
            if tt:
                reasons.append(tt)
            fav_events.append((sec(best), best, C.offer_block(best, cfg) + "\n" + "\n".join("   " + r for r in reasons), dropped))
    fav_events.sort(key=lambda b: (not b[3], b[1]["price_pp"], b[1]["name"]))

    # 3) card: preferiti (prima i cali), poi le offerte molto sotto il tipico; il resto va nel digest
    cards_state = notified.get("cards") or {}
    sent_today = cards_state.get("n", 0) if cards_state.get("day") == today else 0
    room = cfg["max_cards_per_run"]
    if cfg["max_alerts_per_day"]:
        room = min(room, max(0, cfg["max_alerts_per_day"] - sent_today))
    quiet = C.in_quiet_hours(cfg, local)
    messages = []
    for key, best, block, dropped in fav_events[:room]:
        messages.append({"kind": "card", "text": ("📉 " if dropped else "⭐ ") + block, "buttons": card_buttons(best, cfg, True), "silent": quiet, "preview": cover(best)})
    fav_rest = fav_events[room:]
    room -= len(messages)
    for best, typ in hot[:max(0, room)]:
        block = C.offer_block(best, cfg) + "\n   " + typical_txt(typ, best["price_pp"])
        messages.append({"kind": "card", "text": "🔥 " + block, "buttons": card_buttons(best, cfg, False), "silent": quiet, "preview": cover(best)})
    n_cards = len(messages)
    if n_cards:
        notified["cards"] = {"day": today, "n": sent_today + n_cards}

    # 4) digest: blocchi separati da riga vuota (split_message spezza li'); titolo di sezione e righe restano uniti
    parts = []
    if n_rows:
        for key in sec_order(by_sec):
            rws = by_sec[key]
            if not rws:
                continue
            _, title, multi = sec_info[key]
            # l'aeroporto si ripete nella riga solo se nella sezione ce n'e' davvero piu' di uno con voli (FCO e CIA)
            multi = multi and len({o["origin"] for o in snap.get("offers", []) if C.section_of(o.get("origin"), cfg)[1] == key}) > 1
            lines = []
            for best, n, fresh in rws[:mx]:
                tail = []  # tutto sulla stessa riga: una riga per meta
                typ = typical(history, best["target"], cfg, today)
                if typ and best["price_pp"] <= typ * 0.9 and best is by[best["target"]][0]:
                    tail.append("-%s%% sul tipico" % pct_txt(typ, best["price_pp"]))
                if fresh:
                    tail.append("🆕 primi voli su questa rotta")
                for nm in also.get(best["id"], [])[:2]:
                    tail.append("vale anche per il giro «%s»" % C.esc(nm))
                lines.append("• " + C.offer_line(best, cfg, show_origin=multi) + "".join(" · " + x for x in tail))
            if len(rws) > mx:
                lines.append("e altre %d mete (da %s pp)" % (len(rws) - mx, C.euro(rws[mx][0]["price_pp"])))
            head = "🛫 <b>%s</b> · %s da %s pp" % (C.esc(title), "1 meta" if len(rws) == 1 else "%d mete" % len(rws), C.euro(rws[0][0]["price_pp"]))
            body = "\n".join(lines)
            parts.append(head + "\n" + ("<blockquote expandable>%s</blockquote>" % body if len(lines) > cfg["section_expand_after"] else body))
    if len(fav_rest) == 1:
        parts.append("<b>I tuoi preferiti</b>\n⭐ " + fav_rest[0][2])
    elif fav_rest:
        parts.append("<b>I tuoi preferiti</b>")
        fav_rest.sort(key=lambda b: (sec_info[b[0]][0], b[0], b[1]["price_pp"], b[1]["name"]))
        for key in sec_order({b[0] for b in fav_rest}):
            parts.append("\n".join(["🛫 <b>%s</b>" % C.esc(sec_info[key][1])] + ["⭐ " + b[2] for b in fav_rest if b[0] == key]))
    if new_routes:
        blk = ["🆕 <b>Primi voli su rotte finora vuote</b> (sopra soglia)"]
        blk += ["• %s: da <b>%s pp</b>, %s, da %s" % (C.offer_title(b, cfg), C.euro(b["price_pp"]), C.fmt_dates(b["dep"], b["ret"]), C.esc(C.origin_name(b, cfg))) for b, n in new_routes[:mx]]
        if len(new_routes) > mx:
            blk.append("e altre %d" % (len(new_routes) - mx))
        parts.append("\n".join(blk))
    if parts:
        # riga di riepilogo: e' quello che si vede nell'anteprima della notifica e nell'elenco delle chat
        shown = sorted([r[0] for rws in by_sec.values() for r in rws] + [b[1] for b in fav_rest] + [r[0] for r in new_routes], key=lambda o: o["price_pp"])
        n_new = n_rows + len(fav_rest) + len(new_routes)
        top = shown[0]
        head = "✈️ <b>%s</b> · da <b>%s pp</b> %s (%s)" % ("1 novità" if n_new == 1 else "%d novità" % n_new, C.euro(top["price_pp"]), C.esc(C.display_name(top)), C.esc(top.get("origin") or ""))
        if n_rows:
            head += "\nOfferte sotto %s a persona, per aeroporto di partenza" % C.euro(prefs["threshold"])
        link = C.dashboard_link(cfg)
        text = "\n\n".join([head] + parts + ([link] if link else []))
        # pulsanti "Apri": prima i preferiti, poi le mete del digest dalla piu' economica, max 6, un link per pagina
        listed = sorted((r[0] for rws in by_sec.values() for r in rws[:mx]), key=lambda o: o["price_pp"])
        seen_url, btns = set(), []
        for o in [b[1] for b in fav_rest] + listed + [r[0] for r in new_routes[:mx]]:
            u = C.page_url(cfg, o["target"], o.get("page_id"))
            if u and u not in seen_url and len(btns) < 6:
                seen_url.add(u)
                btns.append(C.url_button("Apri %s" % (o.get("name") or o["code"]), u))
        messages.append({"kind": "digest", "text": text, "buttons": C.button_rows(btns), "silent": bool(cfg["digest_silent"]) or quiet, "preview": None})
        if digest_due and (n_rows or new_routes):
            notified["digest_last"] = today

    # 5) storia dei prezzi (un valore al giorno per meta: il minimo visto) e nuovo stato
    for tid, offers in by.items():
        if offers[0]["source"] == "weekend" and tid not in favs:
            continue  # i weekend sono tanti e contano solo se preferiti
        h = history.setdefault(tid, [])
        if h and h[-1][0] == today:
            h[-1][1] = min(h[-1][1], offers[0]["price_pp"])
        else:
            h.append([today, offers[0]["price_pp"]])
        del h[:-HISTORY_DAYS]
    # le fonti non lette in questo giro conservano i dati precedenti (niente falsi "primi voli")
    targets = {tid: t for tid, t in ptar.items() if t.get("s") not in ok_sources}
    for tid, t in tinfo.items():
        offers = by.get(tid, [])
        targets[tid] = {"s": t["source"], "n": len(offers), "min": offers[0]["price_pp"] if offers else None,
                        "o": {okey(o): o["price_pp"] for o in offers}}
    new_prev = {"generated": snap.get("generated"), "targets": targets}
    stats = {"rows": n_rows, "merged": sum(len(v) for v in also.values()), "favorites": len(fav_events), "cards": n_cards, "new_routes": len(new_routes),
             "first_run": first_run, "excluded": n_clima, "muted": len(muted), "digest_due": digest_due, "quiet": quiet,
             "sections": {k: len(by_sec[k]) for k in sec_order(by_sec) if by_sec[k]}}
    return messages, new_prev, stats


def main():
    ap = argparse.ArgumentParser(description="Alert Telegram sulle offerte voli")
    ap.add_argument("--snapshot", default=str(C.BOT_DIR / "snapshot.json"))
    ap.add_argument("--dry-run", action="store_true", help="stampa i messaggi invece di inviarli")
    ap.add_argument("--save-state", action="store_true", help="in dry-run, scrive comunque lo stato")
    a = ap.parse_args()
    cfg, sd = C.load_config(), C.state_dir()
    token, chats = C.bot_token(), C.allowed_chats()
    if not a.dry_run and not (token and chats):
        print("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_IDS mancanti: alert saltati, stato invariato.")
        return 0
    snap = C.load_snapshot(a.snapshot)
    if not snap["offers"] and not any(s.get("ok") for s in snap["sources"].values()):
        print("Snapshot vuoto o illeggibile: alert saltati, stato invariato.")
        return 0
    prev = C.load_json(sd / "last_snapshot.json", {})
    notified = C.load_json(sd / "notified.json", {})
    # preferiti e soglie: dal Worker (li cambiano sito e bot in tempo reale); in dry-run solo dai file, senza rete
    prefs, src = (C.load_prefs(cfg), "prefs.json (dry-run)") if a.dry_run else C.load_prefs_live(cfg, notified)
    print("preferenze da: %s (%d preferiti)" % (src, len(prefs["favorites"])))
    history = C.load_json(sd / "history.json", {})
    messages, new_prev, stats = compute(snap, prev, prefs, notified, cfg, history=history)
    print("alert: %s" % stats)
    tg = C.Telegram(token, dry_run=a.dry_run)
    if messages:
        targets = [c for c in (chats or [0]) if C.chat_hash(c) not in prefs["paused"]]
        sent, n_msg = 0, 0
        for c in targets:
            ok = 0
            for m in messages:
                try:
                    tg.send(c, m["text"], m["buttons"], silent=m["silent"], preview=m["preview"])
                    ok += 1
                except C.TelegramError as e:
                    print("invio fallito per chat#%s: %s" % (C.chat_hash(c), e))
                if not a.dry_run:
                    time.sleep(1.1)  # Telegram: non piu' di un messaggio al secondo nella stessa chat
            sent += 1 if ok else 0
            n_msg += ok
        print("%d messaggi (%d card, %d digest) a %d chat su %d (%d in pausa)" % (n_msg, sum(m["kind"] == "card" for m in messages),
              sum(m["kind"] == "digest" for m in messages), sent, len(targets), len(chats or [0]) - len(targets)))
        if targets and not sent:
            print("Nessun invio riuscito: stato invariato, si riprova al prossimo giro.")
            return 1
    else:
        print("niente di nuovo da notificare")
    if not a.dry_run or a.save_state:
        C.save_json(sd / "last_snapshot.json", new_prev)
        C.save_json(sd / "notified.json", notified)
        C.save_json(sd / "history.json", history)
    return 0


if __name__ == "__main__":
    sys.exit(main())
