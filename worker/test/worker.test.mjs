// Test del Worker senza rete: KV finto, fetch finto (Telegram e snapshot), update Telegram finti.  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import worker, { signToken, verifyToken, chatHash, derivedPrefsKey, _resetSnapshotCache } from "../src/index.js";

const ME = 111111111, LAVI = 9222222222, STRANGER = 999999999;
const ORIGIN = "https://cosimoney.github.io";
const offer = (target, origin, dep, ret, price, extra = {}) => Object.assign({ id: `${target}:${origin}:${dep}:${ret}`, target, origin, dep, ret, nights: 11,
  price_pp: price, stops: 0, airlines: ["Test Air"], source: target[0] === "w" ? "weekend" : target[0] === "t" ? "popular" : "agosto2027",
  code: target.slice(2), name: { d_TBS: "Tbilisi", d_EVN: "Erevan", "t_georgia-armenia": "Georgia e Armenia" }[target], country: "Georgia",
  url: "https://www.google.com/travel/flights?q=x" }, extra);
const SNAPSHOT = {
  generated: "2026-11-22T06:00:00Z", sources: {},
  targets: {
    d_TBS: { name: "Tbilisi", country: "Georgia", code: "TBS", source: "agosto2027", tab: "new", clima: "buono", n: 2, min: 190 },
    d_EVN: { name: "Erevan", country: "Armenia", code: "EVN", source: "agosto2027", tab: "new", clima: "buono", n: 1, min: 230 },
    d_AKL: { name: "Auckland", country: "Nuova Zelanda", code: "AKL", source: "agosto2027", tab: "new", clima: "accettabile", n: 0, min: null },
    "t_georgia-armenia": { name: "Georgia e Armenia", country: "Georgia", code: "TBS", source: "popular", n: 1, min: 410 },
  },
  offers: [offer("d_TBS", "MXP", "2027-08-11", "2027-08-22", 190), offer("d_TBS", "FCO", "2027-08-10", "2027-08-21", 240),
    offer("d_EVN", "FCO", "2027-08-10", "2027-08-20", 230), offer("t_georgia-armenia", "MXP", "2027-08-07", "2027-08-18", 410)],
};

function setup(extraEnv = {}) {
  _resetSnapshotCache();
  const kv = new Map(), sent = [], calls = [];
  const env = Object.assign({
    PREFS: { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } },
    TELEGRAM_BOT_TOKEN: "000000:TEST", TELEGRAM_CHAT_IDS: `${ME},${LAVI}`, CHAT_NAMES: `${ME}:Cosimo,${LAVI}:Lavi`,
    HMAC_SECRET: "hmac-test-secret", PREFS_SECRET: "prefs-test-secret", WEBHOOK_SECRET: "hook-test-secret",
  }, extraEnv);
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith("https://api.telegram.org/")) {
      const method = url.split("/").pop(), body = JSON.parse(init.body);
      calls.push([method, body]);
      if (method === "sendMessage") sent.push(body);
      return new Response(JSON.stringify({ ok: true, result: true }));
    }
    if (url.endsWith("snapshot_lite.json")) return new Response("not found", { status: 404 });
    if (url.endsWith("snapshot.json")) return new Response(JSON.stringify(SNAPSHOT));
    throw new Error("fetch inattesa: " + url);
  };
  const call = (path, init = {}) => worker.fetch(new Request("https://w.test" + path, init), env, null);
  const api = (path, token, init = {}) => call(path, Object.assign({}, init, { headers: Object.assign({ Authorization: "Bearer " + token, Origin: ORIGIN,
    "Content-Type": "application/json" }, init.headers || {}) }));
  const hook = (update, secret = env.WEBHOOK_SECRET, pathSecret = env.WEBHOOK_SECRET) => call("/tg/" + pathSecret, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update) });
  const text = (chat, t, name = "Tg") => hook({ update_id: 1, message: { chat: { id: chat }, from: { first_name: name }, text: t } });
  const press = (chat, data) => hook({ update_id: 2, callback_query: { id: "cb1", data, from: { first_name: "Tg" }, message: { chat: { id: chat } } } });
  const prefs = () => JSON.parse(kv.get("prefs") || "{}");
  return { env, kv, sent, calls, call, api, hook, text, press, prefs, token: (chat, v = 1, n = "") => signToken(env.HMAC_SECRET, { c: chat, v, n }) };
}

test("token: firma, verifica, manomissione", async () => {
  const t = await signToken("s1", { c: ME, v: 1, n: "Cosimo" });
  assert.deepEqual(await verifyToken("s1", t), { c: ME, v: 1, n: "Cosimo" });
  assert.equal(await verifyToken("s2", t), null, "secret diverso");
  const [p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ c: LAVI, v: 1, n: "x" })).toString("base64url");
  assert.equal(await verifyToken("s1", forged + "." + s), null, "payload cambiato");
  assert.equal(await verifyToken("s1", p + "." + s.slice(0, -2) + "AA"), null, "firma cambiata");
  for (const bad of ["", "abc", "a.b.c", null, p, p + ".", "." + s, "x".repeat(700) + ".y"]) assert.equal(await verifyToken("s1", bad), null);
  assert.deepEqual((await verifyToken("s1", await signToken("s1", { c: LAVI, v: 3, n: "" }))).c, LAVI, "chat_id oltre 2^32");
});

test("chat_hash e chiave derivata uguali a quelle di Python", async () => {
  // python: hmac.new(b"000000:SELFTEST", b"111111111", "sha256").hexdigest()[:16]  /  hmac.new(token, b"agosto2027-prefs-v1", "sha256").hexdigest()
  assert.equal(await chatHash("000000:SELFTEST", 111111111), "7757690fede5ff1b");
  assert.equal(await derivedPrefsKey("000000:SELFTEST"), "069aa3ea3b8d8c6afa0b4bea781d62cc0bb1737fcf5dd6571f57d6f98de85afc");
});

test("API: senza token, token errato, chat non autorizzata", async () => {
  const s = setup();
  assert.equal((await s.call("/api/favs")).status, 401);
  assert.equal((await s.api("/api/favs", "non.valido")).status, 401);
  assert.equal((await s.api("/api/favs", await s.token(STRANGER))).status, 401, "chat fuori da TELEGRAM_CHAT_IDS");
  assert.equal((await s.api("/api/favs", await signToken("altro-secret", { c: ME, v: 1, n: "" }))).status, 401);
  assert.equal((await s.api("/api/fav", "non.valido", { method: "POST", body: JSON.stringify({ id: "d_TBS", on: true }) })).status, 401);
  assert.equal(s.kv.size, 0);
  assert.equal(s.sent.length, 0);
});

test("API: fav on/off, conferma Telegram, prezzo all'aggiunta", async () => {
  const s = setup(), tok = await s.token(ME);
  let r = await s.api("/api/favs", tok);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).favs, []);
  r = await s.api("/api/fav", tok, { method: "POST", body: JSON.stringify({ id: "d_TBS", on: true }) });
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.changed, true);
  assert.equal(j.me, "Cosimo");
  assert.equal(j.favs.length, 1);
  assert.deepEqual({ id: j.favs[0].id, name: j.favs[0].name, by: j.favs[0].by, p: j.favs[0].p, cur: j.favs[0].cur.pp, o: j.favs[0].cur.o },
    { id: "d_TBS", name: "Tbilisi", by: "Cosimo", p: 190, cur: 190, o: "MXP" });
  assert.match(j.favs[0].at, /^\d{4}-\d\d-\d\dT/);
  const f = s.prefs().favorites.d_TBS;
  assert.equal(f.p, 190, "riferimento per la regola dei cali");
  assert.match(f.added, /^\d{4}-\d\d-\d\d$/);
  assert.equal(s.prefs().threshold, 1000, "struttura di prefs.json");
  assert.deepEqual(s.sent.map((m) => m.chat_id).sort(), [ME, LAVI].sort(), "conferma a entrambe le chat");
  assert.match(s.sent[0].text, /^⭐ Aggiunto da Cosimo: <a href="https:\/\/cosimoney\.github\.io\/agosto2027\/#\/d\/TBS"><b>Tbilisi<\/b><\/a>, oggi <b>190 € pp<\/b> da Milano MXP$/);
  // di nuovo on: niente doppioni, niente secondo messaggio
  r = await s.api("/api/fav", tok, { method: "POST", body: JSON.stringify({ id: "d_tbs", on: true }) });
  j = await r.json();
  assert.equal(j.changed, false);
  assert.equal(j.favs.length, 1);
  assert.equal(s.sent.length, 2);
  // l'altra persona la vede e la toglie
  const tokL = await s.token(LAVI);
  j = await (await s.api("/api/favs", tokL)).json();
  assert.equal(j.me, "Lavi");
  assert.equal(j.favs[0].by, "Cosimo");
  j = await (await s.api("/api/fav", tokL, { method: "POST", body: JSON.stringify({ id: "d_TBS", on: false }) })).json();
  assert.equal(j.changed, true);
  assert.deepEqual(j.favs, []);
  assert.deepEqual(s.prefs().favorites, {});
  assert.equal(s.sent.length, 2, "la rimozione non manda messaggi");
  // quiet: nessun messaggio (usato dai test dopo il deploy); meta senza voli; id sconosciuto ma ben formato
  j = await (await s.api("/api/fav", tok, { method: "POST", body: JSON.stringify({ id: "d_AKL", on: true, quiet: true }) })).json();
  assert.equal(j.favs[0].cur, null);
  assert.equal(j.favs[0].p, null);
  assert.equal(s.sent.length, 2);
  j = await (await s.api("/api/fav", tok, { method: "POST", body: JSON.stringify({ id: "t_georgia-armenia", on: true, quiet: true }) })).json();
  assert.equal(j.favs.find((x) => x.id === "t_georgia-armenia").p, 410);
});

test("API: richieste malformate", async () => {
  const s = setup(), tok = await s.token(ME);
  for (const body of ["{", JSON.stringify({ id: "d_TBS" }), JSON.stringify({ id: 5, on: true }), JSON.stringify({ id: "x_TBS", on: true }),
    JSON.stringify({ id: "Tbilisi", on: true }), JSON.stringify({ id: "d_<script>", on: true })]) {
    assert.equal((await s.api("/api/fav", tok, { method: "POST", body })).status, 400, body);
  }
  assert.equal((await s.api("/api/boh", tok)).status, 404);
  assert.equal((await s.call("/boh")).status, 404);
  assert.equal(s.kv.size, 0);
});

test("CORS solo per il sito", async () => {
  const s = setup(), tok = await s.token(ME);
  let r = await s.api("/api/favs", tok);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  r = await s.api("/api/favs", tok, { headers: { Origin: "https://evil.example" } });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  r = await s.call("/api/fav", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  r = await s.call("/api/fav", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  r = await s.call("/api/favs", { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN, "anche gli errori devono essere leggibili dal sito");
});

test("/api/prefs: solo con il secret (o la chiave derivata dal token del bot)", async () => {
  const s = setup();
  await s.api("/api/fav", await s.token(ME), { method: "POST", body: JSON.stringify({ id: "d_TBS", on: true, quiet: true }) });
  assert.equal((await s.call("/api/prefs")).status, 401);
  assert.equal((await s.api("/api/prefs", "sbagliato")).status, 401);
  assert.equal((await s.api("/api/prefs", await s.token(ME))).status, 401, "il token del sito non basta");
  for (const key of ["prefs-test-secret", await derivedPrefsKey("000000:TEST")]) {
    const r = await s.api("/api/prefs", key);
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.deepEqual(Object.keys(p).sort(), ["favorites", "muted", "paused", "threshold"]);
    assert.equal(p.favorites.d_TBS.p, 190);
  }
});

test("webhook: secret, chat non autorizzata", async () => {
  const s = setup();
  assert.equal((await s.hook({ message: { chat: { id: ME }, text: "/help" } }, "sbagliato")).status, 403);
  assert.equal((await s.hook({ message: { chat: { id: ME }, text: "/help" } }, s.env.WEBHOOK_SECRET, "percorso-sbagliato")).status, 403);
  assert.equal((await s.call("/tg/hook-test-secret", { method: "POST", body: "{}" })).status, 403, "senza header");
  assert.equal(s.calls.length, 0);
  let r = await s.text(STRANGER, "/start");
  assert.equal(r.status, 200);
  r = await s.text(STRANGER, "/aggiungi TBS");
  r = await s.press(STRANGER, "add:d_TBS");
  assert.equal(s.calls.length, 0, "nessuna chiamata a Telegram per chi non e' autorizzato");
  assert.equal(s.kv.size, 0);
  assert.equal((await s.hook({ update_id: 5 })).status, 200);
  assert.equal((await s.text(ME, "ciao")).status, 200);
  assert.equal(s.calls.length, 0, "testo libero: nessuna risposta");
});

test("webhook: /help, /top, /meta", async () => {
  const s = setup();
  assert.equal((await s.text(ME, "/help")).status, 200);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].chat_id, ME);
  assert.match(s.sent[0].text, /^<b>Comandi<\/b>\n\/top/);
  assert.match(s.sent[0].text, /\/sito - /);
  assert.equal(s.sent[0].parse_mode, "HTML");
  await s.text(ME, "/top");
  assert.match(s.sent[1].text, /Le migliori sotto 1\.000 € a persona/);
  assert.match(s.sent[1].text, /1\. <a href="[^"]+#\/d\/TBS"><b>Tbilisi<\/b><\/a> \(Georgia\): <b>190 € pp<\/b> · coppia 380 €\n   mer 11 → dom 22 ago · 11 notti · da Milano MXP · diretto/);
  assert.deepEqual(s.sent[1].reply_markup.inline_keyboard[0][0], { text: "⭐ Tbilisi", callback_data: "add:d_TBS" });
  await s.text(ME, "/meta tbs");
  assert.match(s.sent[2].text, /Altre date:\n• mar 10 → sab 21 ago · 11 notti · da Roma FCO: <b>240 € pp<\/b>/);
  assert.match(s.sent[2].text, /2 combinazioni, 2 sotto 1\.000 € pp\./);
  assert.equal(s.kv.has("prefs"), false, "i comandi di sola lettura non scrivono");
});

test("webhook: preferiti da comando, deep link e pulsanti; conferma all'altra chat", async () => {
  const s = setup();
  await s.text(ME, "/aggiungi TBS");
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[0].chat_id, ME);
  assert.match(s.sent[0].text, /^⭐ Aggiunto ai preferiti: .*Tbilisi.*\.\n.*190 € pp.*\nTi avviso quando il miglior prezzo scende di almeno 50 € a persona rispetto a oggi/s);
  assert.equal(s.sent[1].chat_id, LAVI);
  assert.match(s.sent[1].text, /^⭐ Aggiunto da Cosimo: .*Tbilisi.*, oggi <b>190 € pp<\/b> da Milano MXP$/);
  assert.deepEqual({ p: s.prefs().favorites.d_TBS.p, by: s.prefs().favorites.d_TBS.by }, { p: 190, by: "Cosimo" });
  await s.text(LAVI, "/start fav_d_EVN");
  assert.equal(s.prefs().favorites.d_EVN.by, "Lavi");
  assert.equal(s.sent[3].chat_id, ME);
  assert.match(s.sent[3].text, /^⭐ Aggiunto da Lavi: .*Erevan/);
  await s.text(ME, "/aggiungi TBS");
  assert.match(s.sent[4].text, /è già tra i preferiti/);
  assert.equal(s.sent.length, 5, "gia' presente: nessuna conferma all'altra chat");
  await s.press(LAVI, "rm:d_TBS");
  assert.equal(s.calls.filter((c) => c[0] === "answerCallbackQuery").length, 1);
  assert.match(s.sent[5].text, /^Tolto dai preferiti/);
  assert.deepEqual(Object.keys(s.prefs().favorites), ["d_EVN"]);
  await s.press(ME, "thr:d_EVN:200");
  assert.equal(s.prefs().favorites.d_EVN.thr, 200);
  await s.text(ME, "/soglia 900");
  assert.equal(s.prefs().threshold, 900);
  await s.text(ME, "/silenzia EVN 3");
  assert.match(s.prefs().muted.d_EVN, /^\d{4}-\d\d-\d\d$/);
  await s.text(ME, "/digest settimanale");
  assert.equal(s.prefs().digest, "settimana");
  // /pausa salva l'hash della chat (come commands.py) e chi e' in pausa non riceve le conferme degli altri
  await s.text(LAVI, "/pausa");
  assert.deepEqual(s.prefs().paused, [await chatHash("000000:TEST", LAVI)]);
  const n = s.sent.length;
  await s.text(ME, "/aggiungi t_georgia-armenia");
  assert.equal(s.sent.length, n + 1, "Lavi in pausa: niente conferma");
  await s.text(LAVI, "/riprendi");
  assert.deepEqual(s.prefs().paused, []);
  await s.press(ME, "boh");
  assert.match(s.sent.at(-1).text, /Pulsante non più valido/);
});

test("/sito: link personale, valido per l'API, revocabile", async () => {
  const s = setup();
  await s.text(ME, "/sito");
  assert.equal(s.sent.length, 1);
  const url = s.sent[0].reply_markup.inline_keyboard[0][0].url;
  assert.match(url, /^https:\/\/cosimoney\.github\.io\/agosto2027\/#\/login\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const tok = url.split("#/login/")[1];
  assert.equal((await verifyToken(s.env.HMAC_SECRET, tok)).c, ME);
  assert.equal((await s.api("/api/favs", tok)).status, 200);
  await s.text(ME, "/sito");
  assert.equal(s.sent[1].reply_markup.inline_keyboard[0][0].url, url, "stesso link su piu' dispositivi");
  await s.text(LAVI, "/start sito", "Lavinia");
  const tokL = s.sent[2].reply_markup.inline_keyboard[0][0].url.split("#/login/")[1];
  assert.equal((await (await s.api("/api/favs", tokL)).json()).me, "Lavi");
  await s.text(ME, "/sito nuovo");
  const tok2 = s.sent[3].reply_markup.inline_keyboard[0][0].url.split("#/login/")[1];
  assert.notEqual(tok2, tok);
  assert.equal((await s.api("/api/favs", tok)).status, 401, "il vecchio link non vale piu'");
  assert.equal((await s.api("/api/favs", tok2)).status, 200);
  assert.equal((await s.api("/api/favs", tokL)).status, 200, "la revoca riguarda solo chi l'ha chiesta");
  // senza CHAT_NAMES vale il nome Telegram di chi ha chiesto il link
  const s2 = setup({ CHAT_NAMES: "" });
  await s2.text(ME, "/sito", "Mimmo");
  const t3 = s2.sent[0].reply_markup.inline_keyboard[0][0].url.split("#/login/")[1];
  assert.equal((await (await s2.api("/api/favs", t3)).json()).me, "Mimmo");
});

test("non configurato: 503, mai un errore non gestito", async () => {
  const s = setup({ HMAC_SECRET: "", WEBHOOK_SECRET: "" });
  assert.equal((await s.call("/api/favs")).status, 503);
  assert.equal((await s.call("/tg/x", { method: "POST", body: "{}" })).status, 503);
  assert.equal((await s.call("/")).status, 200);
});
