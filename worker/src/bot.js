// Logica del bot: stessa di bot/commands.py + bot/common.py (testi identici), senza rete e senza stato esterno.
// Chi chiama passa snapshot e preferenze, riceve [testo, bottoni] e salva le preferenze se sono cambiate.

export const GIORNI = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
export const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
export const ID_RE = /^[dtw]_[A-Za-z0-9-]{2,58}$/;
const FAV_DROP_RULES = [{ above: 1000, min_drop_eur: 100 }, { above: 0, min_drop_eur: 50 }];
const ORIGIN_NAMES = { LIN: "Milano LIN", MXP: "Milano MXP", BGY: "Bergamo BGY", FCO: "Roma FCO", CIA: "Roma CIA", PSA: "Pisa" };
const BIG = 10 ** 9;

export function loadConfig(file, env) {
  const cfg = Object.assign({}, file || {});
  if (env && env.SITE_URL) cfg.dashboard_url = env.SITE_URL;
  const def = { threshold_pp: 1000, weekend_threshold_pp: 100, fav_drop_rules: FAV_DROP_RULES, digest_exclude_clima: ["sconsigliato"],
    digest_tabs: ["new"], digest_include_popular: true, mute_days: 7, digest_frequency: "giro" };
  for (const k of Object.keys(def)) if (cfg[k] === undefined) cfg[k] = def[k];
  return cfg;
}

export function normPrefs(p, cfg) {
  p = p && typeof p === "object" ? p : {};
  if (p.threshold == null) p.threshold = cfg.threshold_pp;
  if (!p.favorites || typeof p.favorites !== "object") p.favorites = {};
  if (!Array.isArray(p.paused)) p.paused = [];
  if (!p.muted || typeof p.muted !== "object") p.muted = {};
  return p;
}

// ---------- date ----------
export function romeToday(now) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date());
}
const parseIso = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
};
export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- testo ----------
export function norm(s) {
  return String(s == null ? "" : s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
export function euro(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ".") + " €";
}
const cut = (s, n) => Array.from(String(s)).slice(0, n).join("");
const bytes = (s) => new TextEncoder().encode(s).length;

export function fmtDates(dep, ret) {
  const a = parseIso(dep), b = parseIso(ret);
  if (!a || !b) return `${dep} / ${ret}`;
  const wd = (d) => GIORNI[(d.getUTCDay() + 6) % 7];
  const da = `${wd(a)} ${a.getUTCDate()}`, db = `${wd(b)} ${b.getUTCDate()}`;
  const ma = MESI[a.getUTCMonth()], mb = MESI[b.getUTCMonth()];
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${da} → ${db} ${ma}`;
  if (a.getUTCFullYear() === b.getUTCFullYear()) return `${da} ${ma} → ${db} ${mb}`;
  return `${da} ${ma} ${a.getUTCFullYear()} → ${db} ${mb} ${b.getUTCFullYear()}`;
}

export function stopsTxt(o) {
  const s = o.stops;
  if (s == null) return "";
  let t = s === 0 ? "diretto" : s === 1 ? "1 scalo" : `${s} scali`;
  if (s === 2 && o.price_1stop) t += ` (con 1 scalo ${euro(o.price_1stop)})`;
  return t;
}

export const sourceOf = (tid) => ({ d: "agosto2027", t: "popular", w: "weekend" }[tid[0]] || "agosto2027");

export function baseUrl(cfg, source) {
  const u = String((cfg || {})[source === "weekend" ? "weekend_dashboard_url" : "dashboard_url"] || "").split("#")[0].trim();
  return /^https?:\/\//.test(u) && !u.includes("REPO-DA-DEFINIRE") ? u : "";
}
export function pageUrl(cfg, tid, pageId) {
  const src = sourceOf(tid), b = baseUrl(cfg, src);
  if (!b || src === "weekend") return b;
  return `${b}#/${tid[0]}/${encodeURIComponent(String(pageId || tid.slice(2)))}`;
}
const linked = (label, url) => (url ? `<a href="${esc(url)}">${label}</a>` : label);

export function originName(o, cfg) {
  const code = o && typeof o === "object" ? o.origin : o;
  if (o && typeof o === "object" && o.origin_name) return o.origin_name;
  return ((cfg || {}).origin_names || {})[code] || ORIGIN_NAMES[code] || code || "";
}
export function displayName(o) {
  let nm = String(o.name || o.code || "");
  if (o.country && o.source !== "weekend") nm = nm.replace(/\s*\(([^()]+)\)\s*$/, ", $1");
  return nm;
}
export function offerTitle(o, cfg) {
  const c = o.country && o.source !== "weekend" ? ` (${esc(o.country)})` : "";
  return linked(`<b>${esc(displayName(o))}</b>`, cfg ? pageUrl(cfg, o.target, o.page_id) : "") + c;
}
export function offerBlock(o, cfg) {
  const l1 = `${offerTitle(o, cfg)}: <b>${euro(o.price_pp)} pp</b> · coppia ${euro(o.price_pp * 2)}`;
  const bits = [fmtDates(o.dep, o.ret), o.nights != null ? `${o.nights} notti` : "", o.origin ? `da ${esc(originName(o, cfg))}` : "", stopsTxt(o),
    esc((o.airlines || []).join(" + "))];
  if (o.ret_from) bits.splice(3, 0, `rientro da ${esc(o.ret_from)}`);
  if (o.extra_est) bits.push(`incl. ${euro(o.extra_est)} di tratte stimate`);
  if (o.est) bits.push(o.price_out == null || o.price_ret == null ? "stima: somma di due solo andata" : `stima: somma di due solo andata (andata ${euro(o.price_out)} + ritorno ${euro(o.price_ret)})`);
  if (o.url && o.url_ret) bits.push(`Google Flights: <a href="${esc(o.url)}">andata</a>, <a href="${esc(o.url_ret)}">ritorno</a>`);
  else if (o.url) bits.push(`<a href="${esc(o.url)}">Google Flights</a>`);
  return l1 + "\n   " + bits.filter(Boolean).join(" · ");
}
export function dashboardLink(cfg, source) {
  const u = baseUrl(cfg, source);
  return u ? `<a href="${esc(u)}">Apri la dashboard</a>` : "";
}

const unescapeHtml = (s) => s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" }[e]));
export const visibleLen = (t) => Array.from(unescapeHtml(t.replace(/<[^>]+>/g, ""))).length;

export function splitMessage(text, limit = 3900) {
  const blocks = [];
  for (let block of text.split("\n\n")) {
    if (visibleLen(block) <= limit) { blocks.push(block); continue; }
    block = block.replace(/<blockquote expandable>|<blockquote>|<\/blockquote>/g, "");
    let cur = "";
    for (const ln of block.split("\n")) {
      if (cur && visibleLen(cur) + visibleLen(ln) + 1 > limit) { blocks.push(cur); cur = ln; }
      else cur = cur ? cur + "\n" + ln : ln;
    }
    if (cur) blocks.push(cur);
  }
  const out = [];
  let cur = "";
  for (const block of blocks) {
    if (cur && visibleLen(cur) + visibleLen(block) + 2 > limit) { out.push(cur); cur = block; }
    else cur = cur ? cur + "\n\n" + block : block;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- regole ----------
export function dropRules(cfg) {
  const out = [];
  for (const r of (cfg || {}).fav_drop_rules || FAV_DROP_RULES) {
    const above = Number(r && r.above) || 0, eur = Number(r && r.min_drop_eur);
    if (r && Number.isFinite(eur)) out.push([above, eur]);
  }
  return (out.length ? out : [[1000, 100], [0, 50]]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
}
export function minDrop(ref, cfg) {
  const rules = dropRules(cfg);
  for (const [above, eur] of rules) if (ref > above) return eur;
  return rules[rules.length - 1][1];
}
export function dropRulesTxt(cfg) {
  const rules = dropRules(cfg);
  return rules.map(([above, eur], i) => (above > 0 ? `${euro(eur)} sopra ${euro(above)} pp` : `${euro(eur)}${i ? ` fino a ${euro(rules[i - 1][0])}` : ""}`)).join(", ");
}
export const defaultThreshold = (source, prefs, cfg) => (source === "weekend" ? cfg.weekend_threshold_pp : prefs.threshold);
export function favThreshold(tid, prefs, cfg) {
  const t = (prefs.favorites[tid] || {}).thr;
  return t ? t : defaultThreshold(sourceOf(tid), prefs, cfg);
}
export function inDigest(tid, target, cfg) {
  target = target || {};
  const src = sourceOf(tid);
  if (src === "weekend") return true;
  if (src === "popular") return cfg.digest_include_popular !== false;
  if ((cfg.digest_exclude_clima || []).includes(target.clima)) return false;
  const tabs = cfg.digest_tabs || [];
  return !tabs.length || !target.tab || tabs.includes(target.tab);
}

// ---------- snapshot ----------
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function byTarget(snap) {
  const by = new Map();
  for (const o of snap.offers || []) {
    if (!by.has(o.target)) by.set(o.target, []);
    by.get(o.target).push(o);
  }
  for (const v of by.values()) v.sort((a, b) => a.price_pp - b.price_pp || cmp(a.dep, b.dep) || cmp(a.ret, b.ret) || cmp(a.origin || "", b.origin || ""));
  return by;
}
export function resolveTarget(q, snap) {
  q = String(q || "").trim();
  const tg = snap.targets || {};
  if (!q) return [];
  const low = q.toLowerCase();
  for (const k of Object.keys(tg)) if (k.toLowerCase() === low) return [k];
  if (ID_RE.test(q)) return [q.slice(0, 2) + ("dw".includes(q[0]) ? q.slice(2).toUpperCase() : q.slice(2).toLowerCase())];
  const code = q.toUpperCase();
  const hits = ["d_" + code, "w_" + code].filter((k) => k in tg);
  if (hits.length) return hits;
  const nq = norm(q);
  if (nq.length < 3) return [];
  const exact = Object.keys(tg).filter((k) => nq === norm(tg[k].name));
  if (exact.length === 1) return exact;
  return Object.keys(tg).filter((k) => norm(`${tg[k].name} ${tg[k].country} ${k}`).includes(nq)).sort();
}
export const urlButton = (text, url) => (url ? [cut(text, 40), "url:" + url] : null);
export function rows(buttons, perRow = 2) {
  const b = buttons.filter(Boolean), out = [];
  for (let i = 0; i < b.length; i += perRow) out.push(b.slice(i, i + perRow));
  return out.length ? out : null;
}
export const btn = (text, data) => (bytes(data) <= 64 ? [cut(text, 40), data] : null);

export const HELP = `<b>Comandi</b>
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
I prezzi sono sempre A/R <b>a persona</b>; tra parentesi o dopo il punto trovi la coppia.`;

const DIGEST = { giro: "a ogni giro di scansione", giorno: "una volta al giorno", settimana: "una volta a settimana" };
const ALIASES = { favoriti: "preferiti", fav: "preferiti", add: "aggiungi", remove: "rimuovi", togli: "rimuovi", aiuto: "help", resume: "riprendi",
  pause: "pausa", dest: "meta", mute: "silenzia", muta: "silenzia", riepilogo: "digest" };
const starts = (s, list) => list.some((p) => s.startsWith(p));

export class Bot {
  /** opts: {today: "YYYY-MM-DD" (Roma), now: ISO, who: nome di chi scrive, chatHash: hash della chat per /pausa} */
  constructor(cfg, snap, prefs, opts = {}) {
    this.cfg = cfg; this.snap = snap; this.prefs = prefs;
    this.by = byTarget(snap);
    this.today = opts.today || romeToday();
    this.now = opts.now || new Date().toISOString();
    this.who = opts.who || null;
    this.chatHash = opts.chatHash || "";
    this.added = []; // id aggiunti ai preferiti in questa chiamata (per la conferma alle altre chat)
  }

  // ----- utilita' -----
  target(tid) { return (this.snap.targets || {})[tid] || {}; }
  name(tid) { return this.target(tid).name || tid; }
  title(tid) { const t = this.target(tid); return linked(`<b>${esc(t.name || tid)}</b>`, pageUrl(this.cfg, tid, t.page_id)); }
  openBtn(tid, text = "🔗 Apri") { return urlButton(text, pageUrl(this.cfg, tid, this.target(tid).page_id)); }
  best(tid) { const o = this.by.get(tid); return o && o.length ? o[0] : null; }
  label(tid) {
    const kind = { d: "meta", t: "giro", w: "weekend" }[tid[0]], b = this.best(tid);
    return `${cut(this.name(tid), 26)} · ${kind}${b ? ` · ${euro(b.price_pp)}` : ""}`;
  }
  priceLine(tid) { const b = this.best(tid); return b ? offerBlock(b, this.cfg) : `${this.title(tid)}: nessun volo pubblicato per ora`; }
  /** Quante combinazioni ha la meta e quante stanno sotto soglia (lo snapshot ridotto porta l'elenco dei prezzi in targets[].prices). */
  counts(tid, thr) {
    const t = this.target(tid), offers = this.by.get(tid) || [];
    const prices = Array.isArray(t.prices) ? t.prices : offers.map((o) => o.price_pp);
    return [prices.length, prices.filter((p) => p <= thr).length];
  }

  pick(q, verb, action, pool) {
    if (!q) return [null, [`Dimmi quale meta, per esempio <code>/${verb} TBS</code>.`, null]];
    let c = resolveTarget(q, this.snap);
    if (pool) c = c.filter((x) => x in pool);
    if (!c.length) return [null, [`Non trovo nessuna meta per «${esc(q)}». Prova con il codice aeroporto (es. TBS) o guarda /top.`, null]];
    if (c.length === 1) return [c[0], null];
    const price = (t) => (this.best(t) || {}).price_pp ?? BIG;
    c.sort((a, b) => price(a) - price(b) || cmp(a, b));
    let txt = `Ne ho trovate ${c.length} per «${esc(q)}», quale intendi?`;
    if (c.length > 8) txt += " Ti mostro le prime 8 per prezzo.";
    return [null, [txt, rows(c.slice(0, 8).map((t) => btn(this.label(t), `${action}:${t}`)), 1)]];
  }

  newFav(tid) {
    const f = { added: this.today, at: this.now };
    if (this.who) f.by = this.who;
    const b = this.best(tid);
    if (b) f.p = b.price_pp; // riferimento per il primo "prezzo sceso" di alerts.py
    this.prefs.favorites[tid] = f;
    this.added.push(tid);
    return f;
  }

  /** Riga breve mandata a tutte le chat quando qualcuno aggiunge un preferito. */
  addedNotice(tid, who) {
    const b = this.best(tid);
    const price = b ? `, oggi <b>${euro(b.price_pp)} pp</b>${b.origin ? ` da ${esc(originName(b, this.cfg))}` : ""}` : ": nessun volo pubblicato per ora";
    return `⭐ Aggiunto${who ? ` da ${esc(who)}` : ""}: ${this.title(tid)}${price}`;
  }

  // ----- azioni -----
  add(tid) {
    const favs = this.prefs.favorites, known = tid in (this.snap.targets || {});
    let head;
    if (tid in favs) head = `⭐ ${this.title(tid)} è già tra i preferiti.`;
    else { this.newFav(tid); head = `⭐ Aggiunto ai preferiti: ${this.title(tid)}.`; }
    const b = this.best(tid);
    let body;
    if (b) {
      const how = `quando il miglior prezzo scende di almeno ${euro(minDrop(b.price_pp, this.cfg))} a persona rispetto a oggi, anche su date o aeroporti diversi`;
      body = `${this.priceLine(tid)}\nTi avviso ${how}, se escono nuove date o se scende sotto ${euro(favThreshold(tid, this.prefs, this.cfg))} pp.`;
    } else if (known) body = "Per ora nessun volo pubblicato: ti scrivo appena compaiono.";
    else body = `Non ho ancora dati su questa meta (ID <code>${esc(tid)}</code>): ti scrivo appena compaiono voli.`;
    let sug = null;
    if (b && b.price_pp >= 60) {
      const v = Math.floor((b.price_pp * 0.9) / 10) * 10;
      sug = btn(`🔔 Avvisami sotto ${euro(v)}`, `thr:${tid}:${v}`);
    }
    return [head + "\n" + body, rows([sug, btn("❌ Rimuovi", `rm:${tid}`), this.openBtn(tid)])];
  }

  remove(tid) {
    if (!(tid in this.prefs.favorites)) return [`${this.title(tid)} non è tra i preferiti.`, null];
    delete this.prefs.favorites[tid];
    return [`Tolto dai preferiti: ${this.title(tid)}.`, rows([btn("↩️ Rimetti", `add:${tid}`)])];
  }

  setThr(tid, val) {
    const favs = this.prefs.favorites, added = !(tid in favs);
    const f = added ? this.newFav(tid) : favs[tid];
    if (val == null) {
      delete f.thr;
      return [`Soglia personalizzata tolta per ${this.title(tid)}: vale quella generale (${euro(favThreshold(tid, this.prefs, this.cfg))} pp).`, null];
    }
    f.thr = val;
    const b = this.best(tid);
    const now = b ? ` Oggi il migliore è ${euro(b.price_pp)} pp.` : "";
    return [`🎯 ${this.title(tid)}: ti avviso sotto <b>${euro(val)} a persona</b> (coppia ${euro(val * 2)}).${now}${added ? " L'ho anche aggiunta ai preferiti." : ""}`, null];
  }

  mute(tid, days) {
    const m = this.prefs.muted;
    if (!days) { delete m[tid]; return [`🔔 Avvisi riattivati per ${this.title(tid)}.`, null]; }
    const until = addDays(this.today, days), d = parseIso(until);
    m[tid] = until;
    return [`🔕 ${this.title(tid)} silenziata per ${days} giorni (fino al ${d.getUTCDate()} ${MESI[d.getUTCMonth()]}). I prezzi continuo a seguirli: se nel frattempo cala, te lo dico alla riattivazione.`,
      rows([btn("🔔 Riattiva", `unmute:${tid}`)])];
  }

  setDigest(mode) {
    this.prefs.digest = mode;
    return [`🗞 Riepilogo: <b>${DIGEST[mode]}</b>. Gli avvisi singoli sui preferiti restano immediati.`, null];
  }

  // ----- comandi -----
  cmd_digest(arg) {
    const a = norm(arg);
    const mode = starts(a, ["giro", "ogni", "sempre"]) ? "giro" : starts(a, ["giorn", "daily", "quotid"]) ? "giorno" : starts(a, ["sett", "week"]) ? "settimana" : null;
    if (mode) return this.setDigest(mode);
    const cur = this.prefs.digest || this.cfg.digest_frequency || "giro";
    return [`🗞 Il riepilogo delle offerte arriva <b>${DIGEST[cur] || cur}</b>, senza suono. Ogni quanto lo vuoi?`,
      rows([btn("A ogni giro", "dg:giro"), btn("Giornaliero", "dg:giorno"), btn("Settimanale", "dg:settimana")], 3)];
  }

  cmd_silenzia(arg) {
    let parts = arg.split(/\s+/).filter(Boolean), days = this.cfg.mute_days;
    const last = parts.length ? parts[parts.length - 1] : "";
    if (parts.length && (/^\d+$/.test(last) || ["off", "no", "via"].includes(last.toLowerCase()))) {
      days = /^\d+$/.test(last) ? parseInt(last, 10) : 0;
      parts = parts.slice(0, -1);
    }
    if (!parts.length) {
      const m = Object.entries(this.prefs.muted || {}).filter(([, u]) => u >= this.today).sort((a, b) => cmp(a[0], b[0]));
      if (!m.length) return ["Nessuna meta silenziata. Esempio: <code>/silenzia TBS</code> (7 giorni) o <code>/silenzia TBS 14</code>.", null];
      return ["🔕 Silenziate: " + m.map(([t, u]) => `${this.title(t)} (fino al ${u})`).join(", "), rows(m.map(([t]) => btn(`🔔 ${this.name(t)}`, `unmute:${t}`)))];
    }
    if (!(days >= 0 && days <= 365)) return ["I giorni devono stare tra 1 e 365.", null];
    const [tid, ask] = this.pick(parts.join(" "), "silenzia", "mute0");
    if (ask) {
      if (ask[1]) ask[1] = ask[1].flat().filter(([, d]) => d.length < 56).map(([t, d]) => [[t, d.replace("mute0:", "mute:") + `:${days}`]]);
      return ask;
    }
    return this.mute(tid, days);
  }

  cmd_start(arg) {
    if (arg.startsWith("fav_")) {
      const tid = resolveTarget(arg.slice(4), this.snap);
      if (tid.length === 1 && ID_RE.test(tid[0])) return this.add(tid[0]);
      return [`Il link non è valido (meta «${esc(arg.slice(4))}»).`, null];
    }
    const tabs = this.cfg.digest_tabs || [];
    const scope = tabs.length === 1 && tabs[0] === "new" ? "le Nuove mete" + (this.cfg.digest_include_popular !== false ? " e i Popular trips" : "") : "le mete";
    return ["Ciao! Tengo d'occhio i voli di agosto 2027 e i weekend da Milano.\n" +
      `Nel riepilogo e in /top entrano ${scope}; le mete già visitate le seguo solo se le metti tra i preferiti.\n` +
      `Ti scrivo quando una meta scende sotto <b>${euro(this.prefs.threshold)} a persona</b> A/R, quando un preferito cala di almeno ${dropRulesTxt(this.cfg)} o escono nuove date, ` +
      `e quando compaiono voli su rotte ancora vuote.\n\n${HELP}`,
      rows([btn("🏆 Top 5", "top"), btn("⭐ Preferiti", "favs")])];
  }

  cmd_help() {
    const link = dashboardLink(this.cfg);
    return [HELP + (link ? "\n\n" + link : ""), null];
  }

  cmd_preferiti() {
    const favs = this.prefs.favorites;
    if (!Object.keys(favs).length) return ["Nessun preferito. Aggiungine uno con <code>/aggiungi TBS</code> o dalla stella sulla dashboard.", rows([btn("🏆 Top 5", "top")])];
    const price = (t) => (this.best(t) || {}).price_pp ?? BIG;
    const ids = Object.keys(favs).sort((a, b) => price(a) - price(b) || cmp(a, b));
    const out = [`<b>I tuoi preferiti</b> (${ids.length})`];
    for (const t of ids) out.push("⭐ " + this.priceLine(t) + (favs[t].thr ? `\n   🎯 soglia ${euro(favs[t].thr)} pp` : ""));
    return [out.join("\n\n"), rows(ids.flatMap((t) => [btn(`❌ ${this.name(t)}`, `rm:${t}`), this.openBtn(t, `🔗 Apri ${this.name(t)}`)]))];
  }

  cmd_aggiungi(arg) {
    const [tid, ask] = this.pick(arg, "aggiungi", "add");
    return ask || this.add(tid);
  }

  cmd_rimuovi(arg) {
    const favs = this.prefs.favorites;
    if (!arg) {
      if (!Object.keys(favs).length) return ["Nessun preferito da togliere.", null];
      return ["Quale tolgo?", rows(Object.keys(favs).sort().map((t) => btn(`❌ ${this.name(t)}`, `rm:${t}`)))];
    }
    const [tid, ask] = this.pick(arg, "rimuovi", "rm", favs);
    if (ask && ask[0].includes("Non trovo")) return [`«${esc(arg)}» non è tra i preferiti. Vedi /preferiti.`, null];
    return ask || this.remove(tid);
  }

  cmd_soglia(arg) {
    const parts = arg.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      const favs = Object.entries(this.prefs.favorites).filter(([, f]) => f.thr).sort((a, b) => cmp(a[0], b[0]));
      const out = [`Soglia generale: <b>${euro(this.prefs.threshold)} a persona</b> (coppia ${euro(this.prefs.threshold * 2)}).`,
        `Weekend: ${euro(this.cfg.weekend_threshold_pp)} a persona.`];
      for (const [t, f] of favs) out.push(`🎯 ${this.title(t)}: ${euro(f.thr)} pp`);
      out.push("Per cambiarla: <code>/soglia 900</code> oppure <code>/soglia TBS 300</code>.");
      return [out.join("\n"), null];
    }
    const last = parts[parts.length - 1].toLowerCase().replace(/€/g, "").replace(/\./g, "");
    const off = ["off", "no", "via", "0"].includes(last);
    if (!off && !/^\d+$/.test(last)) return ["Mi serve un importo in euro, per esempio <code>/soglia 900</code> o <code>/soglia TBS 300</code>.", null];
    const val = off ? null : parseInt(last, 10);
    if (val != null && !(val >= 10 && val <= 20000)) return ["La soglia deve stare tra 10 e 20.000 €.", null];
    const q = parts.slice(0, -1).join(" ");
    if (!q) {
      if (val == null) return ["La soglia generale non si può togliere. Per non ricevere avvisi usa /pausa.", null];
      this.prefs.threshold = val;
      let n = 0;
      for (const o of this.by.values()) if (o[0].source !== "weekend" && o[0].price_pp <= val) n++;
      return [`Soglia generale: <b>${euro(val)} a persona</b> (coppia ${euro(val * 2)}). Oggi ci stanno sotto ${n} mete: /top.`, null];
    }
    const [tid, ask] = this.pick(q, "soglia", "thr0");
    if (ask) {
      if (ask[1]) ask[1] = ask[1].flat().filter(([, d]) => d.length < 56).map(([t, d]) => [[t, d.replace("thr0:", "thr:") + `:${val != null ? val : "off"}`]]);
      return ask;
    }
    return this.setThr(tid, val);
  }

  cmd_top(arg) {
    const wk = norm(arg).startsWith("week");
    const thr = wk ? this.cfg.weekend_threshold_pp : this.prefs.threshold;
    const favs = this.prefs.favorites, best = [];
    for (const [t, o] of this.by) {
      if ((o[0].source === "weekend") === wk && o[0].price_pp <= thr && (t in favs || inDigest(t, (this.snap.targets || {})[t], this.cfg))) best.push(o[0]);
    }
    best.sort((a, b) => a.price_pp - b.price_pp);
    if (!best.length) return [`Nessuna meta sotto ${euro(thr)} a persona al momento.`, null];
    const out = [`🏆 <b>Le migliori sotto ${euro(thr)} a persona</b>${wk ? " (weekend)" : ""}`];
    best.slice(0, 5).forEach((o, i) => out.push(`${i + 1}. ${offerBlock(o, this.cfg)}`));
    if (best.length > 5) out.push(`In tutto ${best.length} mete sotto soglia. ${dashboardLink(this.cfg, wk ? "weekend" : null)}`);
    return [out.join("\n\n"), rows(best.slice(0, 5).filter((o) => !(o.target in favs)).map((o) => btn(`⭐ ${o.name}`, `add:${o.target}`)))];
  }

  meta(tid) {
    const t = this.target(tid), offers = this.by.get(tid) || [], fav = tid in this.prefs.favorites;
    const toggle = fav ? btn("❌ Togli dai preferiti", `rm:${tid}`) : btn("⭐ Aggiungi ai preferiti", `add:${tid}`);
    if (!offers.length) {
      const cov = t.q ? ` (${t.q} ricerche fatte, ${t.ok} con voli ma fuori dalle regole sugli scali)` : "";
      return [`${this.title(tid)}: nessun volo valido pubblicato per ora${cov}.`, rows([toggle, this.openBtn(tid)])];
    }
    const best = offers[0], out = [(fav ? "⭐ " : "") + offerBlock(best, this.cfg)];
    const seen = new Set([best.dep + "|" + best.ret]), alt = [];
    for (const o of offers.slice(1)) {
      if (!seen.has(o.dep + "|" + o.ret)) {
        seen.add(o.dep + "|" + o.ret);
        alt.push(`• ${fmtDates(o.dep, o.ret)} · ${o.nights} notti · da ${esc(originName(o, this.cfg))}: <b>${euro(o.price_pp)} pp</b>`);
      }
      if (alt.length === 3) break;
    }
    if (alt.length) out.push("Altre date:\n" + alt.join("\n"));
    const thr = favThreshold(tid, this.prefs, this.cfg), [n, under] = this.counts(tid, thr);
    out.push(`${n} combinazioni, ${under} sotto ${euro(thr)} pp.`);
    return [out.join("\n\n"), rows([toggle, this.openBtn(tid)])];
  }

  cmd_meta(arg) {
    const [tid, ask] = this.pick(arg, "meta", "meta");
    return ask || this.meta(tid);
  }

  cmd_pausa() {
    if (!this.prefs.paused.includes(this.chatHash)) this.prefs.paused.push(this.chatHash);
    return ["⏸ Avvisi in pausa per questa chat. I comandi restano attivi; per ripartire /riprendi.", rows([btn("▶️ Riprendi", "resume")])];
  }

  cmd_riprendi() {
    this.prefs.paused = this.prefs.paused.filter((x) => x !== this.chatHash);
    return ["▶️ Avvisi riattivati per questa chat.", null];
  }

  /** -> {cmd, arg} oppure null se il testo non e' un comando. */
  static parseCommand(text) {
    text = String(text || "").trim();
    if (!text.startsWith("/")) return null;
    const i = text.indexOf(" ");
    const head = i < 0 ? text : text.slice(0, i), arg = i < 0 ? "" : text.slice(i + 1).trim();
    const cmd = head.slice(1).split("@")[0].toLowerCase();
    return { cmd: ALIASES[cmd] || cmd, arg };
  }

  onText(text) {
    const c = Bot.parseCommand(text);
    if (!c) return null;
    const fn = /^[a-z0-9]+$/.test(c.cmd) ? this["cmd_" + c.cmd] : null;
    if (typeof fn !== "function") return ["Comando non riconosciuto. Vedi /help.", null];
    return fn.call(this, c.arg);
  }

  onCallback(data) {
    data = String(data || "");
    const i = data.indexOf(":"), act = i < 0 ? data : data.slice(0, i), rest = i < 0 ? "" : data.slice(i + 1);
    const j = rest.lastIndexOf(":"), tid = j < 0 ? "" : rest.slice(0, j), v = j < 0 ? rest : rest.slice(j + 1);
    if (act === "top") return this.cmd_top("");
    if (act === "favs") return this.cmd_preferiti("");
    if (act === "resume") return this.cmd_riprendi("");
    if (act === "dg" && rest in DIGEST) return this.setDigest(rest);
    if (act === "unmute" && ID_RE.test(rest)) return this.mute(rest, 0);
    if (act === "mute" && ID_RE.test(tid) && /^\d+$/.test(v) && +v <= 365) return this.mute(tid, +v);
    if (act === "thr") {
      if (ID_RE.test(tid) && (v === "off" || /^\d+$/.test(v))) return this.setThr(tid, v === "off" ? null : parseInt(v, 10));
    } else if (ID_RE.test(rest)) {
      if (act === "add") return this.add(rest);
      if (act === "rm") return this.remove(rest);
      if (act === "meta") return this.meta(rest);
    }
    return ["Pulsante non più valido.", null];
  }
}
