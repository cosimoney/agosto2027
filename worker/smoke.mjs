// Prove dal vivo dopo il deploy (le lancia deploy.sh). Variabili: WORKER_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS,
// PREFS_SECRET, WEBHOOK_SECRET; facoltative HMAC_SECRET (per il fav on/off con un token firmato qui) e TEST_CHAT_ID
// (default: la prima chat di TELEGRAM_CHAT_IDS). Manda UN solo messaggio vero: la risposta a un /help finto, a TEST_CHAT_ID.
// Il preferito di prova (d_ZZZ, inesistente) viene aggiunto con quiet:true, quindi senza messaggi, e subito tolto.
import { signToken, derivedPrefsKey } from "./src/index.js";

const env = process.env, U = String(env.WORKER_URL || "").replace(/\/+$/, "");
const chats = String(env.TELEGRAM_CHAT_IDS || "").split(/[\s,;]+/).filter(Boolean).map(Number);
const chat = Number(env.TEST_CHAT_ID || chats[0]);
const ORIGIN = "https://cosimoney.github.io";
let fails = 0;
const ok = (c, msg, extra = "") => { console.log(`  [${c ? "ok" : "FALLITO"}] ${msg}${c ? "" : " " + extra}`); if (!c) fails++; };
const get = (path, headers = {}) => fetch(U + path, { headers });
const post = (path, body, headers = {}) => fetch(U + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });

if (!U || !chats.includes(chat)) { console.error("servono WORKER_URL e una TEST_CHAT_ID tra le chat autorizzate"); process.exit(2); }

let r = await get("/");
ok(r.status === 200, "il Worker risponde");
r = await get("/api/favs", { Origin: ORIGIN });
ok(r.status === 401 && r.headers.get("access-control-allow-origin") === ORIGIN, "senza token: 401, CORS per il sito", String(r.status));
r = await get("/api/favs", { Origin: "https://example.org" });
ok(!r.headers.get("access-control-allow-origin"), "nessun CORS per altri siti");
r = await get("/api/prefs");
ok(r.status === 401, "/api/prefs chiuso senza secret", String(r.status));
for (const [name, key] of [["PREFS_SECRET", env.PREFS_SECRET], ["chiave derivata dal token del bot", env.TELEGRAM_BOT_TOKEN && (await derivedPrefsKey(env.TELEGRAM_BOT_TOKEN))]]) {
  if (!key) continue;
  r = await get("/api/prefs", { Authorization: "Bearer " + key });
  const p = r.status === 200 ? await r.json() : null;
  ok(p && typeof p.favorites === "object" && typeof p.threshold === "number", `/api/prefs con ${name}`, String(r.status));
}

if (env.HMAC_SECRET) {
  const auth = { Authorization: "Bearer " + (await signToken(env.HMAC_SECRET, { c: chat, v: 1, n: "" })), Origin: ORIGIN };
  r = await post("/api/fav", { id: "d_ZZZ", on: true, quiet: true }, auth);
  let j = r.status === 200 ? await r.json() : {};
  ok(r.status === 200 && j.changed === true && (j.favs || []).some((f) => f.id === "d_ZZZ"), "fav on via API con token personale", String(r.status));
  r = await get("/api/favs", auth);
  j = r.status === 200 ? await r.json() : {};
  ok((j.favs || []).some((f) => f.id === "d_ZZZ" && f.at), "il preferito si rilegge da /api/favs (KV)", String(r.status));
  r = await post("/api/fav", { id: "d_ZZZ", on: false }, auth);
  j = r.status === 200 ? await r.json() : {};
  ok(r.status === 200 && !(j.favs || []).some((f) => f.id === "d_ZZZ"), "fav off via API", String(r.status));
} else {
  console.log("  [--] fav on/off via API saltato: HMAC_SECRET era gia' impostato e non e' leggibile (prova dal sito dopo /sito)");
}

if (env.WEBHOOK_SECRET) {
  const hook = (secret, update) => post("/tg/" + env.WEBHOOK_SECRET, update, { "X-Telegram-Bot-Api-Secret-Token": secret });
  r = await hook("sbagliato", { update_id: 1 });
  ok(r.status === 403, "webhook: header segreto errato rifiutato", String(r.status));
  r = await hook(env.WEBHOOK_SECRET, { update_id: 1, message: { chat: { id: 1 }, text: "/help" } });
  ok(r.status === 200, "webhook: chat non autorizzata ignorata (200, nessun messaggio)", String(r.status));
  r = await hook(env.WEBHOOK_SECRET, { update_id: 2, message: { chat: { id: chat }, from: { first_name: "Test" }, text: "/help" } });
  ok(r.status === 200, "webhook: /help finto accettato (arriva un messaggio vero alla chat di prova)", String(r.status));
}

if (env.TELEGRAM_BOT_TOKEN) {
  await new Promise((res) => setTimeout(res, 3000));
  const j = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`)).json();
  const i = j.result || {};
  ok(j.ok && String(i.url || "").startsWith(U + "/tg/"), "getWebhookInfo: il webhook punta al Worker");
  ok(!i.last_error_message, "getWebhookInfo: nessun errore", String(i.last_error_message || ""));
  console.log(`  update in coda: ${i.pending_update_count || 0}`);
}
console.log(fails ? `${fails} prove fallite` : "prove dal vivo: tutte ok");
process.exit(fails ? 1 : 0);
