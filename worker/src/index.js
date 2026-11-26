// Worker Cloudflare del bot voli agosto 2027: preferiti condivisi (KV), API per il sito e webhook Telegram.
//
//   POST /api/fav     {id, on}      aggiunge o toglie un preferito            (Bearer: token personale da /sito)
//   GET  /api/favs                  elenco dei preferiti con chi e quando     (Bearer: token personale)
//   POST /api/rate    {id, s}       voto 0-5 di chi chiama su un giro (il sito vota solo i trip "t_..."); s null lo toglie   (Bearer: token personale)
//   GET  /api/rates                 voti di tutti i profili, con i nomi                          (Bearer: token personale)
//   POST /api/pin     {alias, pin}  indirizzo corto + PIN di 4 cifre -> {token, name}: lo stesso token di /sito   (nessun Bearer)
//   GET  /api/prefs                 preferenze complete per bot/alerts.py     (Bearer: PREFS_SECRET)
//   POST /tg/<WEBHOOK_SECRET>       webhook Telegram (controlla anche l'header X-Telegram-Bot-Api-Secret-Token)
//
// Stato su KV (binding PREFS): "prefs" = stessa struttura di bot/state/prefs.json, "auth" = versione dei link per chat,
// "rates:<chat_hash>" = voti di un profilo {id: [stelle, quando]}: una chiave a testa, cosi' due voti insieme non si pestano.
// "pin:<chat_hash>" = {h: HMAC del PIN, n: nome, at}, "pinlock:<alias>" = {n: errori, lvl, until} con scadenza.
// Secret: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, HMAC_SECRET, PREFS_SECRET, WEBHOOK_SECRET; facoltativi CHAT_NAMES ("id:Nome,id:Nome")
// e ALIASES ("alias:id,alias:id": gli indirizzi corti del sito, mai scritti nel repo).
// Nei log non finiscono mai chat_id, nomi, token o testi dei messaggi.
import CONFIG from "../../bot/config.json" with { type: "json" };
// Costi dei giri [a terra min, a terra max, voli interni, notti] per id: ripiego per /voti quando lo snapshot non li porta ancora
// (snapshot.py li scrive in targets[id].land / itot / nights, e quelli vincono sempre). Si rigenera con: python worker/trip_costs.py
import TRIP_COSTS from "./trip_costs.json" with { type: "json" };
import { Bot, ID_RE, esc, euro, loadConfig, normPrefs, resolveTarget, splitMessage, romeToday } from "./bot.js";

const DEFAULTS = {
  ALLOWED_ORIGIN: "https://cosimoney.github.io",
  SITE_URL: "https://cosimoney.github.io/agosto2027/",
  SNAPSHOT_BASE: "https://raw.githubusercontent.com/cosimoney/agosto2027/data/bot/",
};
const SNAP_TTL_MS = 5 * 60 * 1000;
const MAX_FAVS = 200;
const MAX_RATES = 600;
const RATE_ID_RE = /^[dt]_[A-Za-z0-9-]{2,58}$/;
const enc = new TextEncoder();
const conf = (env, k) => (env && env[k]) || DEFAULTS[k];

// ---------- firma ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmacHex(secret, msg) {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(msg)));
}
async function sameSecret(a, b) {
  // confronto a tempo costante: si confrontano gli HMAC dei due valori
  if (!a || !b) return false;
  const [x, y] = await Promise.all([hmacHex("cmp", String(a)), hmacHex("cmp", String(b))]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

/** Token personale: base64url(JSON {c: chat_id, v: versione, n: nome}) + "." + HMAC-SHA256. */
export async function signToken(secret, data) {
  const payload = b64u(enc.encode(JSON.stringify(data)));
  return payload + "." + b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
}
/** -> {c, v, n} se la firma e' valida, altrimenti null. Revoca e chat autorizzate le controlla authUser. */
export async function verifyToken(secret, token) {
  try {
    token = String(token || "");
    const [payload, sig, extra] = token.split(".");
    if (!secret || !payload || !sig || extra !== undefined || token.length > 600) return null;
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64u(sig), enc.encode(payload)))) return null;
    const d = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return d && Number.isSafeInteger(d.c) && Number.isSafeInteger(d.v) ? d : null;
  } catch (e) {
    return null;
  }
}
/** Stesso hash di bot/common.py chat_hash: serve a /pausa, che alerts.py legge. */
export const chatHash = async (token, chat) => (await hmacHex(token || "dry-run", String(chat))).slice(0, 16);
/** Chiave alternativa per /api/prefs derivata dal token del bot: alerts.py la calcola senza altri secret. */
export const derivedPrefsKey = (token) => hmacHex(token, "agosto2027-prefs-v1");

// ---------- configurazione e stato ----------
export function allowedChats(env) {
  return String(env.TELEGRAM_CHAT_IDS || "").split(/[\s,;]+/).filter((p) => /^-?\d+$/.test(p)).map(Number);
}
function chatNames(env) {
  const out = {};
  for (const p of String(env.CHAT_NAMES || "").split(/[,;\n]+/)) {
    const m = /^\s*(-?\d+)\s*[:=]\s*(.{1,40}?)\s*$/.exec(p);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const nameOf = (env, chat, from) => chatNames(env)[String(chat)] || String((from && from.first_name) || "").slice(0, 40) || null;

async function kvJson(env, key, def) {
  try {
    const v = await env.PREFS.get(key, "json");
    return v && typeof v === "object" ? v : def;
  } catch (e) {
    return def;
  }
}
const loadPrefs = async (env, cfg) => normPrefs(await kvJson(env, "prefs", {}), cfg);
const savePrefs = (env, prefs) => env.PREFS.put("prefs", JSON.stringify(prefs));

let SNAP = { at: 0, data: null };
/** Snapshot delle offerte dal branch data: prima la versione ridotta, poi quella completa. In memoria per 5 minuti. */
export async function getSnapshot(env, force) {
  if (!force && SNAP.data && Date.now() - SNAP.at < SNAP_TTL_MS) return SNAP.data;
  for (const name of ["snapshot_lite.json", "snapshot.json"]) {
    try {
      const r = await fetch(conf(env, "SNAPSHOT_BASE") + name, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && Array.isArray(d.offers) && d.targets) {
        SNAP = { at: Date.now(), data: d };
        return d;
      }
    } catch (e) { /* si prova il file successivo */ }
  }
  if (SNAP.data) return SNAP.data; // rete giu': meglio i dati di prima che niente
  return { offers: [], targets: {}, sources: {}, generated: null, missing: true };
}
export const _resetSnapshotCache = () => { SNAP = { at: 0, data: null }; };

// ---------- Telegram ----------
class Telegram {
  constructor(token) { this.token = token; }
  async call(method, params) {
    const r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params),
    });
    let res = null;
    try { res = await r.json(); } catch (e) { /* risposta non JSON */ }
    if (!res || !res.ok) throw new Error(`${method}: HTTP ${r.status} ${(res && res.description) || ""}`); // mai l'URL: contiene il token
    return res.result;
  }
  /** buttons: righe di [testo, callback_data] oppure [testo, "url:https://..."]. */
  async send(chat, text, buttons, silent) {
    const kb = buttons && buttons.length
      ? { inline_keyboard: buttons.filter((r) => r && r.length).map((row) => row.map(([t, d]) => (d.startsWith("url:") ? { text: t, url: d.slice(4) } : { text: t, callback_data: d }))) }
      : undefined;
    const parts = splitMessage(text);
    for (let i = 0; i < parts.length; i++) {
      await this.call("sendMessage", { chat_id: chat, text: parts[i], parse_mode: "HTML", link_preview_options: { is_disabled: true },
        disable_notification: silent ? true : undefined, reply_markup: i === parts.length - 1 ? kb : undefined });
    }
  }
}

/** Conferma immediata di un preferito aggiunto, a tutte le chat autorizzate tranne `skip` (chi ha gia' la risposta completa) e quelle in pausa. */
async function notifyAdded(env, bot, tid, who, skip) {
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN), text = bot.addedNotice(tid, who);
  const buttons = [[bot.openBtn(tid, "🔗 Apri pagina"), ["❌ Rimuovi", `rm:${tid}`]].filter(Boolean)];
  let n = 0;
  for (const chat of allowedChats(env)) {
    if (chat === skip) continue;
    if (bot.prefs.paused.includes(await chatHash(env.TELEGRAM_BOT_TOKEN, chat))) continue;
    try { await tg.send(chat, text, buttons, false); n++; } catch (e) { console.log("conferma non inviata: " + String(e.message).slice(0, 80)); }
  }
  return n;
}

// ---------- link personale ----------
async function siteLink(env, chat, name, renew) {
  const auth = await kvJson(env, "auth", {});
  let v = Number(auth[String(chat)]) || 1;
  if (renew) {
    v += 1;
    auth[String(chat)] = v;
    await env.PREFS.put("auth", JSON.stringify(auth));
  }
  const token = await signToken(env.HMAC_SECRET, { c: chat, v, n: name || "" });
  return conf(env, "SITE_URL").split("#")[0] + "#/login/" + token;
}
async function personalToken(env, chat, name) {
  const auth = await kvJson(env, "auth", {});
  return signToken(env.HMAC_SECRET, { c: chat, v: Number(auth[String(chat)]) || 1, n: name || "" });
}
async function cmdSito(env, chat, name, arg) {
  const renew = /^(nuovo|revoca|reset|rigenera)/i.test(arg || "");
  if (!env.HMAC_SECRET) return ["Il collegamento con il sito non è ancora configurato.", null];
  const link = await siteLink(env, chat, name, renew);
  return [(renew ? "🔁 Ho annullato i link precedenti. Questo è quello nuovo.\n" : "") +
    "🔗 <b>Il tuo link personale per il sito</b>\n" +
    "Aprilo una volta su ogni dispositivo (telefono, computer): da quel momento la stella sul sito salva subito e trovi la pagina Preferiti.\n" +
    "Il link vale solo per te, non inoltrarlo. Per annullare quelli già creati: <code>/sito nuovo</code>.",
    [[["⭐ Apri il sito con i preferiti", "url:" + link]]]];
}

// ---------- indirizzo corto + PIN ----------
// Gli alias stanno solo nel secret ALIASES. Il PIN si sceglie dal bot con /pin: nel KV finisce il suo HMAC (chiave HMAC_SECRET,
// sale = chat), mai il PIN. Errori: dopo PIN_MAX_FAILS di fila l'alias si blocca per PIN_LOCKS[livello]; il livello cala dopo un giorno tranquillo.
export const ALIAS_RE = /^[a-z]{2,12}$/;
const PIN_RE = /^\d{4}$/;
const PIN_MAX_FAILS = 5;
const PIN_LOCKS = [15 * 60, 60 * 60, 4 * 3600, 24 * 3600]; // secondi
const PIN_MEMORY = 24 * 3600;
const pinKey = (h) => "pin:" + h;
const lockKey = (alias) => "pinlock:" + alias;
export function aliasMap(env) {
  const out = {}, ok = allowedChats(env);
  for (const p of String(env.ALIASES || "").split(/[,;\s]+/)) {
    const m = /^([a-z]{2,12})[:=](-?\d+)$/.exec(p);
    if (m && ok.includes(Number(m[2]))) out[m[1]] = Number(m[2]);
  }
  return out;
}
export const pinHash = (secret, chat, pin) => hmacHex(secret, `pin-v1:${chat}:${pin}`);
const weakPin = (p) => /^(\d)\1{3}$/.test(p) || "01234567890".includes(p) || "09876543210".includes(p);
const aliasOf = (env, chat) => (Object.entries(aliasMap(env)).find(([, c]) => c === chat) || [null])[0];
const aliasUrl = (env, alias) => conf(env, "SITE_URL").split("#")[0] + "#/" + alias;

// Alias sconosciuti: stesso conteggio ma in memoria, cosi' la risposta e' uguale e nessuno puo' riempire il KV di chiavi inventate.
const GHOST = new Map();
// Un tentativo alla volta per alias dentro lo stesso isolate: il contatore non si fa scavalcare da richieste in parallelo.
const QUEUE = new Map();
function serial(key, fn) {
  const run = (QUEUE.get(key) || Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  QUEUE.set(key, tail);
  tail.then(() => { if (QUEUE.get(key) === tail) QUEUE.delete(key); });
  return run;
}
export const _resetPinMemory = () => { GHOST.clear(); QUEUE.clear(); };

async function pinAttempt(env, alias, pin, now) {
  const chat = aliasMap(env)[alias], real = chat !== undefined;
  const rec = (real ? await kvJson(env, lockKey(alias), null) : GHOST.get(alias)) || { n: 0, lvl: 0, until: 0 };
  if (rec.until > now) return { status: 429, body: { ok: false, error: "locked", retry: Math.ceil((rec.until - now) / 1000) } };
  // stesso lavoro per alias veri e inventati: una lettura dal KV, un HMAC, un confronto a tempo costante
  const saved = await kvJson(env, pinKey(await chatHash(env.TELEGRAM_BOT_TOKEN, real ? chat : 0)), null);
  const good = await sameSecret(await pinHash(env.HMAC_SECRET, real ? chat : 0, pin), (real && saved && saved.h) || "nessun-pin");
  if (good) {
    if (rec.n || rec.lvl) await env.PREFS.delete(lockKey(alias));
    const name = nameOf(env, chat, { first_name: saved.n });
    return { status: 200, body: { ok: true, token: await personalToken(env, chat, name), name: name || "" } };
  }
  rec.n = (Number(rec.n) || 0) + 1;
  let locked = 0;
  if (rec.n >= PIN_MAX_FAILS) {
    locked = PIN_LOCKS[Math.min(Number(rec.lvl) || 0, PIN_LOCKS.length - 1)];
    rec.lvl = (Number(rec.lvl) || 0) + 1; rec.n = 0; rec.until = now + locked * 1000;
  }
  if (real) await env.PREFS.put(lockKey(alias), JSON.stringify(rec), { expirationTtl: locked + PIN_MEMORY });
  else { if (GHOST.size > 2000) GHOST.clear(); GHOST.set(alias, rec); }
  if (!locked) return { status: 401, body: { ok: false, error: "bad_pin", left: PIN_MAX_FAILS - rec.n } };
  return { status: 429, body: { ok: false, error: "locked", retry: locked }, notify: real ? chat : null, locked };
}
const lockTxt = (s) => (s >= 3600 ? (s === 3600 ? "un'ora" : `${Math.round(s / 3600)} ore`) : `${Math.round(s / 60)} minuti`);
async function apiPin(req, env, ctx) {
  let body = null;
  try { body = await req.json(); } catch (e) { /* corpo non JSON */ }
  if (!body || typeof body.alias !== "string" || typeof body.pin !== "string" || !ALIAS_RE.test(body.alias) || !PIN_RE.test(body.pin)) {
    return json(req, env, 400, { ok: false, error: "bad_request" });
  }
  const r = await serial(body.alias, () => pinAttempt(env, body.alias, body.pin, Date.now()));
  if (r.notify != null) {
    const p = new Telegram(env.TELEGRAM_BOT_TOKEN).send(r.notify, `🔒 <b>Troppi PIN sbagliati</b> sul tuo indirizzo del sito: l'accesso con il PIN è bloccato per ${lockTxt(r.locked)}.\n` +
      "I dispositivi già collegati continuano a funzionare. Se eri tu, per sbloccare subito imposta di nuovo il PIN con <code>/pin</code> seguito dalle tue 4 cifre. " +
      "Se non eri tu non devi fare nulla: senza PIN non si entra.", null)
      .catch((e) => console.log("avviso blocco PIN non inviato: " + String(e.message).slice(0, 80)));
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return json(req, env, r.status, r.body);
}
/** /pin: stato, /pin 1234 imposta, /pin off toglie. -> [testo, bottoni]. Il messaggio con il PIN lo cancella handleUpdate. */
async function cmdPin(env, chat, name, arg) {
  if (!env.HMAC_SECRET) return ["Il collegamento con il sito non è ancora configurato.", null];
  const alias = aliasOf(env, chat), a = String(arg || "").trim().toLowerCase();
  if (!alias) return ["Per questa chat non c'è ancora un indirizzo corto del sito. Intanto puoi entrare con il link di /sito.", null];
  const key = pinKey(await chatHash(env.TELEGRAM_BOT_TOKEN, chat)), url = aliasUrl(env, alias), open = [[["🔗 Apri il tuo indirizzo", "url:" + url]]];
  if (!a) {
    const has = !!((await kvJson(env, key, null)) || {}).h;
    return [`🔢 <b>Il tuo indirizzo del sito</b>\n${esc(url)}\nSi apre da qualsiasi dispositivo e chiede un PIN di 4 cifre: niente link da Telegram.\n\n` +
      (has ? "Il PIN è <b>impostato</b>. Per cambiarlo: <code>/pin 4827</code> (con le tue 4 cifre). Per disattivarlo: <code>/pin off</code>."
        : "Il PIN <b>non è ancora impostato</b>. Sceglilo così: <code>/pin 4827</code> (con le tue 4 cifre)."), has ? open : null];
  }
  if (["off", "no", "via", "togli"].includes(a)) {
    await env.PREFS.delete(key);
    return ["🔢 PIN disattivato: dal tuo indirizzo corto non si entra più finché non ne imposti uno nuovo. I dispositivi già collegati restano collegati (per scollegarli: <code>/sito nuovo</code>).", null];
  }
  if (!PIN_RE.test(a)) return ["Il PIN è di 4 cifre, per esempio <code>/pin 4827</code>. Per disattivarlo: <code>/pin off</code>.", null];
  if (weakPin(a)) return ["Questo PIN è troppo facile da indovinare (cifre uguali o in fila). Scegline un altro.", null];
  await env.PREFS.put(key, JSON.stringify({ h: await pinHash(env.HMAC_SECRET, chat, a), n: name || "", at: new Date().toISOString() }));
  await env.PREFS.delete(lockKey(alias)); // chi imposta il PIN dal bot e' il proprietario: via anche un eventuale blocco
  return [`🔢 <b>PIN salvato.</b> Da ora entri da ${esc(url)} con le tue 4 cifre, da qualsiasi dispositivo. Non dirlo a nessuno.`, open];
}

/** Bearer del sito -> {chat, name} oppure null (firma errata, link revocato, chat non piu' autorizzata). */
async function authUser(req, env) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "");
  const d = m && (await verifyToken(env.HMAC_SECRET, m[1]));
  if (!d || !allowedChats(env).includes(d.c)) return null;
  const auth = await kvJson(env, "auth", {});
  if ((Number(auth[String(d.c)]) || 1) !== d.v) return null;
  return { chat: d.c, name: nameOf(env, d.c, { first_name: d.n }) };
}

// ---------- API ----------
function cors(req, env) {
  const h = { Vary: "Origin" };
  if (req.headers.get("Origin") === conf(env, "ALLOWED_ORIGIN")) {
    h["Access-Control-Allow-Origin"] = conf(env, "ALLOWED_ORIGIN");
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
const json = (req, env, status, body) => new Response(JSON.stringify(body), {
  status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, cors(req, env)) });

function favPayload(bot, user) {
  const favs = Object.entries(bot.prefs.favorites).map(([id, f]) => {
    const t = bot.target(id), b = bot.best(id);
    return { id, name: t.name || id, country: t.country || "", by: f.by || null, at: f.at || f.added || null, p: f.p ?? null, thr: f.thr ?? null,
      cur: b ? { pp: b.price_pp, o: b.origin || null, dep: b.dep, ret: b.ret, n: b.nights ?? null, stops: b.stops ?? null, url: b.url || null } : null };
  });
  return { ok: true, me: user.name, threshold: bot.prefs.threshold, generated: bot.snap.generated || null, favs };
}

async function apiFavs(req, env, cfg) {
  const user = await authUser(req, env);
  if (!user) return json(req, env, 401, { ok: false, error: "unauthorized" });
  const [prefs, snap] = await Promise.all([loadPrefs(env, cfg), getSnapshot(env)]);
  return json(req, env, 200, favPayload(new Bot(cfg, snap, prefs), user));
}

async function apiFav(req, env, cfg, ctx) {
  const user = await authUser(req, env);
  if (!user) return json(req, env, 401, { ok: false, error: "unauthorized" });
  let body = null;
  try { body = await req.json(); } catch (e) { /* corpo non JSON */ }
  if (!body || typeof body.id !== "string" || typeof body.on !== "boolean") return json(req, env, 400, { ok: false, error: "bad_request" });
  const [prefs, snap] = await Promise.all([loadPrefs(env, cfg), getSnapshot(env)]);
  const ids = ID_RE.test(body.id) ? resolveTarget(body.id, snap) : [];
  if (ids.length !== 1 || !ID_RE.test(ids[0])) return json(req, env, 400, { ok: false, error: "bad_id" });
  const tid = ids[0], bot = new Bot(cfg, snap, prefs, { who: user.name, today: romeToday() });
  let changed = false;
  if (body.on && !(tid in prefs.favorites)) {
    if (Object.keys(prefs.favorites).length >= MAX_FAVS) return json(req, env, 400, { ok: false, error: "too_many" });
    bot.newFav(tid);
    changed = true;
  } else if (!body.on && tid in prefs.favorites) {
    delete prefs.favorites[tid];
    changed = true;
  }
  if (changed) await savePrefs(env, prefs);
  if (changed && body.on && body.quiet !== true) {
    const p = notifyAdded(env, bot, tid, user.name, null);
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return json(req, env, 200, Object.assign(favPayload(bot, user), { changed }));
}

// ---------- voti di coppia ----------
// Ogni profilo (chat autorizzata) vota per se': l'identita' viene dal token, mai dal corpo della richiesta.
// Al sito i profili arrivano come {k: chat_hash, name, me}: il chat_id non esce mai dal Worker.
async function people(env, user) {
  const names = chatNames(env), out = [];
  let i = 0;
  for (const chat of allowedChats(env)) {
    i++;
    const me = !!user && chat === user.chat;
    out.push({ k: await chatHash(env.TELEGRAM_BOT_TOKEN, chat), name: names[String(chat)] || (me && user.name) || "Profilo " + i, me });
  }
  return out;
}
const rateKey = (k) => "rates:" + k;
function cleanRates(o) {
  const out = {};
  for (const [id, v] of Object.entries(o || {})) {
    if (RATE_ID_RE.test(id) && Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && v[0] <= 5) out[id] = [v[0], String(v[1] || "")];
  }
  return out;
}
/** -> {people, by: {chat_hash: {id: [stelle, quando]}}} */
async function loadRates(env, user) {
  const ps = await people(env, user), by = {};
  await Promise.all(ps.map(async (p) => { by[p.k] = cleanRates(await kvJson(env, rateKey(p.k), {})); }));
  return { people: ps, by };
}
function ratesPayload(user, R) {
  const rates = {};
  for (const p of R.people) for (const [id, v] of Object.entries(R.by[p.k] || {})) (rates[id] = rates[id] || {})[p.k] = v[0];
  return { ok: true, me: user.name, people: R.people, rates };
}
async function apiRates(req, env) {
  const user = await authUser(req, env);
  if (!user) return json(req, env, 401, { ok: false, error: "unauthorized" });
  return json(req, env, 200, ratesPayload(user, await loadRates(env, user)));
}
async function apiRate(req, env) {
  const user = await authUser(req, env);
  if (!user) return json(req, env, 401, { ok: false, error: "unauthorized" });
  let body = null;
  try { body = await req.json(); } catch (e) { /* corpo non JSON */ }
  const sOk = body && (body.s === null || (Number.isInteger(body.s) && body.s >= 0 && body.s <= 5));
  if (!body || typeof body.id !== "string" || !sOk || !RATE_ID_RE.test(body.id)) return json(req, env, 400, { ok: false, error: "bad_request" });
  const id = body.id.slice(0, 2) + (body.id[0] === "d" ? body.id.slice(2).toUpperCase() : body.id.slice(2).toLowerCase());
  const R = await loadRates(env, user), meP = R.people.find((p) => p.me);
  if (!meP) return json(req, env, 401, { ok: false, error: "unauthorized" });
  const mine = R.by[meP.k];
  const had = id in mine ? mine[id][0] : null, changed = had !== body.s;
  if (changed) {
    if (body.s === null) delete mine[id];
    else {
      if (!(id in mine) && Object.keys(mine).length >= MAX_RATES) return json(req, env, 400, { ok: false, error: "too_many" });
      mine[id] = [body.s, new Date().toISOString()];
    }
    await env.PREFS.put(rateKey(meP.k), JSON.stringify(mine));
  }
  return json(req, env, 200, Object.assign(ratesPayload(user, R), { changed }));
}
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
/** Voli interni di un giro (targets[id].int dello snapshot: {n, pp, real: 2 tutti reali | 1 in parte | 0 stima, legs}).
 *  -> "✈ 2 voli interni ~320 € pp (stima): Lima → Cusco, La Paz → Uyuni A/R", oppure "" se il giro non ne ha. Come bot/common.py int_txt. */
export function intTxt(t) {
  const i = (t && t.int) || {}, n = i.n || 0;
  if (!n) return "";
  const real = i.real || 0, legs = Array.isArray(i.legs) ? i.legs.map(String) : [];
  return `✈ ${n} ${n === 1 ? "volo interno" : "voli interni"} ${real === 2 ? "" : "~"}${euro(i.pp || 0)} pp (${real === 2 ? "prezzo reale" : real === 1 ? "in parte stima" : "stima"})${legs.length ? ": " + esc(legs.join(", ")) : ""}`;
}
/** Costo di un giro dallo snapshot: voli pp migliori (al massimo 1 scalo, come sul sito) e totale pp = voli + interni + a terra. */
export function tripCost(snap, id) {
  let t = ((snap && snap.targets) || {})[id] || {};
  const fb = TRIP_COSTS[id];
  if (!(Array.isArray(t.land) && t.land.length === 2) && fb) t = Object.assign({}, t, { land: [fb[0], fb[1]], itot: fb[2], nights: t.nights || fb[3] });
  let fl = null;
  for (const o of (snap && snap.offers) || []) {
    if (o.target !== id) continue;
    const p = o.price_1stop != null ? o.price_1stop : o.price_pp;
    if (typeof p === "number" && (fl == null || p < fl.p)) fl = { p, o };
  }
  const land = Array.isArray(t.land) && t.land.length === 2 ? t.land : null, itot = t.itot || 0;
  const bits = [];
  if (fl) bits.push(`voli ${euro(fl.p)} pp${fl.o.origin ? ` da ${esc(fl.o.origin)}` : ""}${fl.o.kind === "openjaw" ? " (stima, 2 solo andata)" : ""}`);
  else bits.push("voli n.d.");
  if (land && fl) bits.push(`totale ${euro(fl.p + itot + land[0])}–${euro(fl.p + itot + land[1])} pp`);
  else if (land) bits.push(`a terra ${euro(land[0] + itot)}–${euro(land[1] + itot)} pp, senza voli`);
  if (t.nights) bits.push(`${t.nights} notti`);
  const it = intTxt(t);       // giro con voli interni: una riga in piu', con quanti sono, quanto costano e le tratte
  return { voli: fl ? fl.p : null, lo: land && fl ? fl.p + itot + land[0] : null, hi: land && fl ? fl.p + itot + land[1] : null, text: bits.join(" · ") + (it ? "\n   " + it : ""), int: it };
}
/** /voti: solo i giri completi (trip), in ordine di media, con voli e costo totale pp; dove manca un voto; link alla pagina del sito.
 *  I voti dati in passato alle mete singole (d_...) restano su KV ma qui, come sul sito, non si mostrano. */
async function cmdVoti(env, chat, name, snap) {
  const R = await loadRates(env, { chat, name }), tg = (snap && snap.targets) || {};
  const ids = [...new Set(R.people.flatMap((p) => Object.keys(R.by[p.k])))].filter((id) => id.startsWith("t_"));
  const site = conf(env, "SITE_URL").split("#")[0] + "#/voti";
  const btn = [[["⭐ Apri i voti sul sito", "url:" + site]]];
  if (!ids.length) return ["⭐ <b>I vostri voti</b>\nAncora nessun voto sui giri. Si vota dal sito, da 0 a 5 stelle, solo sui giri completi (Popular trips), con voli e costo totale a persona: aprilo con il link di /sito.", btn];
  const rows = ids.map((id) => {
    const vs = R.people.map((p) => (id in R.by[p.k] ? R.by[p.k][id][0] : null)), got = vs.filter((v) => v != null);
    return { id, vs, n: got.length, avg: got.reduce((a, b) => a + b, 0) / got.length, name: (tg[id] && tg[id].name) || id.slice(2), cost: tripCost(snap, id) };
  }).sort((a, b) => b.avg - a.avg || (a.cost.lo == null ? 1e9 : a.cost.lo) - (b.cost.lo == null ? 1e9 : b.cost.lo) || a.name.localeCompare(b.name, "it"));
  const line = (r, i) => `${i + 1}. <b>${esc(r.name)}</b> · ` + R.people.map((p, j) => `${esc(p.name)} ${r.vs[j] == null ? "–" : stars(r.vs[j])}`).join(" · ") +
    (r.n > 1 ? ` · media ${String(Math.round(r.avg * 10) / 10).replace(".", ",")}` : "") + `\n   ${r.cost.text}`;
  const full = (r) => r.n > 1 && r.n === R.people.length;
  const both = rows.filter(full), part = rows.filter((r) => !full(r));
  let text = "⭐ <b>I vostri voti</b> · solo giri completi";
  if (both.length) text += "\n\n<b>Votati da entrambi</b>\n" + both.slice(0, 15).map(line).join("\n") + (both.length > 15 ? `\n… e altri ${both.length - 15}` : "");
  if (part.length) text += "\n\n<b>Manca un voto</b>\n" + part.slice(0, 10).map(line).join("\n") + (part.length > 10 ? `\n… e altri ${part.length - 10}` : "");
  text += "\n\n<i>Totale a persona = voli + voli interni + a terra (stima). ✈ = giro con voli interni, già nel totale.</i>";
  return [text, btn];
}

async function apiPrefs(req, env, cfg) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "");
  const key = m ? m[1] : "";
  const ok = (await sameSecret(key, env.PREFS_SECRET)) || (env.TELEGRAM_BOT_TOKEN && (await sameSecret(key, await derivedPrefsKey(env.TELEGRAM_BOT_TOKEN))));
  if (!ok) return json(req, env, 401, { ok: false, error: "unauthorized" });
  return json(req, env, 200, await loadPrefs(env, cfg));
}

// ---------- webhook ----------
/** Elabora un update. -> "ok" | "ignored" (chat non autorizzata) | "skip" (niente da fare). */
export async function handleUpdate(u, env, cfg) {
  const cb = u && u.callback_query, msg = u && u.message;
  const chat = (((cb && cb.message) || msg || {}).chat || {}).id;
  if (chat == null) return "skip";
  if (!allowedChats(env).includes(chat)) return "ignored";
  const tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
  if (cb) {
    try { await tg.call("answerCallbackQuery", { callback_query_id: cb.id }); } catch (e) { /* pulsante vecchio: la risposta arriva come messaggio */ }
  }
  const who = nameOf(env, chat, (cb && cb.from) || (msg && msg.from));
  const c = cb ? null : Bot.parseCommand(msg.text);
  if (!cb && !c) return "skip";
  let res, bot = null, before = null;
  if (c && (c.cmd === "sito" || (c.cmd === "start" && /^sito\b/i.test(c.arg)))) {
    res = await cmdSito(env, chat, who, c.cmd === "sito" ? c.arg : c.arg.slice(4).trim());
  } else if (c && (c.cmd === "pin" || (c.cmd === "start" && /^pin\b/i.test(c.arg)))) {
    const arg = c.cmd === "pin" ? c.arg : c.arg.slice(3).trim();
    res = await cmdPin(env, chat, who, arg);
    if (/\d/.test(arg)) { // il messaggio contiene (o prova a contenere) un PIN: via dalla chat
      let gone = false;
      try { if (msg.message_id != null) { await tg.call("deleteMessage", { chat_id: chat, message_id: msg.message_id }); gone = true; } } catch (e) { /* resta in chat */ }
      res = [res[0] + (gone ? "\nHo cancellato il tuo messaggio, così il PIN non resta in chat." : "\nCancella dalla chat il messaggio con il PIN."), res[1]];
    }
  } else if (c && c.cmd === "voti") {
    res = await cmdVoti(env, chat, who, await getSnapshot(env));
  } else {
    const [prefs, snap] = await Promise.all([loadPrefs(env, cfg), getSnapshot(env)]);
    before = JSON.stringify(prefs);
    bot = new Bot(cfg, snap, prefs, { who, today: romeToday(), chatHash: await chatHash(env.TELEGRAM_BOT_TOKEN, chat) });
    res = cb ? bot.onCallback(cb.data) : bot.onText(msg.text);
    if (JSON.stringify(bot.prefs) !== before) await savePrefs(env, bot.prefs); // prima di rispondere: un invio fallito non perde la modifica
    // /voti vive solo nel Worker (i voti stanno su KV): la riga si aggiunge qui, cosi' bot.js resta allineato a commands.py
    if (res && c && (c.cmd === "help" || (c.cmd === "start" && !c.arg))) res = [res[0] + "\n/voti - i voti che avete dato ai giri completi, con voli e costo totale\n/pin - il tuo indirizzo corto del sito e il PIN di 4 cifre per entrarci", res[1]];
  }
  if (!res) return "skip";
  await tg.send(chat, res[0], res[1]);
  if (bot) for (const tid of bot.added) await notifyAdded(env, bot, tid, who, chat);
  return "ok";
}

async function webhook(req, env, cfg, ctx, pathSecret) {
  const okPath = await sameSecret(pathSecret, env.WEBHOOK_SECRET);
  const okHead = await sameSecret(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET);
  if (!okPath || !okHead) return new Response("forbidden", { status: 403 });
  let u = null;
  try { u = await req.json(); } catch (e) { return new Response("bad request", { status: 400 }); }
  const work = handleUpdate(u, env, cfg).then((r) => console.log("update: " + r), (e) => console.log("errore su un update: " + String(e && e.message).slice(0, 120)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return new Response("ok"); // sempre 200: Telegram non deve riproporre l'update
}

// ---------------------------------------------------------------- avvio puntuale della scansione giornaliera
// Il cron di GitHub parte con ore di ritardo: il Worker lancia scan.yml all'ora giusta (workflow_dispatch) e piu' tardi
// controlla che il giro ci sia stato. Serve il secret GH_TOKEN: token fine-grained limitato al repo, permesso Actions R/W.
const GH_REPO = "cosimoney/agosto2027";
async function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${GH_REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agosto2027-worker", ...(init.headers || {}) },
  });
}
async function scanRunsToday(env) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await gh(env, `/actions/workflows/scan.yml/runs?created=>=${day}T00:00:00Z&per_page=20`);
  if (!r.ok) throw new Error("GitHub runs " + r.status);
  return ((await r.json()).workflow_runs || []);
}
async function adminMsg(env, text) {
  const chat = String(env.TELEGRAM_ADMIN_CHAT || env.TEST_CHAT_ID || "").trim() || String(env.TELEGRAM_CHAT_IDS || "").split(/[\s,;]+/)[0];
  if (!chat || !env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
}
export async function onCron(cron, env) {
  if (!env.GH_TOKEN) { console.log("cron: GH_TOKEN mancante"); return "no_token"; }
  const runs = await scanRunsToday(env);
  const live = runs.filter((x) => x.status !== "completed");
  const good = runs.filter((x) => x.conclusion === "success");
  if (cron === "23 5 * * *") {                       // avvio
    if (live.length || good.length) return "gia' partita";
    const r = await gh(env, "/actions/workflows/scan.yml/dispatches", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", inputs: { send_alerts: "true" } }) });
    if (r.status !== 204) { await adminMsg(env, "Cron Worker: avvio della scansione fallito (GitHub " + r.status + ")."); return "dispatch " + r.status; }
    return "avviata";
  }
  // controllo di meta' giornata: se non c'e' un giro riuscito ne' in corso, si rilancia una volta e si avvisa
  if (good.length || live.length) return "ok";
  const r = await gh(env, "/actions/workflows/scan.yml/dispatches", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", inputs: { send_alerts: "true" } }) });
  await adminMsg(env, "Cron Worker: oggi nessuna scansione riuscita (" + runs.length + " tentativi). Rilanciata: GitHub " + r.status + ".");
  return "rilanciata " + r.status;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(onCron(event.cron, env).then((r) => console.log("cron " + event.cron + ": " + r),
      (e) => console.log("cron errore: " + String(e && e.message).slice(0, 120))));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
    const cfg = loadConfig(CONFIG, { SITE_URL: conf(env, "SITE_URL") });
    try {
      if (path.startsWith("/api/")) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
        if (!env.PREFS || !env.HMAC_SECRET || !env.TELEGRAM_BOT_TOKEN) return json(req, env, 503, { ok: false, error: "not_configured" });
        if (path === "/api/favs" && req.method === "GET") return await apiFavs(req, env, cfg);
        if (path === "/api/fav" && req.method === "POST") return await apiFav(req, env, cfg, ctx);
        if (path === "/api/rates" && req.method === "GET") return await apiRates(req, env);
        if (path === "/api/rate" && req.method === "POST") return await apiRate(req, env);
        if (path === "/api/pin" && req.method === "POST") return await apiPin(req, env, ctx);
        if (path === "/api/prefs" && req.method === "GET") return await apiPrefs(req, env, cfg);
        return json(req, env, 404, { ok: false, error: "not_found" });
      }
      if (path.startsWith("/tg/") && req.method === "POST") {
        if (!env.PREFS || !env.WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return new Response("not configured", { status: 503 });
        return await webhook(req, env, cfg, ctx, path.slice(4));
      }
      if (path === "/") return new Response("agosto2027: ok\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.log("errore: " + String(e && e.message).slice(0, 120));
      return path.startsWith("/api/") ? json(req, env, 500, { ok: false, error: "server_error" }) : new Response("error", { status: 500 });
    }
  },
};
