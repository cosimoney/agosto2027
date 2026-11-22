# -*- coding: utf-8 -*-
"""Comandi del bot via polling getUpdates. DAL VIVO NON SI USA PIU': i comandi li gestisce il Worker Cloudflare
(worker/src/bot.js, stessa logica e stessi testi) tramite webhook, e con il webhook attivo getUpdates non funziona.
Questo file resta come riferimento, per le prove in locale (--dry-run --simulate), per selftest.py e per --register.
Se cambi un testo o una regola qui, cambiala anche in worker/src/bot.js: worker/test/parity.test.mjs li confronta.

Uso:
  python bot/commands.py                     un passaggio: legge gli update in coda, risponde, salva lo stato
  python bot/commands.py --loop-seconds 600  resta in long-polling per N secondi (risposte quasi immediate)
  python bot/commands.py --dry-run --simulate "/top"     prova un comando in locale senza rete
  python bot/commands.py --register          registra il menu comandi su Telegram e stampa lo username del bot
  python bot/commands.py --whoami            SOLO in locale: elenca i chat_id che hanno scritto al bot (per il setup)

Comandi: /start, /preferiti, /aggiungi <meta>, /rimuovi <meta>, /soglia [meta] <euro|off>, /top [weekend], /meta <meta>,
/pausa, /riprendi, /help.   Deep link: https://t.me/<bot>?start=fav_<ID>  (ID: d_<IATA>, t_<slug>, w_<IATA>).

Sicurezza: risponde solo alle chat elencate nel secret TELEGRAM_CHAT_IDS; le altre vengono ignorate in silenzio.
Nei log non compaiono mai chat_id, nomi o testi dei messaggi (i log di Actions di un repo pubblico sono pubblici).
Stato scritto SOLO da questo script: state/prefs.json (soglia, preferiti, chat in pausa come hash) e state/offset.json.
I preferiti sono condivisi tra le chat autorizzate (e' un viaggio di coppia); la pausa e' per singola chat."""
import argparse, os, sys, time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C

HELP = """<b>Comandi</b>
/top - le 5 mete migliori sotto soglia (<code>/top weekend</code> per i weekend)
/meta &lt;meta&gt; - miglior prezzo e date, es. <code>/meta TBS</code> o <code>/meta Georgia</code>
/preferiti - i preferiti con il prezzo di oggi
/aggiungi &lt;meta&gt; - aggiunge un preferito
/rimuovi &lt;meta&gt; - lo toglie
/soglia &lt;euro&gt; - soglia generale a persona, es. <code>/soglia 900</code>
/soglia &lt;meta&gt; &lt;euro&gt; - soglia di un preferito, es. <code>/soglia TBS 300</code> (<code>off</code> per toglierla)
/silenzia &lt;meta&gt; [giorni] - niente avvisi su una meta per 7 giorni (<code>/silenzia TBS off</code> per riattivarla)
/digest - ogni quanto mandare il riepilogo: a ogni giro, giornaliero o settimanale
/pausa e /riprendi - sospende o riattiva gli avvisi in questa chat
/sito - il tuo link personale per usare i preferiti dal sito

Le mete si indicano con codice aeroporto, nome o ID (d_TBS destinazione, t_georgia-armenia giro, w_BCN weekend).
I prezzi sono sempre A/R <b>a persona</b>; tra parentesi o dopo il punto trovi la coppia."""

MENU = [("top", "Le 5 mete migliori sotto soglia"), ("meta", "Miglior prezzo e date di una meta"), ("preferiti", "I tuoi preferiti"),
        ("aggiungi", "Aggiungi un preferito"), ("rimuovi", "Rimuovi un preferito"), ("soglia", "Imposta la soglia in euro a persona"),
        ("silenzia", "Silenzia una meta per 7 giorni"), ("digest", "Frequenza del riepilogo"),
        ("pausa", "Sospendi gli avvisi"), ("riprendi", "Riattiva gli avvisi"), ("sito", "Link personale per i preferiti sul sito"),
        ("help", "Elenco comandi")]


def btn(text, data):
    return (text[:40], data) if len(data.encode()) <= 64 else None


rows = C.button_rows


class Bot:
    def __init__(self, tg, cfg, snap, prefs):
        self.tg, self.cfg, self.snap, self.prefs = tg, cfg, snap, prefs
        self.by = C.by_target(snap)

    # ----- utilita' -----
    def name(self, tid):
        return C.target_name(tid, self.snap)

    def title(self, tid):
        """Nome in grassetto con link alla pagina della meta."""
        return C.target_title(tid, self.snap, self.cfg)

    def open_btn(self, tid, text="🔗 Apri"):
        t = self.snap.get("targets", {}).get(tid) or {}
        return C.url_button(text, C.page_url(self.cfg, tid, t.get("page_id")))

    def label(self, tid):
        kind = {"d": "meta", "t": "giro", "w": "weekend"}[tid[0]]
        b = self.best(tid)
        return "%s · %s%s" % (self.name(tid)[:26], kind, " · %s" % C.euro(b["price_pp"]) if b else "")

    def best(self, tid):
        o = self.by.get(tid)
        return o[0] if o else None

    def price_line(self, tid):
        b = self.best(tid)
        return C.offer_block(b, self.cfg) if b else "%s: nessun volo pubblicato per ora" % self.title(tid)

    def pick(self, q, verb, action, pool=None):
        """Risolve il testo in una meta. -> (id, None) oppure (None, (testo, bottoni)) se serve chiedere."""
        if not q:
            return None, ("Dimmi quale meta, per esempio <code>/%s TBS</code>." % verb, None)
        c = C.resolve_target(q, self.snap)
        if pool is not None:
            c = [x for x in c if x in pool]
        if not c:
            return None, ("Non trovo nessuna meta per «%s». Prova con il codice aeroporto (es. TBS) o guarda /top." % C.esc(q), None)
        if len(c) == 1:
            return c[0], None
        c.sort(key=lambda t: ((self.best(t) or {}).get("price_pp", 10 ** 9), t))
        txt = "Ne ho trovate %d per «%s», quale intendi?" % (len(c), C.esc(q))
        if len(c) > 8:
            txt += " Ti mostro le prime 8 per prezzo."
        return None, (txt, rows([btn(self.label(t), "%s:%s" % (action, t)) for t in c[:8]], 1))

    # ----- azioni -----
    def add(self, tid):
        favs = self.prefs["favorites"]
        known = tid in self.snap.get("targets", {})
        if tid in favs:
            head = "⭐ %s è già tra i preferiti." % self.title(tid)
        else:
            favs[tid] = {"added": date.today().isoformat()}
            if self.best(tid):
                favs[tid]["p"] = self.best(tid)["price_pp"]  # riferimento per il primo "prezzo sceso" di alerts.py
            head = "⭐ Aggiunto ai preferiti: %s." % self.title(tid)
        b = self.best(tid)
        if b:
            how = "quando il miglior prezzo scende di almeno %s a persona rispetto a oggi, anche su date o aeroporti diversi" % C.euro(C.min_drop(b["price_pp"], self.cfg))
            body = self.price_line(tid) + "\nTi avviso %s, se escono nuove date o se scende sotto %s pp." % (how, C.euro(C.fav_threshold(tid, self.prefs, self.cfg)))
        elif known:
            body = "Per ora nessun volo pubblicato: ti scrivo appena compaiono."
        else:
            body = "Non ho ancora dati su questa meta (ID <code>%s</code>): ti scrivo appena compaiono voli." % C.esc(tid)
        sug = None
        if b and b["price_pp"] >= 60:
            v = int(b["price_pp"] * 0.9 // 10 * 10)
            sug = btn("🔔 Avvisami sotto %s" % C.euro(v), "thr:%s:%d" % (tid, v))
        return head + "\n" + body, rows([sug, btn("❌ Rimuovi", "rm:%s" % tid), self.open_btn(tid)])

    def remove(self, tid):
        if self.prefs["favorites"].pop(tid, None) is None:
            return "%s non è tra i preferiti." % self.title(tid), None
        return "Tolto dai preferiti: %s." % self.title(tid), rows([btn("↩️ Rimetti", "add:%s" % tid)])

    def set_thr(self, tid, val):
        favs = self.prefs["favorites"]
        added = tid not in favs
        f = favs.setdefault(tid, {"added": date.today().isoformat()})
        if added and self.best(tid):
            f["p"] = self.best(tid)["price_pp"]
        if val is None:
            f.pop("thr", None)
            return "Soglia personalizzata tolta per %s: vale quella generale (%s pp)." % (self.title(tid), C.euro(C.fav_threshold(tid, self.prefs, self.cfg))), None
        f["thr"] = val
        b = self.best(tid)
        now = " Oggi il migliore è %s pp." % C.euro(b["price_pp"]) if b else ""
        return "🎯 %s: ti avviso sotto <b>%s a persona</b> (coppia %s).%s%s" % (
            self.title(tid), C.euro(val), C.euro(val * 2), now, " L'ho anche aggiunta ai preferiti." if added else ""), None

    def mute(self, tid, days):
        m = self.prefs.setdefault("muted", {})
        if not days:
            m.pop(tid, None)
            return "🔔 Avvisi riattivati per %s." % self.title(tid), None
        until = date.today() + timedelta(days=days)
        m[tid] = until.isoformat()
        return ("🔕 %s silenziata per %d giorni (fino al %d %s). I prezzi continuo a seguirli: se nel frattempo cala, te lo dico alla riattivazione."
                % (self.title(tid), days, until.day, C.MESI[until.month - 1])), rows([btn("🔔 Riattiva", "unmute:%s" % tid)])

    DIGEST = {"giro": "a ogni giro di scansione", "giorno": "una volta al giorno", "settimana": "una volta a settimana"}

    def set_digest(self, mode):
        self.prefs["digest"] = mode
        return "🗞 Riepilogo: <b>%s</b>. Gli avvisi singoli sui preferiti restano immediati." % self.DIGEST[mode], None

    # ----- comandi -----
    def cmd_digest(self, arg, chat):
        a = C.norm(arg)
        mode = "giro" if a.startswith(("giro", "ogni", "sempre")) else "giorno" if a.startswith(("giorn", "daily", "quotid")) else "settimana" if a.startswith(("sett", "week")) else None
        if mode:
            return self.set_digest(mode)
        cur = self.prefs.get("digest") or self.cfg.get("digest_frequency") or "giro"
        return ("🗞 Il riepilogo delle offerte arriva <b>%s</b>, senza suono. Ogni quanto lo vuoi?" % self.DIGEST.get(cur, cur),
                rows([btn("A ogni giro", "dg:giro"), btn("Giornaliero", "dg:giorno"), btn("Settimanale", "dg:settimana")], 3))

    def cmd_silenzia(self, arg, chat):
        parts = arg.split()
        days = self.cfg["mute_days"]
        if parts and (parts[-1].isdigit() or parts[-1].lower() in ("off", "no", "via")):
            days = int(parts[-1]) if parts[-1].isdigit() else 0
            parts = parts[:-1]
        if not parts:
            m = {t: u for t, u in (self.prefs.get("muted") or {}).items() if u >= date.today().isoformat()}
            if not m:
                return "Nessuna meta silenziata. Esempio: <code>/silenzia TBS</code> (7 giorni) o <code>/silenzia TBS 14</code>.", None
            return "🔕 Silenziate: " + ", ".join("%s (fino al %s)" % (self.title(t), u) for t, u in sorted(m.items())), rows([btn("🔔 %s" % self.name(t), "unmute:%s" % t) for t in sorted(m)])
        if not 0 <= days <= 365:
            return "I giorni devono stare tra 1 e 365.", None
        tid, ask = self.pick(" ".join(parts), "silenzia", "mute0")
        if ask:
            if ask[1]:
                ask = (ask[0], [[(t, d.replace("mute0:", "mute:") + ":%d" % days)] for r in ask[1] for t, d in r if len(d) < 56])
            return ask
        return self.mute(tid, days)

    def cmd_start(self, arg, chat):
        if arg.startswith("fav_"):
            tid = C.resolve_target(arg[4:], self.snap)
            if len(tid) == 1 and C.ID_RE.match(tid[0]):
                return self.add(tid[0])
            return "Il link non è valido (meta «%s»)." % C.esc(arg[4:]), None
        scope = "le Nuove mete" + (" e i Popular trips" if self.cfg.get("digest_include_popular", True) else "") if self.cfg.get("digest_tabs") == ["new"] else "le mete"
        return ("Ciao! Tengo d'occhio i voli di agosto 2027 e i weekend da Milano.\n"
                "Nel riepilogo e in /top entrano %s; le mete già visitate le seguo solo se le metti tra i preferiti.\n" % scope +
                "Ti scrivo quando una meta scende sotto <b>%s a persona</b> A/R, quando un preferito cala di almeno %s o escono nuove date, "
                "e quando compaiono voli su rotte ancora vuote.\n\n%s" % (C.euro(self.prefs["threshold"]), C.drop_rules_txt(self.cfg), HELP),
                rows([btn("🏆 Top 5", "top"), btn("⭐ Preferiti", "favs")]))

    def cmd_help(self, arg, chat):
        link = C.dashboard_link(self.cfg)
        return HELP + ("\n\n" + link if link else ""), None

    def cmd_preferiti(self, arg, chat):
        favs = self.prefs["favorites"]
        if not favs:
            return "Nessun preferito. Aggiungine uno con <code>/aggiungi TBS</code> o dalla stella sulla dashboard.", rows([btn("🏆 Top 5", "top")])
        ids = sorted(favs, key=lambda t: ((self.best(t) or {}).get("price_pp", 10 ** 9), t))
        out = ["<b>I tuoi preferiti</b> (%d)" % len(ids)]
        for t in ids:
            thr = favs[t].get("thr")
            out.append("⭐ " + self.price_line(t) + ("\n   🎯 soglia %s pp" % C.euro(thr) if thr else ""))
        return "\n\n".join(out), rows([x for t in ids for x in (btn("❌ %s" % self.name(t), "rm:%s" % t), self.open_btn(t, "🔗 Apri %s" % self.name(t)))])

    def cmd_aggiungi(self, arg, chat):
        tid, ask = self.pick(arg, "aggiungi", "add")
        return ask or self.add(tid)

    def cmd_rimuovi(self, arg, chat):
        favs = self.prefs["favorites"]
        if not arg:
            if not favs:
                return "Nessun preferito da togliere.", None
            return "Quale tolgo?", rows([btn("❌ %s" % self.name(t), "rm:%s" % t) for t in sorted(favs)])
        tid, ask = self.pick(arg, "rimuovi", "rm", pool=favs)
        if ask and "Non trovo" in ask[0]:
            return "«%s» non è tra i preferiti. Vedi /preferiti." % C.esc(arg), None
        return ask or self.remove(tid)

    def cmd_soglia(self, arg, chat):
        parts = arg.split()
        if not parts:
            favs = {t: f["thr"] for t, f in self.prefs["favorites"].items() if f.get("thr")}
            out = ["Soglia generale: <b>%s a persona</b> (coppia %s)." % (C.euro(self.prefs["threshold"]), C.euro(self.prefs["threshold"] * 2)),
                   "Weekend: %s a persona." % C.euro(self.cfg["weekend_threshold_pp"])]
            out += ["🎯 %s: %s pp" % (self.title(t), C.euro(v)) for t, v in sorted(favs.items())]
            out.append("Per cambiarla: <code>/soglia 900</code> oppure <code>/soglia TBS 300</code>.")
            return "\n".join(out), None
        last = parts[-1].lower().replace("€", "").replace(".", "")
        off = last in ("off", "no", "via", "0")
        if not off and not last.isdigit():
            return "Mi serve un importo in euro, per esempio <code>/soglia 900</code> o <code>/soglia TBS 300</code>.", None
        val = None if off else int(last)
        if val is not None and not 10 <= val <= 20000:
            return "La soglia deve stare tra 10 e 20.000 €.", None
        q = " ".join(parts[:-1])
        if not q:
            if val is None:
                return "La soglia generale non si può togliere. Per non ricevere avvisi usa /pausa.", None
            self.prefs["threshold"] = val
            n = sum(1 for t, o in self.by.items() if o[0]["source"] != "weekend" and o[0]["price_pp"] <= val)
            return "Soglia generale: <b>%s a persona</b> (coppia %s). Oggi ci stanno sotto %d mete: /top." % (C.euro(val), C.euro(val * 2), n), None
        tid, ask = self.pick(q, "soglia", "thr0")
        if ask:
            if ask[1]:  # scelta multipla: i bottoni portano gia' l'importo
                ask = (ask[0], [[(t, d.replace("thr0:", "thr:") + ":%s" % (val if val is not None else "off"))] for r in ask[1] for t, d in r if len(d) < 56])
            return ask
        return self.set_thr(tid, val)

    def cmd_top(self, arg, chat):
        wk = C.norm(arg).startswith("week")
        thr = self.cfg["weekend_threshold_pp"] if wk else self.prefs["threshold"]
        tg = self.snap.get("targets", {})  # stesso perimetro del digest: Nuove mete + Popular trips, il resto solo se preferito
        best = sorted((o[0] for t, o in self.by.items() if (o[0]["source"] == "weekend") == wk and o[0]["price_pp"] <= thr
                       and (t in self.prefs["favorites"] or C.in_digest(t, tg.get(t), self.cfg))), key=lambda o: o["price_pp"])
        if not best:
            return "Nessuna meta sotto %s a persona al momento." % C.euro(thr), None
        out = ["🏆 <b>Le migliori sotto %s a persona</b>%s" % (C.euro(thr), " (weekend)" if wk else "")]
        out += ["%d. %s" % (i + 1, C.offer_block(o, self.cfg)) for i, o in enumerate(best[:5])]
        if len(best) > 5:
            out.append("In tutto %d mete sotto soglia. %s" % (len(best), C.dashboard_link(self.cfg, "weekend" if wk else None)))
        favs = self.prefs["favorites"]
        return "\n\n".join(out), rows([btn("⭐ %s" % o["name"], "add:%s" % o["target"]) for o in best[:5] if o["target"] not in favs])

    def meta(self, tid):
        t = self.snap.get("targets", {}).get(tid) or {}
        offers = self.by.get(tid) or []
        fav = tid in self.prefs["favorites"]
        toggle = btn("❌ Togli dai preferiti", "rm:%s" % tid) if fav else btn("⭐ Aggiungi ai preferiti", "add:%s" % tid)
        if not offers:
            cov = " (%d ricerche fatte, %d con voli ma fuori dalle regole sugli scali)" % (t["q"], t["ok"]) if t.get("q") else ""
            return "%s: nessun volo valido pubblicato per ora%s." % (self.title(tid), cov), rows([toggle, self.open_btn(tid)])
        best = offers[0]
        out = [("⭐ " if fav else "") + C.offer_block(best, self.cfg)]
        seen, alt = {(best["dep"], best["ret"])}, []
        for o in offers[1:]:
            if (o["dep"], o["ret"]) not in seen:
                seen.add((o["dep"], o["ret"]))
                alt.append("• %s · %s notti · da %s: <b>%s pp</b>" % (C.fmt_dates(o["dep"], o["ret"]), o["nights"], C.esc(C.origin_name(o, self.cfg)), C.euro(o["price_pp"])))
            if len(alt) == 3:
                break
        if alt:
            out.append("Altre date:\n" + "\n".join(alt))
        thr = C.fav_threshold(tid, self.prefs, self.cfg)
        out.append("%d combinazioni, %d sotto %s pp." % (len(offers), sum(1 for o in offers if o["price_pp"] <= thr), C.euro(thr)))
        return "\n\n".join(out), rows([toggle, self.open_btn(tid)])

    def cmd_meta(self, arg, chat):
        tid, ask = self.pick(arg, "meta", "meta")
        return ask or self.meta(tid)

    def cmd_pausa(self, arg, chat):
        h = C.chat_hash(chat)
        if h not in self.prefs["paused"]:
            self.prefs["paused"].append(h)
        return "⏸ Avvisi in pausa per questa chat. I comandi restano attivi; per ripartire /riprendi.", rows([btn("▶️ Riprendi", "resume")])

    def cmd_sito(self, arg, chat):
        # dal vivo risponde il Worker (worker/src/index.js) con il link firmato; qui si arriva solo in polling o in simulazione
        return "I preferiti dal sito non sono ancora attivi su questo bot. Per ora usa /aggiungi oppure la stella sul sito, che apre questa chat.", None

    def cmd_riprendi(self, arg, chat):
        h = C.chat_hash(chat)
        self.prefs["paused"] = [x for x in self.prefs["paused"] if x != h]
        return "▶️ Avvisi riattivati per questa chat.", None

    ALIASES = {"favoriti": "preferiti", "fav": "preferiti", "add": "aggiungi", "remove": "rimuovi", "togli": "rimuovi", "aiuto": "help",
               "resume": "riprendi", "pause": "pausa", "dest": "meta", "mute": "silenzia", "muta": "silenzia", "riepilogo": "digest"}

    def on_text(self, text, chat):
        text = (text or "").strip()
        if not text.startswith("/"):
            return None
        head, _, arg = text.partition(" ")
        cmd = head[1:].split("@")[0].lower()
        fn = getattr(self, "cmd_" + self.ALIASES.get(cmd, cmd), None)
        if not cmd.isalnum() or fn is None:
            return "Comando non riconosciuto. Vedi /help.", None
        return fn(arg.strip(), chat)

    def on_callback(self, data, chat):
        act, _, rest = (data or "").partition(":")
        if act == "top":
            return self.cmd_top("", chat)
        if act == "favs":
            return self.cmd_preferiti("", chat)
        if act == "resume":
            return self.cmd_riprendi("", chat)
        if act == "dg" and rest in self.DIGEST:
            return self.set_digest(rest)
        if act == "unmute" and C.ID_RE.match(rest):
            return self.mute(rest, 0)
        if act == "mute":
            tid, _, v = rest.rpartition(":")
            if C.ID_RE.match(tid) and v.isdigit() and 0 <= int(v) <= 365:
                return self.mute(tid, int(v))
        if act == "thr":
            tid, _, v = rest.rpartition(":")
            if C.ID_RE.match(tid) and (v == "off" or v.isdigit()):
                return self.set_thr(tid, None if v == "off" else int(v))
        elif C.ID_RE.match(rest):
            if act == "add":
                return self.add(rest)
            if act == "rm":
                return self.remove(rest)
            if act == "meta":
                return self.meta(rest)
        return "Pulsante non più valido.", None

    def handle(self, u, allowed):
        """Elabora un update. -> 'ok' | 'ignored' (chat non autorizzata) | 'skip' (niente da fare)."""
        cb, msg = u.get("callback_query"), u.get("message")
        chat = ((cb or {}).get("message") or msg or {}).get("chat", {}).get("id")
        if chat is None:
            return "skip"
        if chat not in allowed:
            if not allowed and msg and str(msg.get("text") or "").startswith(("/start", "/id")):
                # modalita' setup (TELEGRAM_CHAT_IDS vuoto): il bot dice solo a chi scrive il proprio chat_id
                self.tg.send(chat, "Bot privato, non ancora configurato.\nIl chat_id di questa chat è <code>%s</code>: va messo nel secret TELEGRAM_CHAT_IDS." % chat)
                return "ok"
            return "ignored"
        if cb:
            try:
                self.tg.call("answerCallbackQuery", callback_query_id=cb.get("id"))
            except C.TelegramError:
                pass  # pulsante premuto troppo tempo fa: la risposta arriva comunque come messaggio
            res = self.on_callback(cb.get("data"), chat)
        else:
            res = self.on_text(msg.get("text"), chat)
        if not res:
            return "skip"
        self.tg.send(chat, res[0], res[1])
        return "ok"


def process(bot, updates, allowed, offset):
    stats = {"ok": 0, "ignored": 0, "skip": 0, "error": 0}
    for u in updates:
        try:
            stats[bot.handle(u, allowed)] += 1
        except Exception as e:  # un update rotto non deve bloccare la coda
            stats["error"] += 1
            print("errore su un update: %s" % type(e).__name__)
        if isinstance(u.get("update_id"), int):
            offset = max(offset, u["update_id"] + 1)
    return offset, stats


def main():
    ap = argparse.ArgumentParser(description="Comandi del bot Telegram (polling)")
    ap.add_argument("--snapshot", default=str(C.BOT_DIR / "snapshot.json"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--simulate", action="append", help="testo di un comando da provare in locale (ripetibile)")
    ap.add_argument("--loop-seconds", type=int, default=0)
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--whoami", action="store_true")
    a = ap.parse_args()
    cfg, sd, token = C.load_config(), C.state_dir(), C.bot_token()
    if not token and not a.dry_run:
        print("TELEGRAM_BOT_TOKEN mancante: niente da fare.")
        return 0
    tg = C.Telegram(token, dry_run=a.dry_run)
    if a.register:
        me = tg.call("getMe")
        tg.call("setMyCommands", commands=[{"command": c, "description": d} for c, d in MENU])
        print("menu comandi registrato per @%s" % (me.get("username") if isinstance(me, dict) else "bot"))
        return 0
    if a.whoami:
        if os.environ.get("GITHUB_ACTIONS"):
            print("--whoami funziona solo in locale: i log di Actions sono pubblici.")
            return 1
        seen = {}
        for u in tg.call("getUpdates", timeout=0) or []:
            ch = ((u.get("message") or (u.get("callback_query") or {}).get("message") or {}).get("chat")) or {}
            if "id" in ch:
                seen[ch["id"]] = "%s %s" % (ch.get("type"), ch.get("title") or ch.get("first_name") or "")
        for cid, label in seen.items():
            print("chat_id %s  (%s)" % (cid, label.strip()))
        print("%d chat trovate. Se sono zero: scrivi /start al bot e riprova." % len(seen))
        return 0
    allowed = C.allowed_chats()
    prefs = C.load_prefs(cfg)
    bot = Bot(tg, cfg, C.load_snapshot(a.snapshot), prefs)
    off_path = sd / "offset.json"
    offset = int(C.load_json(off_path, {}).get("offset") or 0)
    if a.simulate:
        chat = allowed[0] if allowed else 1
        ups = [{"update_id": offset + i, "message": {"chat": {"id": chat}, "text": t}} for i, t in enumerate(a.simulate)]
        _, stats = process(bot, ups, allowed or [chat], offset)
        print("simulazione: %s (stato non scritto)" % stats)
        return 0
    try:  # con il webhook attivo (Worker Cloudflare) getUpdates non riceve nulla: si esce subito. Mai stampare l'URL: contiene un segreto
        if (tg.call("getWebhookInfo") or {}).get("url"):
            print("webhook attivo: i comandi li gestisce il Worker, niente polling.")
            return 0
    except (C.TelegramError, AttributeError):
        pass
    deadline = time.time() + max(0, a.loop_seconds)
    total = {"ok": 0, "ignored": 0, "skip": 0, "error": 0}
    while True:
        left = deadline - time.time()
        poll = int(max(0, min(50, left)))
        try:
            ups = tg.call("getUpdates", _timeout=poll + 20, offset=offset or None, timeout=poll, allowed_updates=["message", "callback_query"])
        except C.TelegramError as e:
            print("getUpdates fallita: %s" % e)
            ups = []
            if left > 5:
                time.sleep(5)
        if ups:
            offset, stats = process(bot, ups, allowed, offset)
            for k, v in stats.items():
                total[k] += v
            C.save_json(sd / "prefs.json", prefs)  # salvataggio a ogni blocco: un crash non perde le modifiche
            C.save_json(off_path, {"offset": offset})
        if time.time() >= deadline:
            break
    if total["ok"] or total["ignored"] or total["skip"] or total["error"]:
        try:  # conferma a Telegram gli update gia' letti: anche se il commit dello stato fallisce non vengono riproposti
            tg.call("getUpdates", offset=offset, limit=1, timeout=0, allowed_updates=["message", "callback_query"])
        except C.TelegramError:
            pass
    print("update elaborati: %s" % total)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except C.TelegramError as e:
        print("Errore Telegram: %s" % e)
        sys.exit(1)
