# -*- coding: utf-8 -*-
"""Funzioni condivise dal bot: configurazione, stato su file, client Telegram, formattazione.
Solo libreria standard. Nessun chat_id viene mai scritto su file o stampato: nei log e nello stato
compare solo un hash HMAC (chiave = token del bot), non reversibile senza il token."""
import copy, hashlib, hmac, html, json, os, re, sys, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent
ROOT = BOT_DIR.parent
GIORNI = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]
MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
ID_RE = re.compile(r"^[dtw]_[A-Za-z0-9-]{2,58}$")
# Nomi leggibili degli aeroporti di partenza. Un'origine non in elenco viene mostrata con il suo codice:
# nuove origini non richiedono modifiche al codice (si possono aggiungere nomi in config.json, "origin_names").
# Sezioni del digest, nell'ordine in cui compaiono: una per aeroporto (o gruppo di aeroporti) di partenza.
# Sostituibili da config.json con "origin_sections": [{"title": "...", "codes": ["..."]}]. Un'origine fuori elenco
# finisce in una sezione "Da <nome>" in coda.
ORIGIN_SECTIONS = [("Milano Linate (LIN)", ["LIN"]), ("Milano Malpensa (MXP)", ["MXP"]), ("Bergamo (BGY)", ["BGY"]),
                   ("Roma (FCO/CIA)", ["FCO", "CIA"]), ("Pisa (PSA)", ["PSA"])]
FAV_DROP_RULES = [{"above": 1000, "min_drop_eur": 100}, {"above": 0, "min_drop_eur": 50}]
ORIGIN_NAMES = {"LIN": "Milano LIN", "MXP": "Milano MXP", "BGY": "Bergamo BGY", "FCO": "Roma FCO", "CIA": "Roma CIA", "PSA": "Pisa"}

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def state_dir():
    p = Path(os.environ.get("BOT_STATE_DIR") or BOT_DIR / "state")
    p.mkdir(parents=True, exist_ok=True)
    return p


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    """Scrive solo se il contenuto cambia (niente commit a vuoto). Chiavi ordinate: diff leggibili."""
    txt = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    path = Path(path)
    try:
        if path.read_text(encoding="utf-8") == txt:
            return False
    except OSError:
        pass
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(txt, encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return True


def load_config():
    cfg = load_json(BOT_DIR / "config.json", {})
    for env, key in (("DASHBOARD_URL", "dashboard_url"), ("WEEKEND_DASHBOARD_URL", "weekend_dashboard_url"),
                     ("WEEKEND_SOURCE", "weekend_source"), ("TELEGRAM_BOT_USERNAME", "bot_username")):
        if os.environ.get(env):
            cfg[key] = os.environ[env]
    for k, v in (("threshold_pp", 1000), ("weekend_threshold_pp", 100), ("weekend_global_alerts", False),
                 ("two_stops_min_pct", 0.25), ("two_stops_min_eur", 150), ("section_max_rows", 6), ("fav_drop_rules", FAV_DROP_RULES),
                 ("digest_exclude_clima", ["sconsigliato"]), ("digest_tabs", ["new"]), ("digest_include_popular", True), ("max_cards_per_run", 3), ("max_alerts_per_day", 6),
                 ("card_discount_pct", 0.30), ("typical_min_samples", 5), ("mute_days", 7), ("digest_silent", True),
                 ("digest_frequency", "giro"), ("card_cover", True), ("section_expand_after", 3),
                 ("quiet_hours", {"start": "23:00", "end": "08:00", "tz": "Europe/Rome"})):
        cfg.setdefault(k, v)
    return cfg


def load_prefs(cfg):
    p = load_json(state_dir() / "prefs.json", {})
    p.setdefault("threshold", cfg["threshold_pp"])
    p.setdefault("favorites", {})
    p.setdefault("paused", [])
    p.setdefault("muted", {})  # {id meta: "YYYY-MM-DD" fino a quando non mandare avvisi}
    return p


def worker_url(cfg=None):
    """Base del Worker Cloudflare che tiene preferiti e soglie (variabile WORKER_URL o "worker_url" in config.json). '' se manca."""
    u = str(os.environ.get("WORKER_URL") or (cfg or {}).get("worker_url") or "").strip().rstrip("/")
    return u if re.match(r"^https://", u) else ""


def prefs_key():
    """Chiave per GET /api/prefs: il secret PREFS_SECRET se c'e', altrimenti una chiave derivata dal token del bot
    (HMAC-SHA256, il Worker la calcola allo stesso modo), cosi' funziona anche dove il secret non e' passato al passo."""
    k = (os.environ.get("PREFS_SECRET") or "").strip()
    if k or not bot_token():
        return k
    return hmac.new(bot_token().encode(), b"agosto2027-prefs-v1", hashlib.sha256).hexdigest()


def fetch_remote_prefs(cfg, tries=3, timeout=20):
    """Preferenze dal Worker, o None se non configurato / non raggiungibile / risposta non valida. Nei log solo il tipo di errore."""
    import time
    url, key = worker_url(cfg), prefs_key()
    if not (url and key):
        return None
    for i in range(tries):
        try:
            req = urllib.request.Request(url + "/api/prefs", headers={"Authorization": "Bearer " + key, "User-Agent": "agosto2027-alerts/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                p = json.loads(r.read().decode("utf-8"))
            if isinstance(p, dict) and isinstance(p.get("favorites"), dict):
                return p
            print("preferenze dal Worker: risposta non valida")
            return None
        except urllib.error.HTTPError as e:
            print("preferenze dal Worker: HTTP %s" % e.code)
            if e.code in (401, 403, 404):
                return None
        except Exception as e:
            print("preferenze dal Worker: %s" % type(e).__name__)
        if i < tries - 1:
            time.sleep(3 * (i + 1))
    return None


def load_prefs_live(cfg, notified=None):
    """Preferenze per gli avvisi. -> (prefs, origine). Ordine: Worker (fonte di verita'), poi l'ultima copia arrivata dal
    Worker (notified["prefs_cache"], salvata a ogni giro riuscito), poi state/prefs.json."""
    p, src = fetch_remote_prefs(cfg), "worker"
    if p is None and isinstance((notified or {}).get("prefs_cache"), dict):
        p, src = copy.deepcopy(notified["prefs_cache"]), "copia dell'ultimo giro"
    if p is None:
        return load_prefs(cfg), "prefs.json"
    p.setdefault("threshold", cfg["threshold_pp"])
    for k, v in (("favorites", {}), ("paused", []), ("muted", {})):
        if not isinstance(p.get(k), type(v)):
            p[k] = v
    if src == "worker" and notified is not None:
        notified["prefs_cache"] = copy.deepcopy(p)
    return p, src


def local_time(cfg=None, utc=None):
    """Ora locale per ore di silenzio e conteggi giornalieri. Usa zoneinfo se il fuso e' disponibile, altrimenti la
    regola dell'ora legale europea (ultima domenica di marzo - ultima di ottobre, cambio alle 01:00 UTC): cosi'
    funziona anche su Windows senza il pacchetto tzdata."""
    utc = utc or datetime.now(timezone.utc)
    if utc.tzinfo is None:
        utc = utc.replace(tzinfo=timezone.utc)
    tz = ((cfg or {}).get("quiet_hours") or {}).get("tz") or "Europe/Rome"
    try:
        from zoneinfo import ZoneInfo
        return utc.astimezone(ZoneInfo(tz))
    except Exception:
        pass

    def last_sunday(month):
        d = datetime(utc.year, month, 31, 1, tzinfo=timezone.utc)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    dst = last_sunday(3) <= utc < last_sunday(10)
    return utc.astimezone(timezone(timedelta(hours=2 if dst else 1)))


def in_quiet_hours(cfg, local):
    q = (cfg or {}).get("quiet_hours") or {}
    s, e = str(q.get("start") or ""), str(q.get("end") or "")
    if not (re.fullmatch(r"\d\d:\d\d", s) and re.fullmatch(r"\d\d:\d\d", e)) or s == e:
        return False
    t = local.strftime("%H:%M")
    return (t >= s or t < e) if s > e else s <= t < e


def default_threshold(source, prefs, cfg):
    return cfg["weekend_threshold_pp"] if source == "weekend" else prefs["threshold"]


def source_of(tid):
    return {"d": "agosto2027", "t": "popular", "w": "weekend"}.get(tid[:1], "agosto2027")


def drop_rules(cfg):
    out = []
    for r in (cfg or {}).get("fav_drop_rules") or FAV_DROP_RULES:
        try:
            out.append((float(r.get("above") or 0), float(r["min_drop_eur"])))
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
    return sorted(out or [(1000.0, 100.0), (0.0, 50.0)], reverse=True)


def min_drop(ref, cfg):
    """Calo minimo (euro pp) perche' un ribasso venga notificato, in base al prezzo di riferimento:
    vale la prima regola con ref > above (regole ordinate dalla fascia piu' alta)."""
    rules = drop_rules(cfg)
    for above, eur in rules:
        if ref > above:
            return eur
    return rules[-1][1]


def is_drop(ref, new, cfg):
    """True se new e' abbastanza sotto il riferimento. Chi chiama aggiorna il riferimento SOLO quando e' True:
    cosi' piu' cali piccoli di fila si sommano fino a superare la soglia."""
    return ref is not None and ref - new >= min_drop(ref, cfg) and new < ref


def drop_rules_txt(cfg):
    rules = drop_rules(cfg)
    bits = []
    for i, (above, eur) in enumerate(rules):
        if above > 0:
            bits.append("%s sopra %s pp" % (euro(eur), euro(above)))
        else:
            bits.append("%s%s" % (euro(eur), " fino a %s" % euro(rules[i - 1][0]) if i else ""))
    return ", ".join(bits)


def sections(cfg):
    """-> [(chiave, titolo, [codici])] nell'ordine del digest."""
    raw = (cfg or {}).get("origin_sections")
    lst = [(x.get("title"), x.get("codes") or []) for x in raw if isinstance(x, dict)] if raw else ORIGIN_SECTIONS
    return [("-".join(c), t or "/".join(c), list(c)) for t, c in lst if c]


def section_of(origin, cfg):
    """-> (posizione, chiave, titolo, piu' di un aeroporto nella sezione)."""
    secs = sections(cfg)
    for i, (key, title, codes) in enumerate(secs):
        if origin in codes:
            return i, key, title, len(codes) > 1
    nm = origin_name(origin, cfg)
    return len(secs), str(origin or "?"), "Da %s" % (nm if origin in nm else "%s (%s)" % (nm, origin)) if origin else "Altri aeroporti", False


def in_digest(tid, target, cfg):
    """True se la meta puo' entrare nel digest generale, in /top, nelle "rotte prima vuote" e nelle card "sotto il
    tipico". Chi resta fuori compare solo se e' tra i preferiti (lo decide chi chiama).
      destinazioni: solo le tab di dests.py elencate in digest_tabs (default "new" = Nuove mete; "vis" = Gia' visitati
                    resta fuori) e senza clima in digest_exclude_clima; lista vuota = tutte le tab;
      popular trips: secondo digest_include_popular;  weekend: sempre (li regola weekend_global_alerts)."""
    target = target or {}
    src = source_of(tid)
    if src == "weekend":
        return True
    if src == "popular":
        return bool(cfg.get("digest_include_popular", True))
    if target.get("clima") in (cfg.get("digest_exclude_clima") or []):
        return False
    tabs = cfg.get("digest_tabs") or []
    return not tabs or not target.get("tab") or target["tab"] in tabs


def fav_threshold(tid, prefs, cfg):
    t = (prefs["favorites"].get(tid) or {}).get("thr")
    return t if t else default_threshold(source_of(tid), prefs, cfg)


# ---------- testo ----------
def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def slug(s, n=40):
    """Slug degli ID t_<slug>: minuscole ASCII senza accenti, tutto il resto diventa '-', max 40 caratteri."""
    return norm(s).replace(" ", "-")[:n].strip("-")


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def euro(n):
    return "{:,}".format(int(round(n))).replace(",", ".") + " €"


def fmt_dates(dep, ret):
    """Date brevi con il giorno della settimana: "ven 13 → mar 24 ago" (l'anno solo se andata e ritorno differiscono)."""
    try:
        a, b = date.fromisoformat(dep), date.fromisoformat(ret)
    except (TypeError, ValueError):
        return "%s / %s" % (dep, ret)
    da, db = "%s %d" % (GIORNI[a.weekday()], a.day), "%s %d" % (GIORNI[b.weekday()], b.day)
    if a.month == b.month and a.year == b.year:
        return "%s → %s %s" % (da, db, MESI[a.month - 1])
    if a.year == b.year:
        return "%s %s → %s %s" % (da, MESI[a.month - 1], db, MESI[b.month - 1])
    return "%s %s %d → %s %s %d" % (da, MESI[a.month - 1], a.year, db, MESI[b.month - 1], b.year)


def gf_url(o, d, dep, ret):
    q = "Flights from %s to %s on %s through %s" % (o, d, dep, ret)
    return "https://www.google.com/travel/flights?q=%s&curr=EUR&hl=it" % urllib.parse.quote(q)


def stops_txt(o):
    s = o.get("stops")
    if s is None:
        return ""
    t = "diretto" if s == 0 else ("1 scalo" if s == 1 else "%s scali" % s)
    if s == 2 and o.get("price_1stop"):
        t += " (con 1 scalo %s)" % euro(o["price_1stop"])
    return t


def base_url(cfg, source=None):
    """Base della dashboard (agosto 2027 e popular trips) o della pagina weekend. '' se non configurata."""
    u = str((cfg or {}).get("weekend_dashboard_url" if source == "weekend" else "dashboard_url") or "").split("#")[0].strip()
    return u if re.match(r"^https?://", u) and "REPO-DA-DEFINIRE" not in u else ""


def page_url(cfg, tid, page_id=None):
    """Pagina della singola meta sul sito: <dashboard_url>#/d/<IATA> per le destinazioni, <dashboard_url>#/t/<id del trip>
    per i popular trips, la pagina di flightsMI per i weekend. page_id serve solo se l'id del trip differisce dallo slug."""
    src = source_of(tid)
    b = base_url(cfg, src)
    if not b or src == "weekend":
        return b
    return "%s#/%s/%s" % (b, tid[0], urllib.parse.quote(str(page_id or tid[2:]), safe="-_.~"))


def image_url(cfg, rel):
    """URL pubblico di un'immagine del sito (es. img/tbilisi.webp), o None se manca la base o il file."""
    b = base_url(cfg)
    return b + str(rel).lstrip("/") if b and rel else None


def linked(label_html, url):
    return '<a href="%s">%s</a>' % (esc(url), label_html) if url else label_html


def target_title(tid, snap, cfg=None):
    """Nome della meta in grassetto, con link alla sua pagina."""
    t = snap.get("targets", {}).get(tid) or {}
    return linked("<b>%s</b>" % esc(t.get("name") or tid), page_url(cfg, tid, t.get("page_id")) if cfg else "")


def origin_name(o, cfg=None):
    code = o.get("origin") if isinstance(o, dict) else o
    if isinstance(o, dict) and o.get("origin_name"):
        return o["origin_name"]
    return ((cfg or {}).get("origin_names") or {}).get(code) or ORIGIN_NAMES.get(code) or code or ""


def display_name(o):
    """Nome mostrato accanto al paese: una parentesi finale diventa una virgola, per non averne due di fila
    ("Agadir (costa atlantica)" + "(Marocco)" -> "Agadir, costa atlantica (Marocco)")."""
    nm = str(o.get("name") or o.get("code") or "")
    if o.get("country") and o.get("source") != "weekend":
        nm = re.sub(r"\s*\(([^()]+)\)\s*$", r", \1", nm)
    return nm


def est_txt(o, short=False):
    """Dichiarazione obbligatoria per le offerte stimate (o["est"]): il prezzo e' la somma di due solo andata, non un A/R."""
    if not o.get("est"):
        return ""
    if short or o.get("price_out") is None or o.get("price_ret") is None:
        return "stima: somma di due solo andata"
    return "stima: somma di due solo andata (andata %s + ritorno %s)" % (euro(o["price_out"]), euro(o["price_ret"]))


def offer_title(o, cfg=None):
    c = " (%s)" % esc(o["country"]) if o.get("country") and o.get("source") != "weekend" else ""
    nm = "<b>%s</b>" % esc(display_name(o))
    return linked(nm, page_url(cfg, o["target"], o.get("page_id")) if cfg else "") + c


def offer_block(o, cfg=None, title=True):
    """Due righe: nome (link alla pagina della meta) e prezzo per persona in evidenza, coppia secondaria; poi date,
    partenza, scali e Google Flights come link secondario."""
    l1 = "%s<b>%s pp</b> · coppia %s" % (offer_title(o, cfg) + ": " if title else "", euro(o["price_pp"]), euro(o["price_pp"] * 2))
    bits = [fmt_dates(o["dep"], o["ret"]), "%s notti" % o["nights"] if o.get("nights") is not None else "",
            "da %s" % esc(origin_name(o, cfg)) if o.get("origin") else "", stops_txt(o), esc(" + ".join(o.get("airlines") or []))]
    if o.get("ret_from"):
        bits.insert(3, "rientro da %s" % esc(o["ret_from"]))
    if o.get("extra_est"):
        bits.append("incl. %s di tratte stimate" % euro(o["extra_est"]))
    if o.get("est"):
        bits.append(est_txt(o))
    if o.get("url") and o.get("url_ret"):
        bits.append('Google Flights: <a href="%s">andata</a>, <a href="%s">ritorno</a>' % (esc(o["url"]), esc(o["url_ret"])))
    elif o.get("url"):
        bits.append('<a href="%s">Google Flights</a>' % esc(o["url"]))
    return l1 + "\n   " + " · ".join(b for b in bits if b)


def offer_line(o, cfg=None, show_origin=False):
    """Riga compatta per il digest per aeroporto: nome linkato, prezzo pp, coppia, date, scali. L'aeroporto sta nel
    titolo della sezione; show_origin lo ripete solo nelle sezioni con piu' aeroporti (Roma FCO/CIA)."""
    bits = ["%s: <b>%s pp</b>" % (offer_title(o, cfg), euro(o["price_pp"])), "coppia %s" % euro(o["price_pp"] * 2), fmt_dates(o["dep"], o["ret"]),
            "da %s" % esc(origin_name(o, cfg)) if show_origin and o.get("origin") else "", stops_txt(o),
            "rientro da %s" % esc(o["ret_from"]) if o.get("ret_from") else "",
            "incl. %s stimati" % euro(o["extra_est"]) if o.get("extra_est") else "", est_txt(o, short=True)]
    if o.get("url") and o.get("url_ret"):
        bits.append('voli <a href="%s">andata</a>/<a href="%s">ritorno</a>' % (esc(o["url"]), esc(o["url_ret"])))
    elif o.get("url"):
        bits.append('<a href="%s">voli</a>' % esc(o["url"]))
    return " · ".join(b for b in bits if b)


def dashboard_link(cfg, source=None):
    u = base_url(cfg, source)
    return '<a href="%s">Apri la dashboard</a>' % esc(u) if u else ""


def visible_len(text):
    return len(html.unescape(re.sub(r"<[^>]+>", "", text)))


def split_message(text, limit=3900):
    """Telegram accetta max 4096 caratteri visibili (i tag e gli URL dei link non contano): si spezza sui blocchi
    separati da riga vuota, mai dentro un tag. Un blocco da solo troppo lungo viene spezzato sulle righe."""
    blocks = []
    for block in text.split("\n\n"):
        if visible_len(block) <= limit:
            blocks.append(block)
            continue
        block = block.replace("<blockquote expandable>", "").replace("<blockquote>", "").replace("</blockquote>", "")  # i pezzi restano HTML valido
        cur = ""
        for ln in block.split("\n"):
            if cur and visible_len(cur) + visible_len(ln) + 1 > limit:
                blocks.append(cur)
                cur = ln
            else:
                cur = cur + "\n" + ln if cur else ln
        if cur:
            blocks.append(cur)
    out, cur = [], ""
    for block in blocks:
        if cur and visible_len(cur) + visible_len(block) + 2 > limit:
            out.append(cur)
            cur = block
        else:
            cur = cur + "\n\n" + block if cur else block
    if cur:
        out.append(cur)
    return out


# ---------- snapshot ----------
def load_snapshot(path=None):
    s = load_json(path or BOT_DIR / "snapshot.json", {})
    for k, v in (("offers", []), ("targets", {}), ("sources", {})):
        s.setdefault(k, v)
    return s


def by_target(snap):
    by = {}
    for o in snap.get("offers", []):
        by.setdefault(o["target"], []).append(o)
    for v in by.values():
        v.sort(key=lambda o: (o["price_pp"], o["dep"], o["ret"], o.get("origin") or ""))
    return by


def resolve_target(q, snap):
    """Testo libero -> lista di ID candidati. Accetta ID (d_TBS), codice IATA (TBS), nome di citta' o paese.
    Un ID ben formato ma non (ancora) presente nei dati e' accettato: serve ai deep link delle card."""
    q = (q or "").strip()
    tg = snap.get("targets", {})
    if not q:
        return []
    low = {k.lower(): k for k in tg}
    if q.lower() in low:
        return [low[q.lower()]]
    if ID_RE.match(q) and q[0] in "dtw":
        return [q[:2] + (q[2:].upper() if q[0] in "dw" else q[2:].lower())]
    code = q.upper()
    hits = [k for k in ("d_" + code, "w_" + code) if k in tg]
    if hits:
        return hits
    nq = norm(q)
    if len(nq) < 3:
        return []
    exact = [k for k, t in tg.items() if nq == norm(t.get("name"))]
    if len(exact) == 1:
        return exact
    return sorted(k for k, t in tg.items() if nq in norm("%s %s %s" % (t.get("name"), t.get("country"), k)))


def url_button(text, url):
    """Pulsante inline che apre un link (None se il link manca)."""
    return (str(text)[:40], "url:" + url) if url else None


def button_rows(buttons, per_row=2):
    b = [x for x in buttons if x]
    return [b[i:i + per_row] for i in range(0, len(b), per_row)] or None


def target_name(tid, snap):
    t = snap.get("targets", {}).get(tid)
    return t["name"] if t and t.get("name") else tid


# ---------- Telegram ----------
def bot_token():
    return (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()


def allowed_chats():
    out = []
    for p in re.split(r"[\s,;]+", os.environ.get("TELEGRAM_CHAT_IDS") or ""):
        if re.fullmatch(r"-?\d+", p):
            out.append(int(p))
    return out


def chat_hash(chat_id):
    key = (bot_token() or "dry-run").encode()
    return hmac.new(key, str(chat_id).encode(), hashlib.sha256).hexdigest()[:16]


class TelegramError(Exception):
    pass


class Telegram:
    """Client minimale della Bot API. In dry_run non fa rete: stampa e accumula in .sent."""

    def __init__(self, token=None, dry_run=False, quiet=False):
        self.token, self.dry_run, self.quiet, self.sent = token, dry_run, quiet, []

    def call(self, method, _timeout=30, **params):
        if self.dry_run:
            return self._dry(method, params)
        # ensure_ascii=True: il corpo e' ASCII puro ("€" viaggia come €), quindi nessun problema di codifica
        data = json.dumps({k: v for k, v in params.items() if v is not None}, ensure_ascii=True).encode("utf-8")
        req = urllib.request.Request("https://api.telegram.org/bot%s/%s" % (self.token, method), data=data,
                                     headers={"Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=_timeout) as r:
                res = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                desc = json.loads(e.read().decode()).get("description")
            except Exception:
                desc = None
            raise TelegramError("%s: HTTP %s %s" % (method, e.code, desc or "")) from None  # mai l'URL: contiene il token
        except Exception as e:
            raise TelegramError("%s: %s" % (method, type(e).__name__)) from None
        if not res.get("ok"):
            raise TelegramError("%s: %s" % (method, res.get("description")))
        return res.get("result")

    def _dry(self, method, params):
        if method == "sendMessage":
            lp = params.get("link_preview_options") or {}
            self.sent.append({"chat": params["chat_id"], "text": params["text"], "buttons": params.get("reply_markup"),
                              "silent": bool(params.get("disable_notification")), "preview": None if lp.get("is_disabled") else lp.get("url")})
            if not self.quiet:
                print("--- [dry-run] messaggio per chat#%s%s%s ---" % (chat_hash(params["chat_id"]), " · silenzioso" if params.get("disable_notification") else " · con suono",
                                                                    " · foto %s" % lp["url"] if lp.get("url") else ""))
                print(params["text"])
                for row in (params.get("reply_markup") or {}).get("inline_keyboard", []):
                    print("   " + "  ".join("[%s]" % b["text"] for b in row))
        return [] if method == "getUpdates" else True

    def send(self, chat_id, text, buttons=None, silent=False, preview=None):
        """buttons: righe di (testo, callback_data) oppure (testo, 'url:https://...').
        silent: notifica senza suono (disable_notification). preview: URL di un'immagine da mostrare grande sopra il
        testo come anteprima del link; senza, le anteprime sono disattivate. Se Telegram non riesce a generare
        l'anteprima il messaggio arriva lo stesso, solo testo (a differenza di sendPhoto, che fallirebbe)."""
        kb = None
        if buttons:
            kb = {"inline_keyboard": [[({"text": t, "url": d[4:]} if d.startswith("url:") else {"text": t, "callback_data": d})
                                       for t, d in row] for row in buttons if row]}
        parts = split_message(text)
        for i, part in enumerate(parts):
            lp = {"url": preview, "prefer_large_media": True, "show_above_text": True} if preview and i == 0 else {"is_disabled": True}
            self.call("sendMessage", chat_id=chat_id, text=part, parse_mode="HTML", link_preview_options=lp,
                      disable_notification=True if silent else None, reply_markup=kb if i == len(parts) - 1 else None)
