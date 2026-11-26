// Test del Worker senza rete: KV finto, fetch finto (Telegram e snapshot), update Telegram finti.  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import worker, { signToken, verifyToken, chatHash, derivedPrefsKey, pinHash, aliasMap, tripCost, intTxt, _resetSnapshotCache, _resetPinMemory } from "../src/index.js";

const ME = 111111111, LAVI = 9222222222, STRANGER = 999999999;
const ORIGIN = "https://cosimoney.github.io";
const offer = (target, origin, dep, ret, price, extra = {}) => Object.assign({ id: `${target}:${origin}:${dep}:${ret}`, target, origin, dep, ret, nights: 11,
  price_pp: price, stops: 0, airlines: ["Test Air"], source: target[0] === "w" ? "weekend" : target[0] === "t" ? "popular" : "agosto2027",
  code: target.slice(2), name: { d_TBS: "Tbilisi", d_EVN: "Erevan", "t_georgia-armenia": "Georgia e Armenia", "t_peru": "Perù classico", "t_islanda": "Islanda" }[target], country: "Georgia",
  url: "https://www.google.com/travel/flights?q=x" }, extra);
const SNAPSHOT = {
  generated: "2026-11-22T06:00:00Z", sources: {},
  targets: {
    d_TBS: { name: "Tbilisi", country: "Georgia", code: "TBS", source: "agosto2027", tab: "new", clima: "buono", n: 2, min: 190 },
    d_EVN: { name: "Erevan", country: "Armenia", code: "EVN", source: "agosto2027", tab: "new", clima: "buono", n: 1, min: 230 },
    d_AKL: { name: "Auckland", country: "Nuova Zelanda", code: "AKL", source: "agosto2027", tab: "new", clima: "accettabile", n: 0, min: null },
    "t_georgia-armenia": { name: "Georgia e Armenia", country: "Georgia", code: "TBS", source: "popular", n: 1, min: 410, land: [1100, 1600], itot: 0, nights: 10 },
    t_peru: { name: "Perù classico", country: "Perù", code: "LIM", source: "popular", n: 2, min: 1450, land: [1500, 2100], itot: 180, nights: 11,
      int: { n: 3, pp: 180, real: 1, legs: ["Lima → Cusco", "La Paz → Uyuni A/R"] } },
    t_islanda: { name: "Islanda", country: "Islanda", code: "KEF", source: "popular", n: 0, min: null, land: [2000, 2600], itot: 0, nights: 9 },
    "t_vecchio": { name: "Giro di uno snapshot vecchio", country: "X", code: "XXX", source: "popular", n: 1, min: 300 },
  },
  offers: [offer("d_TBS", "MXP", "2027-08-11", "2027-08-22", 190), offer("d_TBS", "FCO", "2027-08-10", "2027-08-21", 240),
    offer("d_EVN", "FCO", "2027-08-10", "2027-08-20", 230), offer("t_georgia-armenia", "MXP", "2027-08-07", "2027-08-18", 410),
    offer("t_peru", "FCO", "2027-08-06", "2027-08-17", 1500, { kind: "openjaw" }), offer("t_peru", "MXP", "2027-08-06", "2027-08-17", 1390, { kind: "openjaw", stops: 2, price_1stop: 1450 }),
    offer("t_vecchio", "MXP", "2027-08-07", "2027-08-18", 300)],
};

function setup(extraEnv = {}) {
  _resetSnapshotCache();
  _resetPinMemory();
  const kv = new Map(), ttl = new Map(), sent = [], calls = [];
  const env = Object.assign({
    PREFS: { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v, o) => { kv.set(k, v); ttl.set(k, o && o.expirationTtl); },
      delete: async (k) => { kv.delete(k); } },
    TELEGRAM_BOT_TOKEN: "000000:TEST", TELEGRAM_CHAT_IDS: `${ME},${LAVI}`, CHAT_NAMES: `${ME}:Cosimo,${LAVI}:Lavi`,
    ALIASES: `uno:${ME},due:${LAVI}`,
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
  const pin = (alias, p, headers = {}) => call("/api/pin", { method: "POST", headers: Object.assign({ Origin: ORIGIN, "Content-Type": "application/json" }, headers),
    body: JSON.stringify({ alias, pin: p }) });
  return { env, kv, ttl, pin, sent, calls, call, api, hook, text, press, prefs, token: (chat, v = 1, n = "") => signToken(env.HMAC_SECRET, { c: chat, v, n }) };
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

test("voti: ognuno vota per se', vede il voto dell'altro, nessun chat_id esposto", async () => {
  const s = setup(), tok = await s.token(ME), tokL = await s.token(LAVI);
  const rate = async (t, id, v) => { const r = await s.api("/api/rate", t, { method: "POST", body: JSON.stringify({ id, s: v }) }); return [r.status, await r.json()]; };
  let r = await s.api("/api/rates", tok), j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.rates, {});
  assert.deepEqual(j.people.map((p) => [p.name, p.me]), [["Cosimo", true], ["Lavi", false]]);
  assert.ok(j.people.every((p) => /^[0-9a-f]{16}$/.test(p.k)));
  assert.ok(!JSON.stringify(j).includes(String(ME)) && !JSON.stringify(j).includes(String(LAVI)), "nessun chat_id nella risposta");
  const [kC, kL] = j.people.map((p) => p.k);
  let st;
  [st, j] = await rate(tok, "d_TBS", 4);
  assert.equal(st, 200);
  assert.equal(j.changed, true);
  assert.deepEqual(j.rates, { d_TBS: { [kC]: 4 } });
  [st, j] = await rate(tokL, "d_tbs", 0);
  assert.deepEqual(j.rates, { d_TBS: { [kC]: 4, [kL]: 0 } }, "0 stelle e' un voto; id normalizzato");
  assert.deepEqual(j.people.map((p) => p.me), [false, true]);
  assert.equal(j.me, "Lavi");
  [st, j] = await rate(tokL, "t_Georgia-Armenia", 5);
  assert.deepEqual(j.rates["t_georgia-armenia"], { [kL]: 5 });
  [st, j] = await rate(tok, "d_TBS", 4);
  assert.equal(j.changed, false, "stesso voto: nessuna scrittura");
  // si rilegge dal KV; una chiave per profilo
  j = await (await s.api("/api/rates", tok)).json();
  assert.deepEqual(j.rates, { d_TBS: { [kC]: 4, [kL]: 0 }, "t_georgia-armenia": { [kL]: 5 } });
  assert.deepEqual([...s.kv.keys()].sort(), ["rates:" + kC, "rates:" + kL].sort());
  assert.match(JSON.parse(s.kv.get("rates:" + kC)).d_TBS[1], /^\d{4}-\d\d-\d\dT/);
  // togliere il voto tocca solo il proprio
  [st, j] = await rate(tok, "d_TBS", null);
  assert.deepEqual(j.rates.d_TBS, { [kL]: 0 });
  assert.equal(s.sent.length, 0, "i voti non mandano messaggi");
  assert.equal(s.kv.has("prefs"), false, "i voti non toccano le preferenze del bot");
});

test("voti: auth e richieste malformate", async () => {
  const s = setup(), tok = await s.token(ME);
  assert.equal((await s.call("/api/rates")).status, 401);
  assert.equal((await s.api("/api/rates", await s.token(STRANGER))).status, 401);
  assert.equal((await s.api("/api/rate", "non.valido", { method: "POST", body: JSON.stringify({ id: "d_TBS", s: 3 }) })).status, 401);
  for (const body of ["{", JSON.stringify({ id: "d_TBS" }), JSON.stringify({ id: "d_TBS", s: 6 }), JSON.stringify({ id: "d_TBS", s: -1 }), JSON.stringify({ id: "d_TBS", s: 2.5 }),
    JSON.stringify({ id: "d_TBS", s: "4" }), JSON.stringify({ id: "w_BCN", s: 3 }), JSON.stringify({ id: "d_<b>", s: 3 }), JSON.stringify({ id: 7, s: 3 }), JSON.stringify({ id: "Tbilisi", s: 3 })]) {
    assert.equal((await s.api("/api/rate", tok, { method: "POST", body })).status, 400, body);
  }
  assert.equal(s.kv.size, 0);
  // il corpo non puo' scegliere per chi si vota: conta solo il token
  const j = await (await s.api("/api/rate", tok, { method: "POST", body: JSON.stringify({ id: "d_EVN", s: 2, k: "ffffffffffffffff", who: "Lavi" }) })).json();
  assert.deepEqual(Object.keys(j.rates.d_EVN), [j.people.find((p) => p.me).k]);
  assert.equal(j.people.find((p) => p.me).name, "Cosimo");
  // link revocato: niente piu' voti
  await s.text(ME, "/sito nuovo");
  assert.equal((await s.api("/api/rate", tok, { method: "POST", body: JSON.stringify({ id: "d_TBS", s: 3 }) })).status, 401);
  // CORS come per i preferiti
  const pre = await s.call("/api/rate", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
  // senza CHAT_NAMES: nome dal token per se', etichetta neutra per l'altro
  const s2 = setup({ CHAT_NAMES: "" });
  const p2 = (await (await s2.api("/api/rates", await s2.token(LAVI, 1, "Elle"))).json()).people;
  assert.deepEqual(p2.map((p) => p.name), ["Profilo 1", "Elle"]);
});

test("webhook: /voti e riga in /help", async () => {
  const s = setup(), tok = await s.token(ME), tokL = await s.token(LAVI);
  await s.text(ME, "/voti");
  assert.match(s.sent[0].text, /Ancora nessun voto/);
  assert.equal(s.sent[0].reply_markup.inline_keyboard[0][0].url, "https://cosimoney.github.io/agosto2027/#/voti");
  assert.match(s.sent[0].text, /solo sui giri completi/);
  // i voti rimasti sulle mete singole (d_...) non contano: finche' ci sono solo quelli, /voti resta vuoto
  for (const [t, id, v] of [[tok, "d_TBS", 5], [tokL, "d_TBS", 4], [tok, "d_EVN", 2]]) await s.api("/api/rate", t, { method: "POST", body: JSON.stringify({ id, s: v }) });
  await s.text(ME, "/voti");
  assert.match(s.sent[1].text, /Ancora nessun voto sui giri/);
  for (const [t, id, v] of [[tok, "t_georgia-armenia", 5], [tokL, "t_georgia-armenia", 4], [tok, "t_peru", 5], [tokL, "t_peru", 4], [tok, "t_islanda", 2], [tokL, "t_vecchio", 0]]) {
    await s.api("/api/rate", t, { method: "POST", body: JSON.stringify({ id, s: v }) });
  }
  await s.text(LAVI, "/voti");
  const t = s.sent[2].text;
  assert.equal(s.sent[2].chat_id, LAVI);
  assert.doesNotMatch(t, /Tbilisi|Erevan/, "le mete singole non compaiono");
  assert.match(t, /^⭐ <b>I vostri voti<\/b> · solo giri completi/);
  // a parita' di media prima il giro che costa meno in totale; voli migliori con al massimo 1 scalo (price_1stop), open-jaw = stima
  assert.match(t, /<b>Votati da entrambi<\/b>\n1\. <b>Georgia e Armenia<\/b> · Cosimo ★★★★★ · Lavi ★★★★☆ · media 4,5\n   voli 410 € pp da MXP · totale 1\.510 €–2\.010 € pp · 10 notti\n2\. <b>Perù classico<\/b> · Cosimo ★★★★★ · Lavi ★★★★☆ · media 4,5\n   voli 1\.450 € pp da MXP \(stima, 2 solo andata\) · totale 3\.130 €–3\.730 € pp · 11 notti\n   ✈ 3 voli interni ~180 € pp \(in parte stima\): Lima → Cusco, La Paz → Uyuni A\/R/);
  // voli interni: segnalati solo dove ci sono, con ~ sulle stime e senza sui prezzi reali
  assert.equal(intTxt({ int: { n: 1, pp: 58, real: 2, legs: ["Lima → Cusco"] } }), "✈ 1 volo interno 58 € pp (prezzo reale): Lima → Cusco");
  assert.equal(intTxt({ int: { n: 2, pp: 1320, real: 0, legs: ["A → B", "B → <C>"] } }), "✈ 2 voli interni ~1.320 € pp (stima): A → B, B → &lt;C&gt;");
  assert.equal(intTxt({}), ""); assert.equal(intTxt(null), ""); assert.equal(tripCost(SNAPSHOT, "t_georgia-armenia").int, "");
  assert.doesNotMatch(tripCost(SNAPSHOT, "t_georgia-armenia").text, /✈/);
  assert.match(t, /<b>Manca un voto<\/b>\n1\. <b>Islanda<\/b> · Cosimo ★★☆☆☆ · Lavi –\n   voli n\.d\. · a terra 2\.000 €–2\.600 € pp, senza voli · 9 notti\n2\. <b>Giro di uno snapshot vecchio<\/b> · Cosimo – · Lavi ☆☆☆☆☆\n   voli 300 € pp da MXP$/m);
  assert.match(t, /Totale a persona = voli \+ voli interni \+ a terra \(stima\)\. ✈ = giro con voli interni, già nel totale\./);
  assert.deepEqual([tripCost(SNAPSHOT, "t_peru").voli, tripCost(SNAPSHOT, "t_peru").lo, tripCost(SNAPSHOT, "t_peru").hi], [1450, 1450 + 180 + 1500, 1450 + 180 + 2100]);
  assert.equal(tripCost(SNAPSHOT, "t_non-esiste").text, "voli n.d.");
  // snapshot senza i costi del giro (scritto prima di questa modifica): si usa la tabella di ripiego del Worker
  const old = { targets: { "t_georgia-armenia": { name: "Georgia e Armenia" } }, offers: [offer("t_georgia-armenia", "MXP", "2027-08-07", "2027-08-18", 410)] };
  assert.match(tripCost(old, "t_georgia-armenia").text, /^voli 410 € pp da MXP · totale [\d.]+ €–[\d.]+ € pp · \d+ notti$/);
  await s.text(ME, "/help");
  assert.match(s.sent[3].text, /\/voti - i voti che avete dato ai giri completi/);
});

test("/pin nel bot: stato, imposta, rifiuta i PIN facili, off; nel KV solo l'hash", async () => {
  const s = setup();
  const msg = (chat, t, id = 77) => s.hook({ update_id: 1, message: { message_id: id, chat: { id: chat }, from: { first_name: "Tg" }, text: t } });
  await msg(ME, "/pin");
  assert.match(s.sent[0].text, /agosto2027\/#\/uno/);
  assert.match(s.sent[0].text, /non è ancora impostato/);
  assert.equal(s.kv.size, 0);
  for (const bad of ["/pin 12", "/pin 12345", "/pin abcd", "/pin 1111", "/pin 1234", "/pin 9876", "/pin 0000"]) await msg(ME, bad);
  assert.equal(s.kv.size, 0, "nessun PIN non valido o banale salvato");
  assert.match(s.sent.at(-1).text, /troppo facile/);
  assert.ok(s.calls.some(([m, b]) => m === "deleteMessage" && b.chat_id === ME && b.message_id === 77), "il messaggio con il PIN viene cancellato");
  await msg(ME, "/pin 4827");
  assert.match(s.sent.at(-1).text, /PIN salvato/);
  assert.match(s.sent.at(-1).text, /Ho cancellato il tuo messaggio/);
  assert.equal(s.sent.at(-1).reply_markup.inline_keyboard[0][0].url, "https://cosimoney.github.io/agosto2027/#/uno");
  const key = "pin:" + (await chatHash(s.env.TELEGRAM_BOT_TOKEN, ME)), rec = JSON.parse(s.kv.get(key));
  assert.equal(rec.h, await pinHash(s.env.HMAC_SECRET, ME, "4827"));
  assert.notEqual(rec.h, await pinHash(s.env.HMAC_SECRET, LAVI, "4827"), "il sale e' la chat: stesso PIN, hash diverso");
  assert.ok(![...s.kv.values()].some((v) => v.includes("4827")) && !s.sent.some((m) => /salvato/.test(m.text) && m.text.includes("4827")), "il PIN non resta in chiaro");
  assert.ok(![...s.kv.keys()].some((k) => k.includes(String(ME))), "nessun chat_id nelle chiavi");
  await msg(ME, "/pin");
  assert.match(s.sent.at(-1).text, /Il PIN è <b>impostato<\/b>/);
  await msg(ME, "/start pin");
  assert.match(s.sent.at(-1).text, /Il PIN è <b>impostato<\/b>/);
  await msg(ME, "/pin off");
  assert.match(s.sent.at(-1).text, /PIN disattivato/);
  assert.ok(!s.kv.has(key));
  assert.equal((await s.pin("uno", "4827")).status, 401, "dopo /pin off non si entra");
  await msg(ME, "/help");
  assert.match(s.sent.at(-1).text, /\/pin - /);
  // chat senza alias, chat non autorizzata
  const s2 = setup({ ALIASES: `uno:${ME}` });
  await s2.text(LAVI, "/pin 4827");
  assert.match(s2.sent[0].text, /non c'è ancora un indirizzo corto/);
  assert.equal(s2.kv.size, 0);
  await s2.text(STRANGER, "/pin 4827");
  assert.equal(s2.sent.length, 1);
  assert.deepEqual(aliasMap({ ALIASES: `uno:${ME},x:1,Bad:2,tre:${STRANGER}`, TELEGRAM_CHAT_IDS: `${ME}` }), { uno: ME }, "alias solo per chat autorizzate e nomi validi");
});

test("/api/pin: PIN giusto -> stesso token di /sito; errori uniformi; CORS", async () => {
  const s = setup();
  await s.text(ME, "/pin 4827");
  await s.text(LAVI, "/pin 5310", "Lavinia");
  let r = await s.pin("uno", "4827"), j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(j).sort(), ["name", "ok", "token"]);
  assert.equal(j.name, "Cosimo");
  assert.equal((await verifyToken(s.env.HMAC_SECRET, j.token)).c, ME);
  assert.equal((await (await s.api("/api/favs", j.token)).json()).me, "Cosimo", "il token vale per le altre API");
  await s.text(ME, "/sito");
  assert.equal(s.sent.at(-1).reply_markup.inline_keyboard[0][0].url.split("#/login/")[1], j.token, "identico al token del link di /sito");
  assert.equal((await (await s.pin("due", "5310")).json()).name, "Lavi");
  assert.equal((await s.pin("due", "4827")).status, 401, "il PIN di un altro profilo non vale");
  // dopo /sito nuovo il PIN da' il token nuovo, quello vecchio e' revocato
  await s.text(ME, "/sito nuovo");
  const j2 = await (await s.pin("uno", "4827")).json();
  assert.notEqual(j2.token, j.token);
  assert.equal((await s.api("/api/favs", j.token)).status, 401);
  assert.equal((await s.api("/api/favs", j2.token)).status, 200);
  // senza CHAT_NAMES vale il nome Telegram di chi ha impostato il PIN
  const s4 = setup({ CHAT_NAMES: "" });
  await s4.text(ME, "/pin 4827", "Mimmo");
  assert.equal((await (await s4.pin("uno", "4827")).json()).name, "Mimmo");
  // risposta identica per: PIN errato, alias inesistente, alias vero senza PIN
  const s3 = setup();
  await s3.text(ME, "/pin 4827");
  const out = [];
  for (const [a, p] of [["uno", "0001"], ["boh", "4827"], ["due", "4827"]]) { r = await s3.pin(a, p); out.push([r.status, await r.text()]); }
  assert.deepEqual(out[0], [401, JSON.stringify({ ok: false, error: "bad_pin", left: 4 })]);
  assert.deepEqual(out[1], out[0], "alias inesistente: stessa risposta");
  assert.deepEqual(out[2], out[0], "alias senza PIN: stessa risposta");
  assert.ok(![...s3.kv.keys()].some((k) => k.includes("boh")), "gli alias inventati non scrivono nel KV");
  // richieste malformate: 400 e nessun tentativo contato
  for (const body of ["x", "{}", JSON.stringify({ alias: "uno" }), JSON.stringify({ alias: "uno", pin: 4827 }), JSON.stringify({ alias: "UNO", pin: "4827" }),
    JSON.stringify({ alias: "uno", pin: "48270" }), JSON.stringify({ alias: "u", pin: "4827" }), JSON.stringify({ alias: "uno/../x", pin: "4827" })]) {
    assert.equal((await s3.call("/api/pin", { method: "POST", body })).status, 400, body);
  }
  assert.equal(JSON.parse(s3.kv.get("pinlock:uno")).n, 1);
  assert.equal((await s3.call("/api/pin")).status, 404, "solo POST");
  r = await s3.pin("uno", "4827", { Origin: "https://example.org" });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  r = await s3.call("/api/pin", { method: "OPTIONS", headers: { Origin: ORIGIN } });
  assert.equal(r.status, 204);
  assert.equal((await setup({ HMAC_SECRET: "" }).pin("uno", "4827")).status, 503);
});

test("/api/pin: blocco dopo 5 errori, crescente, avviso Telegram, sblocco", async () => {
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const s = setup();
    await s.text(ME, "/pin 4827");
    const n0 = s.sent.length, st = [];
    for (let i = 0; i < 4; i++) { const r = await s.pin("uno", "000" + i); st.push([r.status, (await r.json()).left]); }
    assert.deepEqual(st, [[401, 4], [401, 3], [401, 2], [401, 1]]);
    assert.equal(s.sent.length, n0, "nessun avviso prima del blocco");
    let r = await s.pin("uno", "0009"), j = await r.json();
    assert.deepEqual([r.status, j], [429, { ok: false, error: "locked", retry: 900 }]);
    assert.equal(s.sent.length, n0 + 1);
    assert.equal(s.sent.at(-1).chat_id, ME);
    assert.match(s.sent.at(-1).text, /Troppi PIN sbagliati.*bloccato per 15 minuti/s);
    assert.equal(s.ttl.get("pinlock:uno"), 900 + 86400, "il contatore scade da solo");
    now += 60_000;
    r = await s.pin("uno", "4827"); j = await r.json();
    assert.deepEqual([r.status, j], [429, { ok: false, error: "locked", retry: 840 }], "durante il blocco anche il PIN giusto e' rifiutato");
    assert.equal(s.sent.length, n0 + 1, "un solo avviso per blocco");
    assert.equal((await s.pin("due", "0000")).status, 401, "il blocco riguarda solo quell'alias");
    now += 15 * 60_000;
    for (let i = 0; i < 4; i++) assert.equal((await s.pin("uno", "000" + i)).status, 401);
    r = await s.pin("uno", "0009"); j = await r.json();
    assert.equal(j.retry, 3600, "secondo blocco: un'ora");
    assert.match(s.sent.at(-1).text, /bloccato per un'ora/);
    // il proprietario si sblocca dal bot reimpostando il PIN
    await s.text(ME, "/pin 4827");
    assert.ok(!s.kv.has("pinlock:uno"));
    assert.equal((await s.pin("uno", "4827")).status, 200);
    // un accesso riuscito azzera gli errori
    await s.pin("uno", "0001");
    assert.ok(s.kv.has("pinlock:uno"));
    await s.pin("uno", "4827");
    assert.ok(!s.kv.has("pinlock:uno"));
    // alias inventato: stesso comportamento visto da fuori, nessuna scrittura e nessun messaggio
    const before = s.sent.length, g = [];
    for (let i = 0; i < 6; i++) { r = await s.pin("fantasma", "000" + i); g.push(r.status); }
    assert.deepEqual(g, [401, 401, 401, 401, 429, 429]);
    assert.deepEqual(await r.json(), { ok: false, error: "locked", retry: 900 });
    assert.equal(s.sent.length, before);
    assert.ok(![...s.kv.keys()].some((k) => k.includes("fantasma")));
    // richieste in parallelo: il contatore non si fa scavalcare
    const s2 = setup();
    await s2.text(ME, "/pin 4827");
    const par = await Promise.all(Array.from({ length: 12 }, (_, i) => s2.pin("uno", String(1000 + i * 7))));
    assert.equal(par.filter((x) => x.status === 401).length, 4);
    assert.equal(par.filter((x) => x.status === 429).length, 8);
    assert.equal(s2.sent.filter((m) => /Troppi PIN/.test(m.text)).length, 1);
  } finally { Date.now = realNow; }
});
