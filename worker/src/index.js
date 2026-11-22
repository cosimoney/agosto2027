// Worker Cloudflare del bot voli agosto 2027: preferiti condivisi (KV), API per il sito e webhook Telegram.
//
//   POST /api/fav     {id, on}      aggiunge o toglie un preferito            (Bearer: token personale da /sito)
//   GET  /api/favs                  elenco dei preferiti con chi e quando     (Bearer: token personale)
//   GET  /api/prefs                 preferenze complete per bot/alerts.py     (Bearer: PREFS_SECRET)
//   POST /tg/<WEBHOOK_SECRET>       webhook Telegram (controlla anche l'header X-Telegram-Bot-Api-Secret-Token)
//
// Stato su KV (binding PREFS): "prefs" = stessa struttura di bot/state/prefs.json, "auth" = versione dei link per chat.
// Secret: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, HMAC_SECRET, PREFS_SECRET, WEBHOOK_SECRET; facoltativo CHAT_NAMES ("id:Nome,id:Nome").
// Nei log non finiscono mai chat_id, nomi, token o testi dei messaggi.
import CONFIG from "../../bot/config.json" with { type: "json" };
import { Bot, ID_RE, loadConfig, normPrefs, resolveTarget, splitMessage, romeToday } from "./bot.js";

const DEFAULTS = {
  ALLOWED_ORIGIN: "https://cosimoney.github.io",
  SITE_URL: "https://cosimoney.github.io/agosto2027/",
  SNAPSHOT_BASE: "https://raw.githubusercontent.com/cosimoney/agosto2027/data/bot/",
};
const SNAP_TTL_MS = 5 * 60 * 1000;
const MAX_FAVS = 200;
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
  } else {
    const [prefs, snap] = await Promise.all([loadPrefs(env, cfg), getSnapshot(env)]);
    before = JSON.stringify(prefs);
    bot = new Bot(cfg, snap, prefs, { who, today: romeToday(), chatHash: await chatHash(env.TELEGRAM_BOT_TOKEN, chat) });
    res = cb ? bot.onCallback(cb.data) : bot.onText(msg.text);
    if (JSON.stringify(bot.prefs) !== before) await savePrefs(env, bot.prefs); // prima di rispondere: un invio fallito non perde la modifica
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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/";
    const cfg = loadConfig(CONFIG, { SITE_URL: conf(env, "SITE_URL") });
    try {
      if (path.startsWith("/api/")) {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
        if (!env.PREFS || !env.HMAC_SECRET || !env.TELEGRAM_BOT_TOKEN) return json(req, env, 503, { ok: false, error: "not_configured" });
        if (path === "/api/favs" && req.method === "GET") return await apiFavs(req, env, cfg);
        if (path === "/api/fav" && req.method === "POST") return await apiFav(req, env, cfg, ctx);
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
