/* Test Node della pagina v2 con un DOM minimale: node test_v2.js
   Controlla: home (3 sezioni), una pagina dettaglio per sezione, deep link come primo caricamento,
   niente undefined/NaN nel markup, tutte le immagini referenziate esistono in img/.
   Preferiti: senza Worker o senza token la stella resta il link Telegram; con il token (Worker finto) stella piena/vuota,
   toggle ottimistico con ritorno indietro se il Worker fallisce, pagina #/preferiti, rotta #/login/<token>.
   Andamento del prezzo: grafico dello storico su mete e trip, Giorno / Settimana / Mese, serie per città, pochi dati, dato parziale.
   Dati fuori dalla pagina: data.json caricato all'avvio (stato di caricamento, errore e Riprova); nei test arriva da window.__DATA__.
   Foto in piu' larghezze (srcset), badge prezzo basso/tipico/alto, voti di coppia, confronto affiancato, mappa. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "agosto-2027-v2.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if(!m) throw new Error("script non trovato");
if(!/<title>Agosto 2027 da Milano<\/title>/.test(html)) throw new Error("title errato");
if(/\/\*__(CSS|JS|DATA|PHOTOS|API|DATA_URL)__\*\/|<!--__HEAD__-->/.test(html)) throw new Error("segnaposto non sostituito");
// i dati stanno in data.json accanto alla pagina: la pagina deve essere leggera e puntare al file con la sua versione
const DATA_TXT = fs.readFileSync(path.join(ROOT, "data.json"), "utf8");
const DATA_URL = (m[1].match(/const DATA_URL = "([^"]*)"/) || [])[1];
if(!/^data\.json\?v=[0-9a-f]{10}$/.test(DATA_URL || "")) throw new Error("DATA_URL errato: " + DATA_URL);
if(!html.includes(`<link rel="preload" href="${DATA_URL}" as="fetch" crossorigin="anonymous">`)) throw new Error("preload di data.json mancante");
if(html.length > 400000) throw new Error("pagina troppo pesante: i dati devono stare in data.json (" + html.length + " caratteri)");
if(!/<div id="app"><div class="boot" role="status">/.test(html)) throw new Error("stato di caricamento mancante nel template");
if(!/<div class="cmpbar" id="cmpbar"[^>]*hidden>/.test(html)) throw new Error("barra del confronto mancante nel template");
const WORLD_TXT = fs.readFileSync(path.join(ROOT, "world.json"), "utf8");
if(!/<div class="toast" id="toast"[^>]*hidden>/.test(html)) throw new Error("toast mancante nel template");
const API_TEST = "https://worker.test";

// opts: {api: true = sito collegato al Worker finto, token: token gia' salvato nel dispositivo, fetch: (url, init) => Promise<Response finta>,
//        data: false = niente window.__DATA__ (la pagina scarica data.json con fetch), ls: valori iniziali di localStorage}
function boot(hash, opts){
  opts = opts || {};
  let src = m[1];
  if(opts.api !== undefined){
    const re = /const API = "[^"]*"/;
    if(!re.test(src)) throw new Error("costante API non trovata");
    src = src.replace(re, `const API = "${opts.api ? API_TEST : ""}"`);
  }
  const ls = {};
  if(opts.token) ls["agosto2027.token"] = opts.token;
  Object.assign(ls, opts.ls || {});
  const els = {};
  const mk = id => ({id, innerHTML:"", textContent:"", hidden:false, value:"", placeholder:"", open:false, dataset:{}, style:{},
    classList:{toggle(){}, add(){}, remove(){}, contains(){ return false; }}, setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, addEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; }, appendChild(){}, scrollIntoView(){}, close(){}, showModal(){}, closest(){ return null; }});
  const listeners = {};
  const document = {title:"", hidden:false, getElementById:id => els[id] || (els[id] = mk(id)), querySelectorAll:() => [], querySelector:() => null,
    createElement:() => mk("x"), addEventListener:(t, f) => { (listeners[t] = listeners[t] || []).push(f); }};
  const window = {__DATA__:opts.data === false ? undefined : JSON.parse(DATA_TXT), scrollY:0, scrollTo(){}, addEventListener:(t, f) => { (listeners["w:" + t] = listeners["w:" + t] || []).push(f); }, matchMedia:() => ({matches:true})};
  const ctx = {document, window, location:{hash}, history:{scrollRestoration:"auto", back(){}}, console, setInterval:() => 0, clearInterval(){}, setTimeout, requestAnimationFrame:f => f(),
    Image:function(){}, btoa:s => Buffer.from(s, "binary").toString("base64"), encodeURIComponent, decodeURIComponent, clearTimeout(){},
    localStorage:{getItem:k => (k in ls ? ls[k] : null), setItem:(k, v) => { ls[k] = String(v); }, removeItem:k => { delete ls[k]; }},
    fetch:opts.fetch || (() => Promise.reject(new Error("rete non prevista in questo test")))};
  ctx.setTimeout = () => 0;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, {filename:"v2.js"});
  return {ctx, els, ls, get App(){ return window.App; }, nav(h){ ctx.location.hash = h; listeners["w:hashchange"].forEach(f => f()); }, listeners};
}
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if(!c){ fails++; console.log("FAIL", msg); } };
const SEEN = {};
function audit(name, markup){
  const text = markup.replace(/<[^>]+>/g, " ");
  ok(markup.length > 500, name + ": markup vuoto");
  ok(!/undefined/.test(markup), name + ": 'undefined' nel markup → " + (markup.match(/.{60}undefined.{40}/) || [""])[0]);
  ok(!/\bNaN\b/.test(markup), name + ": 'NaN' nel markup → " + (markup.match(/.{60}NaN.{40}/) || [""])[0]);
  ok(!/\bnull\b/.test(text), name + ": 'null' nel testo → " + (text.match(/.{60}\bnull\b.{40}/) || [""])[0]);
  ok(!/Infinity/.test(markup), name + ": 'Infinity' nel markup");
  const imgs = [...markup.matchAll(/<img\b[^>]*>/g)].map(x => x[0]);
  for(const t of imgs){
    const src = (t.match(/src="([^"]+)"/) || [])[1];
    ok(src && /^img\/[\w.-]+\.webp$/.test(src), name + ": src non relativo a img/ → " + src);
    ok(src && fs.existsSync(path.join(ROOT, src)), name + ": immagine mancante " + src);
    ok(/ width="\d+" height="\d+"/.test(t) && / alt="/.test(t), name + ": img senza dimensioni o alt " + src);
    ok(/loading="lazy"|fetchpriority="high"/.test(t), name + ": img senza loading " + src);
    const ss = (t.match(/ srcset="([^"]+)"/) || [])[1];
    if(ss){
      const parts = ss.split(", ").map(x => x.split(" "));
      ok(parts.every(([f, w]) => /^img\/[\w.-]+\.webp$/.test(f) && /^\d+w$/.test(w) && (SEEN[f] || (SEEN[f] = fs.existsSync(path.join(ROOT, f))))), name + ": variante mancante in srcset → " + ss);
      ok(parts.every((x, i) => !i || parseInt(x[1]) > parseInt(parts[i - 1][1])) && parts[parts.length - 1][0] === src && / sizes="[^"]+"/.test(t), name + ": srcset non crescente o senza sizes " + src);
    }
  }
  ok(!/https?:\/\/[^"]+\.(webp|jpg|jpeg|png)"/i.test(markup.replace(/href="[^"]*"/g, "")), name + ": immagine in hotlink");
  return imgs.length;
}
const all = e => Object.values(e).map(x => x.innerHTML).join("\n");

// 1. home, tre sezioni
let b = boot("");
const App = b.App, RAWn = {d:0, v:0, p:0};
let home = all(b.els);
ok(/Agosto <em>2027<\/em>/.test(home), "home: hero mancante");
ok(/class="card /.test(b.els.grid.innerHTML), "home: nessuna card nuove mete");
ok(/t\.me\/Trip2027_bot\?start=fav_d_[A-Z]{3}"/.test(b.els.grid.innerHTML), "home: link preferiti destinazione");
RAWn.d = audit("home/nuove", home);
const firstNew = (b.els.grid.innerHTML.match(/href="#\/d\/([A-Z]{3})"/) || [])[1];
b.nav("#/visitati"); home = all(b.els);
ok(b.App.S.tab === "vis" && /class="card /.test(b.els.grid.innerHTML), "home: tab visitati vuota");
ok(/class="giro"/.test(b.els.grid.innerHTML), "home: blocco già visto → giro nuovo sulle card");
RAWn.v = audit("home/visitati", home);
const firstVis = (b.els.grid.innerHTML.match(/href="#\/d\/([A-Z]{3})"/) || [])[1];
b.nav("#/trips"); home = all(b.els);
ok(b.App.S.tab === "pop" && /class="card pop/.test(b.els.grid.innerHTML), "home: tab popular vuota");
ok(/start=fav_t_[a-z0-9-]+"/.test(b.els.grid.innerHTML), "home: link preferiti trip");
RAWn.p = audit("home/trips", home);
const firstTrip = (b.els.grid.innerHTML.match(/href="#\/t\/([a-z0-9-]+)"/) || [])[1];

// 2. filtri: ogni combinazione semplice non deve rompere il rendering
b.nav("#/");
for(const [k, vals] of Object.entries({origin:["LIN", "MXP", "ROM", "PSA", "all"], stops:[0, 2, 1], dur:[10, 12, "all"], clima:["ottimo", "all"], budget:[1000, 0], sort:["price", "clima", "score"]}))
  for(const v of vals){ b.App.S.f[k] = v; const p = b.App.homeParts(); audit(`filtro ${k}=${v}`, p.grid + p.kpis + p.panel + p.active + p.tabs); }
b.App.S.tab = "pop";
for(const [k, vals] of Object.entries({origin:["LIN", "ROM", "all"], stops:[2, 1], kind:["oj", "rt", "all"], budget:[2500, 0], sort:["voli", "score", "tot"]}))
  for(const v of vals){ b.App.S.p[k] = v; const p = b.App.homeParts(); audit(`filtro trip ${k}=${v}`, p.grid + p.kpis + p.panel + p.active + p.tabs); }

// 3. pagine dettaglio, una per sezione, aperte dalla home
const pages = [["#/d/" + firstNew, "nuove"], ["#/d/" + firstVis, "visitati"], ["#/t/" + firstTrip, "trip"]];
for(const [h, name] of pages){
  b.nav(h);
  const mk = b.els.app.innerHTML;
  ok(/class="hero d"/.test(mk) && /class="tag"/.test(mk), name + ": hero o prezzo mancante " + h);
  ok(/data-act="back"/.test(mk) && /Tutte le mete/.test(mk), name + ": bottone indietro");
  ok(/id="voli"/.test(mk) && /class="mx"/.test(mk) && /google\.com\/travel\/flights/.test(mk), name + ": sezione voli");
  ok(/start=fav_[dt]_/.test(mk), name + ": preferiti");
  if(name === "visitati") ok(/Hai già visto/.test(mk) && /Giro nuovo/.test(mk), name + ": blocco già visto");
  if(name === "trip") ok(/class="cost"/.test(mk) && /class="est"/.test(mk) && /class="stages"/.test(mk), name + ": costi stimati / tappe");
  else ok(/Perché ad agosto/.test(mk), name + ": perché ad agosto");
  audit("pagina " + h, mk);
}

// 4. deep link come PRIMO caricamento (notifiche Telegram)
for(const [h] of pages){
  const d = boot(h), mk = d.els.app.innerHTML;
  ok(/class="hero d"/.test(mk) && /class="tag"/.test(mk), "deep link " + h + ": pagina non resa al primo caricamento");
  ok(/href="#\/"[^>]*data-act="back"/.test(mk), "deep link " + h + ": indietro senza href alla home");
  audit("deep link " + h, mk);
}
// 5. tutte le pagine esistenti + collegamenti rotti
const DATA0 = JSON.parse(DATA_TXT);
const R = {dests:DATA0.raw.dests.map(d => d.code), trips:DATA0.raw.trips_popular.trips.map(t => t.id), origins:[...new Set(DATA0.raw.combos.map(c => c.o))]};
let nimg = 0;
for(const c of R.dests) nimg += audit("d/" + c, b.App.pageHTML({page:"dest", id:c}));
for(const t of R.trips) nimg += audit("t/" + t, b.App.pageHTML({page:"trip", id:t}));
audit("crediti", b.App.pageHTML({page:"credits"}));
audit("404", b.App.pageHTML({page:"dest", id:"XXX"}) + b.App.pageHTML({page:"trip", id:"<script>"}));
ok(!/<script>/.test(b.App.pageHTML({page:"trip", id:"<script>"})), "escape dell'id nella pagina non trovata");
ok(b.App.parse("#/d/dps").id === "DPS" && b.App.parse("#/t/sri-lanka").id === "sri-lanka" && b.App.parse("#/boh").page === "home", "parse delle rotte");
ok(b.App.parse("#/voti").page === "rates" && b.App.parse("#/mappa").page === "map" && b.App.parse("#/confronto").page === "cmp" && b.App.parse("#/confronto").ids === null
   && b.App.parse("#/confronto/d_DPS,t_x").ids.join() === "d_DPS,t_x", "parse delle rotte voti, mappa, confronto");


// 6. intestazione e menu (anche su telefono: Già visitati e Preferiti stanno nel menu)
(async () => {
const tick = () => new Promise(r => setImmediate(r));
const res = (status, body) => ({status, ok:status >= 200 && status < 300, json:async () => body});
{
  const top = boot("", {api:true}).els.app.innerHTML;
  ok(/class="brand" href="#\/">Agosto 2027<i>da Milano, Roma, Pisa<\/i>/.test(top) && !/<i>da Milano<\/i>/.test(top), "intestazione: non più solo 'da Milano'");
  ok(/class="menu-b" data-act="menu" aria-expanded="false" aria-controls="topnav"/.test(top) && /<nav id="topnav"[^>]*class="main"/.test(top), "menu telefono: pulsante e tendina");
  const navHtml = (top.match(/<nav id="topnav"[^>]*>([\s\S]*?)<\/nav>/) || ["", ""])[1];
  ok(["#/", "#/visitati", "#/trips", "#/preferiti"].every(h => navHtml.includes(`href="${h}"`)) && !/class="opt"/.test(navHtml), "menu: Nuove mete, Già visitati, Popular trips, Preferiti → " + navHtml.replace(/<svg[\s\S]*?<\/svg>/g, ""));
}

// 7. senza Worker (build di oggi) e senza token: tutto come prima, la pagina preferiti invita a scrivere /sito
for(const [name, opts] of [["senza Worker", {api:false}], ["Worker senza token", {api:true}]]){
  const d = boot("", opts);
  ok(/t\.me\/Trip2027_bot\?start=fav_d_[A-Z]{3}"/.test(d.els.grid.innerHTML) && !/data-act="fav"/.test(d.els.grid.innerHTML), name + ": la stella resta il link Telegram");
  ok(/href="#\/preferiti"/.test(d.els.app.innerHTML) === !!opts.api, name + ": voce Preferiti nel menu solo con il Worker");
  d.nav("#/d/" + firstNew);
  ok(/start=fav_d_/.test(d.els.app.innerHTML) && !/data-act="fav"/.test(d.els.app.innerHTML), name + ": pagina meta, salva = link Telegram");
  d.nav("#/preferiti");
  const mk = d.els.app.innerHTML;
  ok(d.App.S.page === "favs" && /\/sito/.test(mk) && /t\.me\/Trip2027_bot\?start=sito"/.test(mk) && !/class="card fv/.test(mk), name + ": pagina preferiti = solo l'invito, nessun elenco");
  ok(/<nav id="topnav"[^>]*class="main"/.test(mk) && /data-solid="1"/.test(mk), name + ": pagina preferiti con il menu completo");
  audit("preferiti " + name, mk);
}

// 8. con il token: elenco dal Worker, stella piena/vuota, pagina con le card
const favList = () => ({ok:true, me:"Cosimo", threshold:1000, generated:"2026-11-22T06:00:00Z", favs:[
  {id:"d_" + firstNew, name:"x", country:"y", by:"Cosimo", at:"2026-11-20T10:00:00.000Z", p:5000, thr:null, cur:{pp:4000, o:"MXP", dep:"2027-08-07", ret:"2027-08-18", n:11, stops:1, url:null}},
  {id:"t_" + firstTrip, name:"x", country:"y", by:"Lavi", at:"2026-11-21T10:00:00.000Z", p:100, thr:300, cur:{pp:150, o:"FCO", dep:"2027-08-07", ret:"2027-08-18", n:11, stops:null, url:null}},
  {id:"d_" + firstVis, name:"x", country:"y", by:null, at:"2026-11-19", p:null, thr:null, cur:null},
  {id:"w_BCN", name:"Barcellona", country:"", by:"Lavi", at:"2026-11-18T10:00:00.000Z", p:60, thr:null, cur:{pp:60, o:"BGY", dep:"2027-01-15", ret:"2027-01-17", n:2, stops:0, url:null}},
  {id:"d_ZZZ", name:"d_ZZZ", country:"", by:"Cosimo", at:"2026-11-17T10:00:00.000Z", p:null, thr:null, cur:null}]});
{
  const calls = [];
  const d = boot("#/preferiti", {api:true, token:"tok.test", fetch:(url, init) => { calls.push([url, init]); return Promise.resolve(res(200, favList())); }});
  ok(/Carico i preferiti/.test(d.els.app.innerHTML), "preferiti: stato di caricamento prima della risposta");
  await tick(); await tick();
  ok(calls.length >= 1 && calls[0][0] === API_TEST + "/api/favs" && calls[0][1].headers.Authorization === "Bearer tok.test" && calls[0][1].method === "GET", "preferiti: GET /api/favs con Bearer");
  const mk = d.els.app.innerHTML, cards = mk.split('<article class="card fv').slice(1);
  ok(cards.length === 5, "preferiti: una card per preferito (" + cards.length + ")");
  ok(cards[0].includes(`href="#/t/${firstTrip}"`) && cards[1].includes(`href="#/d/${firstNew}"`), "preferiti: i più recenti in alto, con link alla pagina");
  ok(/Aggiunto da <b>Lavi<\/b> il 21 nov/.test(cards[0]) && /Aggiunto da <b>Cosimo<\/b> il 20 nov/.test(cards[1]) && /Aggiunto il 19 nov/.test(cards[2]), "preferiti: chi l'ha aggiunto e quando");
  ok(/all'aggiunta <b class="num">5\.000 € pp<\/b> <span class="b ok">sceso di 1\.000 € \(−20%\)<\/span>/.test(cards[1]) && /<span class="b warn">salito di 50 € \(\+50%\)<\/span>/.test(cards[0])
     && /prezzo invariato/.test(cards[3]) && !/all'aggiunta/.test(cards[2]), "preferiti: prezzo all'aggiunta e variazione da allora");
  ok(/<span class="pp num">4\.000 €<\/span><span class="u">a persona · A\/R<\/span><span class="cp num">coppia 8\.000 €<\/span>/.test(cards[1]) && /a persona · voli/.test(cards[0]), "preferiti: prezzo pp di oggi e coppia");
  ok(/<b>sab 7 ago → mer 18 ago<\/b> · 11 giorni · da Malpensa · 1 scalo/.test(cards[1]), "preferiti: date, durata, aeroporto, scali → " + (cards[1].match(/<p class="meta">[^\n]*/) || [""])[0]);
  ok(/aria-label="Miglior prezzo per città di partenza"/.test(cards[1]) && /class="b (ok|plain)">(Milano|Roma|Pisa) <b class="num">[\d.]+ €<\/b>/.test(cards[1]) && /class="b ok">/.test(cards[1]), "preferiti: migliore da Milano / Roma / Pisa");
  ok(cards.every(c => /data-act="fav-rm" data-id="[dtw]_[A-Za-z0-9-]+"/.test(c)) && /Weekend da Milano/.test(cards[3]) && /flightsMI/.test(cards[3]) && /n\.d\./.test(cards[4]), "preferiti: rimuovi su ogni card, weekend e mete senza dati gestiti");
  ok(/Collegato come <b>Cosimo<\/b>/.test(mk) && /data-act="fav-logout"/.test(mk) && /5 preferiti condivisi/.test(mk), "preferiti: intestazione e scollega");
  audit("preferiti con elenco", mk);
  d.nav("#/");
  const g = d.els.grid.innerHTML;
  ok(new RegExp(`<button class="fav on" data-act="fav" data-id="d_${firstNew}" aria-pressed="true"`).test(g), "home: stella piena sulla meta preferita");
  ok(/<button class="fav" data-act="fav" data-id="d_[A-Z]{3}" aria-pressed="false"/.test(g) && !/start=fav_/.test(g), "home: stella vuota sulle altre, nessun link Telegram");
  d.nav("#/trips");
  ok(new RegExp(`<button class="fav on" data-act="fav" data-id="t_${firstTrip}"`).test(d.els.grid.innerHTML), "trips: stella piena sul giro preferito");
  d.nav("#/d/" + firstNew);
  ok(/<button class="btn ghost on" data-act="fav" data-id="d_[A-Z]{3}" aria-pressed="true">[\s\S]*?<span class="lbl">Nei preferiti<\/span>/.test(d.els.app.innerHTML), "pagina meta: 'Nei preferiti'");
  ok(/class="nav-fav" href="#\/preferiti"/.test(d.els.app.innerHTML), "pagina meta: Preferiti raggiungibile dalla barra in alto");
  audit("pagina meta con token", d.els.app.innerHTML);
}

// 9. toggle ottimistico: cambia subito, torna indietro se il Worker fallisce, token non valido → si torna al link Telegram
{
  let answer = null; const posts = [];
  const d = boot("", {api:true, token:"tok.test", fetch:(url, init) => {
    if(init.method === "GET") return Promise.resolve(res(200, {ok:true, me:"Cosimo", favs:[]}));
    posts.push(JSON.parse(init.body));
    return new Promise(r => { answer = r; });
  }});
  await tick(); await tick();
  const id = "d_" + firstNew, F = d.App.FAV;
  let p = d.App.toggleFav(id);
  ok(F.map.has(id) && posts.length === 1 && posts[0].id === id && posts[0].on === true, "toggle: stella piena subito, prima della risposta (POST /api/fav {id, on:true})");
  d.App.toggleFav(id);
  ok(posts.length === 1, "toggle: un secondo clic durante il salvataggio non parte");
  answer(res(500, {})); await p;
  ok(!F.map.has(id) && /Non sono riuscito/.test(d.els.toast.textContent) && d.els.toast.hidden === false, "toggle: errore del Worker → stella di nuovo vuota e avviso");
  p = d.App.toggleFav(id);
  answer(res(200, {ok:true, me:"Cosimo", favs:[{id, by:"Cosimo", at:"2026-11-22T10:00:00Z", p:200, cur:{pp:200, o:"MXP", dep:"2027-08-07", ret:"2027-08-18", n:11, stops:0}}]})); await p;
  ok(F.map.has(id) && F.map.get(id).p === 200 && /Salvato/.test(d.els.toast.textContent), "toggle: conferma del Worker → preferito salvato con il prezzo all'aggiunta");
  p = d.App.toggleFav(id);
  ok(!F.map.has(id) && posts[2].on === false, "toggle: rimozione immediata");
  answer(Promise.reject(new Error("rete"))); await p;
  ok(F.map.has(id) && F.map.get(id).p === 200, "toggle: rete assente → il preferito torna al suo posto");
  p = d.App.toggleFav(id);
  answer(res(401, {})); await p;
  ok(!d.ls["agosto2027.token"] && F.state === "expired" && !F.token, "token rifiutato: tolto dal dispositivo");
  d.nav("#/preferiti");
  ok(/non vale più/.test(d.els.app.innerHTML) && /\/sito/.test(d.els.app.innerHTML), "token rifiutato: la pagina preferiti chiede un nuovo link");
  d.nav("#/");
  ok(/start=fav_d_/.test(d.els.grid.innerHTML), "token rifiutato: la stella torna il link Telegram");
}

// 10. rotta #/login/<token> (link mandato dal bot con /sito)
{
  const calls = [];
  const d = boot("#/login/abc-123_x.def-456", {api:true, fetch:(url, init) => { calls.push(init.headers.Authorization); return Promise.resolve(res(200, favList())); }});
  ok(d.ls["agosto2027.token"] === "abc-123_x.def-456" && d.App.FAV.token === "abc-123_x.def-456", "login: token salvato nel dispositivo");
  ok(d.App.S.page === "favs" && calls[0] === "Bearer abc-123_x.def-456", "login: si apre la pagina preferiti e parte la lettura");
  await tick(); await tick();
  ok(d.els.app.innerHTML.split('<article class="card fv').length === 6, "login: elenco caricato");
  const off = boot("#/login/abc.def", {api:false});
  ok(!off.ls["agosto2027.token"] && /\/sito/.test(off.els.app.innerHTML), "login senza Worker: nessun token salvato");
  const p1 = b.App.parse("#/preferiti"), p2 = b.App.parse("#/login/aa.bb");
  ok(p1.page === "favs" && p2.page === "login" && p2.token === "aa.bb", "parse delle rotte preferiti e login");
}

// 11. andamento del prezzo (storico dei giri): grafico su mete e trip, aggregazioni, serie, pochi dati, dato parziale
{
  const d = boot(""), A = d.App, H = A.HIST;
  const ids = Object.keys(H.t || {}), dIds = ids.filter(x => x[0] === "d"), tIds = ids.filter(x => x[0] === "t");
  ok(H.days.length >= 1 && dIds.length >= 5 && tIds.length >= 5, "storico: dati nel blob (" + H.days.length + " giorni, " + dIds.length + " mete, " + tIds.length + " trip)");
  ok(H.days.every(x => /^\d{4}-\d\d-\d\d$/.test(x)) && H.runs.length === H.days.length && ids.every(id => H.t[id].every(r => r[0] < H.days.length && [1, 2, 3].every(i => r[i] === -1 || H.e[r[i]]))), "storico: indici coerenti");
  const sample = dIds.slice(0, 4).concat(dIds.includes("d_CMB") ? ["d_CMB"] : []).concat(tIds.slice(0, 4));
  for(const id of sample){
    const page = A.pageHTML({page:id[0] === "d" ? "dest" : "trip", id:id.slice(2)});
    ok(/<section class="voli sec" id="voli">[\s\S]*id="hist-in"/.test(page), id + ": grafico nella sezione voli");
    for(const per of ["day", "week", "month"]){
      A.S.h.per = per; A.S.h.off = {};
      const mk = A.histHTML(id), rows = A.histRows(id), nb = A.histAgg(rows, per).length;
      ok(/<svg viewBox="0 0 1000 \d+" preserveAspectRatio="none" role="img" aria-label="Andamento[^"]+"><title>/.test(mk), id + " " + per + ": svg con titolo");
      ok(mk.split('class="hcol"').length - 1 === nb && mk.split('role="tooltip"').length - 1 === nb, id + " " + per + ": una colonna con tooltip per periodo (" + nb + ")");
      ok(new RegExp(`data-hk="per" data-hv="${per}" aria-pressed="true"`).test(mk) && mk.split('data-hk="per"').length - 1 === 3, id + " " + per + ": selettore Giorno / Settimana / Mese");
      ok(/class="hstats"/.test(mk) && />Ultimo</.test(mk) && />Minimo storico</.test(mk) && />Dall'inizio</.test(mk) && />Dall'ultimo giro</.test(mk), id + " " + per + ": etichette ultimo / minimo / variazioni");
      ok(/<details class="htab"><summary>Tabella dei valori<\/summary>/.test(mk) && mk.split("<tr><th scope=\"row\">").length - 1 === nb, id + " " + per + ": tabella dei valori");
      ok(/coppia [\d.]+ €/.test(mk) && /(diretto|\d scal[oi])/.test(mk) && /(Linate|Malpensa|Roma|Pisa)/.test(mk), id + " " + per + ": tooltip con coppia, aeroporto e scali");
      ok(rows.length >= 7 || new RegExp(`Storico in costruzione: ${rows.length} giorn[oi] di dati`).test(mk), id + " " + per + ": frase 'storico in costruzione'");
      ok(!/NaN|undefined|Infinity/.test((mk.match(/ d="[^"]*"/g) || []).join("")) && !/(left|top|width|height):(NaN|-?Infinity|undefined)/.test(mk), id + " " + per + ": coordinate valide");
      audit("storico " + id + " " + per, mk + "x".repeat(500));
    }
  }
  A.S.h.per = "day";
  // dati finti: 60 giorni, buchi, giorni parziali, una città che compare dopo, più giri in un giorno
  const day = i => new Date(Date.UTC(2026, 10, 21 + i)).toISOString().slice(0, 10);
  H.days = Array.from({length:60}, (_, i) => day(i));
  H.runs = H.days.map((_, i) => [i === 0 ? "locale" : "actions", i === 9 ? 1 : 0, i === 3 ? 2 : 1]);
  H.e = []; H.t = {d_TST:[], t_tst:[], d_ONE:[[0, 0, -1, -1, 0]], d_MIL:[[0, 0, -1, -1, 0], [1, 3, -1, -1, 0]]};
  for(let i = 0; i < 60; i++){
    H.e.push([900 - i * 3 + (i === 9 ? 120 : 0), "MXP", "2027-08-14", 10, 1], [880 + (i % 7) * 4, "FCO", "2027-08-09", 11, 0], [700, "PSA", "2027-08-12", 12, 2]);
    if(i === 20 || i === 21) continue;
    H.t.d_TST.push([i, 3 * i, 3 * i + 1, i >= 40 ? 3 * i + 2 : -1, i === 9 ? 1 : 0].concat(i === 3 ? [{MIL:950, ROM:null}] : []));
  }
  const e0 = H.e.length; H.e.push([640, "LIN", "2027-08-07", 11, 1, 2100, 0], [600, "FCO", "2027-08-08", 12, 2, 2110, 50]);
  H.t.t_tst = [[0, e0, e0 + 1, -1, 0], [1, e0, e0 + 1, -1, 0], [5, e0, -1, -1, 0]];
  let mk = A.histHTML("d_TST");
  ok(mk.split('class="hcol"').length - 1 === 58 && !/Storico in costruzione/.test(mk), "finti/giorno: 58 punti, niente frase dei pochi dati");
  ok(/class="hl s-MIL dash"/.test(mk) && /class="hdot s-MIL part"/.test(mk) && /<span class="est">dato parziale<\/span>/.test(mk) && /Punto vuoto e tratto tratteggiato = dato parziale/.test(mk), "finti: dato parziale segnato (tratteggio, punto vuoto, nota)");
  ok(["A", "MIL", "ROM", "PSA"].every(k => new RegExp(`data-hk="ser" data-hv="${k}" aria-pressed="true"`).test(mk)) && /Migliore assoluto/.test(mk), "finti: legenda con migliore assoluto, Milano, Roma, Pisa");
  ok(/ultimo giro del giorno: 950 €/.test(mk) && /ultimo giro del giorno: nessun volo trovato/.test(mk) && /2 giri, minimo del giorno/.test(mk) && /scansione dal computer/.test(mk), "finti: più giri nello stesso giorno e fonte nella tabella");
  ok(/Minimo storico<\/span><b class="num">700 € <small>pp<\/small><\/b>/.test(mk) && /Ultimo<\/span><b class="num">700 €/.test(mk) && /class="hd dn"[^>]*>.*−180 €.*−20%/.test(mk), "finti: minimo storico, ultimo e variazione dall'inizio (−180 €, −20%) → " + (mk.match(/class="hstats"[\s\S]{0,900}/) || [""])[0].replace(/<[^>]+>/g, " ").slice(0, 300));
  ok(/2 scali/.test(mk) && /diretto/.test(mk) && /Pisa · il più basso/.test(mk), "finti: scali e città più bassa nel tooltip");
  audit("storico finti giorno", mk);
  A.S.h.per = "week"; mk = A.histHTML("d_TST");
  ok(mk.split('class="hcol"').length - 1 === 10 && /Settimana del 16 nov · minimo di 2 giorni/.test(mk) && /visto il \d+ (nov|dic|gen)/.test(mk), "finti/settimana: 10 settimane, minimo del periodo con il giorno in cui è stato visto");
  ok(!/dash/.test(mk), "finti/settimana: una settimana con giorni completi non è parziale");
  audit("storico finti settimana", mk);
  A.S.h.per = "month"; mk = A.histHTML("d_TST");
  ok(mk.split('class="hcol"').length - 1 === 3 && /nov 2026 · minimo di 10 giorni/.test(mk) && /gen 2027/.test(mk), "finti/mese: 3 mesi");
  audit("storico finti mese", mk);
  // toggle dal clic (delegato sul documento): periodo e serie
  A.S.route = {page:"dest", id:"TST"}; A.S.page = "dest";
  const click = ds => d.listeners.click.forEach(f => f({target:{id:"", closest:s => s === "[data-act]" ? {dataset:ds, setAttribute(){}} : null}, preventDefault(){}}));
  click({act:"hist", hk:"per", hv:"day"});
  ok(A.S.h.per === "day" && d.els["hist-in"].innerHTML.split('class="hcol"').length - 1 === 58, "clic su Giorno: grafico ridisegnato");
  click({act:"hist", hk:"ser", hv:"A"}); click({act:"hist", hk:"ser", hv:"PSA"});
  mk = d.els["hist-in"].innerHTML;
  ok(/data-hv="A" aria-pressed="false"/.test(mk) && /data-hv="PSA" aria-pressed="false"/.test(mk) && !/class="hl s-A"/.test(mk) && !/class="hl s-PSA"/.test(mk) && /class="hl s-ROM"/.test(mk), "clic sulla legenda: serie nascoste");
  ok(/Riepilogo dell'andamento, Milano/.test(mk) && /Ultimo<\/span><b class="num">723 €/.test(mk), "serie nascoste: le etichette seguono la prima serie visibile (Milano)");
  click({act:"hist", hk:"ser", hv:"MIL"}); click({act:"hist", hk:"ser", hv:"ROM"});
  ok(Object.values(A.S.h.off).every(v => !v) && /class="hl s-A"/.test(d.els["hist-in"].innerHTML), "tutte le serie spente: tornano tutte");
  // pochi dati e casi limite
  mk = A.histHTML("d_ONE");
  ok(/Storico in costruzione: 1 giorno di dati/.test(mk) && mk.split("serve un secondo giro").length - 1 === 2 && /class="hfig few"/.test(mk) && /class="hlast num c"/.test(mk) && !/class="hl /.test(mk) && !/class="hlegs"/.test(mk), "un solo punto: versione ridotta, niente linea né legenda");
  audit("storico un punto", mk + "x".repeat(500));
  mk = A.histHTML("d_MIL");
  ok(/Storico in costruzione: 2 giorni di dati/.test(mk) && /class="hl s-A"/.test(mk) && !/class="hlegs"/.test(mk) && /class="hd dn"/.test(mk), "due punti da una sola città: solo la linea del migliore, variazione calcolata");
  mk = A.histHTML("t_tst");
  ok(/Andamento · voli per persona/.test(mk) && /640 € <small>voli pp<\/small>/.test(mk) && /totale stimato ~2\.100 €/.test(mk) && /Milano · il più basso/.test(mk), "trip: prezzo voli e totale stimato; migliore = voli + extra più basso");
  audit("storico trip finto", mk + "x".repeat(500));
  ok(A.histHTML("d_ZZZ") === "" && !/hist-in/.test(A.pageHTML({page:"dest", id:R.dests.find(c => !H.t["d_" + c])})), "meta senza storico: nessun grafico, pagina integra");
}

// 12. dati fuori dalla pagina: stato di caricamento, data.json via fetch, errore e Riprova
{
  const calls = []; let answer = null;
  const d = boot("#/trips", {data:false, fetch:(url, init) => { calls.push(url); return new Promise(r => { answer = r; }); }});
  ok(d.App === undefined && /class="boot" role="status"/.test(d.els.app.innerHTML) && /Carico mete e prezzi/.test(d.els.app.innerHTML), "avvio: stato di caricamento prima dei dati");
  ok(calls.length === 1 && calls[0] === DATA_URL, "avvio: una sola richiesta, a data.json con la versione → " + calls[0]);
  answer(res(500, {})); await tick(); await tick();
  ok(/Non riesco a caricare/.test(d.els.app.innerHTML) && /id="boot-retry"/.test(d.els.app.innerHTML) && d.App === undefined, "avvio: errore del server → messaggio e Riprova");
  d.listeners.click.forEach(f => f({target:{closest:s => s === "#boot-retry" ? {} : null}}));
  ok(calls.length === 2 && /Carico mete e prezzi/.test(d.els.app.innerHTML), "avvio: Riprova rilancia la richiesta");
  answer(res(200, JSON.parse(DATA_TXT))); await tick(); await tick(); await tick();
  ok(d.App && d.App.S.tab === "pop" && /class="card pop/.test(d.els.grid.innerHTML), "avvio: con i dati arriva la pagina chiesta dal deep link");
  audit("avvio con fetch", all(d.els));
  const e = boot("", {data:false, fetch:() => Promise.resolve(res(200, {raw:null}))});
  await tick(); await tick(); await tick();
  ok(/Non riesco a caricare/.test(e.els.app.innerHTML), "avvio: dati incompleti → errore, niente pagina rotta");
  ok(DATA0.raw.dests.length > 50 && Object.keys(DATA0.photos.photos).length > 100 && !/"raw":\{"dests"/.test(html), "data.json contiene mete e foto, la pagina no");
}

// 13. foto: piu' larghezze con srcset/sizes, niente lazy sulla foto principale, lazy sul resto
{
  const P = DATA0.photos.photos, withS = Object.values(P).filter(p => (p.s || []).length);
  ok(withS.length === Object.keys(P).length, "foto: ogni foto ha le varianti ridotte (" + withS.length + "/" + Object.keys(P).length + ")");
  ok(withS.every(p => p.s.every(w => w < p.w && [480, 800, 1200].includes(w)) && p.s.includes(480)), "foto: varianti 480/800/1200 sempre più strette dell'originale");
  const d = boot("");
  const hero = (d.els.app.innerHTML.match(/<div class="hero-bg" id="hero-bg">(<img[^>]*>)/) || [])[1] || "";
  ok(/fetchpriority="high"/.test(hero) && !/loading="lazy"/.test(hero) && /sizes="\(max-width:720px\) 150vw, 100vw"/.test(hero) && /-480\.webp 480w, .*-800\.webp 800w/.test(hero), "home: foto principale non lazy, con srcset → " + hero.slice(0, 200));
  const cards = d.els.grid.innerHTML.match(/<img[^>]*>/g) || [];
  ok(cards.length > 5 && cards.every(t => /loading="lazy"/.test(t) && / srcset="/.test(t) && /sizes="\(max-width:620px\) 66vw/.test(t)), "home: foto delle card lazy, con srcset e sizes");
  const pg = d.App.pageHTML({page:"dest", id:firstNew}), imgs = pg.match(/<img[^>]*>/g) || [];
  ok(imgs.filter(t => /fetchpriority="high"/.test(t)).length === 1 && imgs.filter(t => /loading="lazy"/.test(t)).length === imgs.length - 1, "pagina meta: solo la copertina non è lazy");
  ok(imgs.some(t => /sizes="120px"/.test(t)) || !/class="tl"/.test(pg), "pagina meta: miniature delle tappe a 120px");
}

// 14. badge prezzo basso / tipico / alto rispetto allo storico (almeno 5 giorni di storico per quella voce)
{
  const d = boot(""), A = d.App, H = A.HIST;
  const real = Object.keys(H.t).filter(id => A.histRows(id).length < 5);
  ok(real.every(id => A.priceLevel(id) === null && A.priceBadge(id) === ""), "badge: nascosto con meno di 5 giorni di storico");
  const day = i => new Date(Date.UTC(2026, 10, 21 + i)).toISOString().slice(0, 10);
  const mkHist = (prices, part) => { const e0 = H.e.length; prices.forEach(p => H.e.push([p, "MXP", "2027-08-14", 10, 1])); return prices.map((_, i) => [i, e0 + i, -1, -1, part && part.includes(i) ? 1 : 0]); };
  H.days = Array.from({length:8}, (_, i) => day(i)); H.runs = H.days.map(() => ["actions", 0, 1]);
  const idN = "d_" + firstNew, idT = "t_" + firstTrip;
  H.t = {[idN]:mkHist([900, 880, 910, 900, 905, 760]), [idT]:mkHist([500, 510, 505, 495, 500, 500, 600]), d_MID:mkHist([900, 880, 910, 900, 905, 890]), d_FOUR:mkHist([900, 880, 910, 700]),
    d_PART:mkHist([900, 880, 910, 900, 905, 1200], [5]), d_PLOW:mkHist([900, 880, 910, 900, 905, 700], [5]), d_SKIP:mkHist([900, 300, 910, 900, 905, 890], [1])};
  const L = id => A.priceLevel(id);
  ok(L(idN).lvl === "low" && L(idN).typ === 900 && L(idN).cur === 760 && L(idN).days === 6, "badge: 760 contro mediana 900 → basso");
  ok(L(idT).lvl === "high" && L(idT).typ === 500, "badge: 600 contro mediana 500 → alto");
  ok(L("d_MID").lvl === "mid", "badge: dentro il ±5% → tipico");
  ok(L("d_FOUR") === null, "badge: 4 giorni di storico → nascosto anche se il prezzo è crollato");
  ok(L("d_PART") === null && L("d_PLOW").lvl === "low", "badge: ultimo giro parziale → mai 'alto', il 'basso' resta");
  ok(L("d_SKIP").typ === 903, "badge: i giorni parziali restano fuori dalla mediana → " + L("d_SKIP").typ);
  const bl = A.priceBadge(idN), bh = A.priceBadge(idT), bm = A.priceBadge("d_MID");
  ok(/class="b ok pb pb-low"/.test(bl) && /prezzo basso/.test(bl) && /aria-hidden="true">▼/.test(bl) && /tipico 900 €/.test(bl) && /mediana su 6 giorni/.test(bl), "badge basso: icona, testo e spiegazione → " + bl);
  ok(/class="b warn pb pb-high"/.test(bh) && /prezzo alto/.test(bh) && /voli pp/.test(bh) && /class="b plain pb pb-mid"/.test(bm) && /prezzo tipico/.test(bm), "badge alto e tipico");
  ok(/class="b glass pb pb-low"/.test(A.priceBadge(idN, true)), "badge sulla foto: variante vetro");
  d.nav("#/"); A.S.f = Object.assign(A.S.f, {q:""});
  const card = d.els.grid.innerHTML.split("<article").find(x => x.includes(`href="#/d/${firstNew}"`)) || "";
  ok(/pb-low/.test(card), "badge sulla card della meta");
  ok(d.els.grid.innerHTML.split("pb pb-").length - 1 === 1, "badge solo sulle card che hanno abbastanza storico");
  ok(/class="d-facts[^"]*"[^>]*>.*pb-low/.test(A.pageHTML({page:"dest", id:firstNew})), "badge nella pagina della meta");
  d.nav("#/trips");
  ok(/pb-high/.test(d.els.grid.innerHTML.split("<article").find(x => x.includes(`href="#/t/${firstTrip}"`)) || "") && /pb-high/.test(A.pageHTML({page:"trip", id:firstTrip})), "badge su card e pagina del trip");
  audit("badge", bl + bh + bm + "x".repeat(500));
}

// 15. voti di coppia: nomi e profili dal Worker, ognuno vota per se', pagina #/voti
const KA = "aaaaaaaaaaaaaaaa", KB = "bbbbbbbbbbbbbbbb";
const pick = n => R.dests.filter(c => DATA0.raw.dests.find(x => x.code === c).g !== "sconsigliato").slice(0, n);
const [c1, c2, c3, c4, c5] = pick(5);
const ratesBody = extra => ({ok:true, me:"Anna", people:[{k:KA, name:"Anna", me:true}, {k:KB, name:"Bruno", me:false}],
  rates:Object.assign({["d_" + c1]:{[KA]:5, [KB]:4}, ["d_" + c2]:{[KA]:1, [KB]:5}, ["d_" + c3]:{[KB]:0}, ["t_" + firstTrip]:{[KA]:4, [KB]:5}}, extra || {})});
{
  ok(!/Cosimo|Lavi/.test(fs.readFileSync(path.join(ROOT, "v2.js"), "utf8") + fs.readFileSync(path.join(ROOT, "template_v2.html"), "utf8")), "voti: nessun nome di persona scritto nel sito (arrivano dal Worker)");
  // senza Worker: nessun blocco voti; con il Worker ma senza link personale: stelle disattivate e invito a /sito
  ok(!/data-rateblock/.test(boot("", {api:false}).App.pageHTML({page:"dest", id:c1})), "voti senza Worker: nessun blocco");
  const off = boot("#/d/" + c1, {api:true});
  let mk = off.els.app.innerHTML;
  ok(/data-rateblock="d_[A-Z]{3}"/.test(mk) && /class="rt off"/.test(mk) && mk.split('class="rt-s" disabled').length - 1 === 5 && /class="rt-0" disabled/.test(mk), "voti senza login: stelle disattivate");
  ok(/scrivi <b>\/sito<\/b> a @Trip2027_bot/.test(mk) && /start=sito/.test(mk) && !/data-act="rate"/.test(mk), "voti senza login: invito a usare /sito, nessun voto possibile");
  off.nav("#/voti");
  ok(off.App.S.page === "rates" && /scrivi <b>\/sito<\/b>/.test(off.els.app.innerHTML) && !/class="vrow"/.test(off.els.app.innerHTML), "pagina voti senza login: solo l'invito");
  audit("voti senza login", off.els.app.innerHTML);
  await off.App.setRate("d_" + c1, 5);
  ok(Object.keys(off.App.RATE.map).length === 0, "voti senza login: setRate non fa nulla");

  let answer = null; const posts = [], gets = [];
  const d = boot("#/d/" + c1, {api:true, token:"tok.test", fetch:(url, init) => {
    if(init.method === "GET"){ gets.push(url); return Promise.resolve(res(200, url.endsWith("/api/rates") ? ratesBody() : {ok:true, me:"Anna", favs:[]})); }
    posts.push([url, JSON.parse(init.body), init.headers.Authorization]);
    return new Promise(r => { answer = r; });
  }});
  ok(/Carico i voti/.test(d.App.rateBlockIn("d_" + c1, "x")), "voti: stato di caricamento");
  await tick(); await tick(); await tick();
  const A = d.App;
  ok(gets.includes(API_TEST + "/api/rates") && A.RATE.state === "ok" && A.RATE.people.length === 2, "voti: GET /api/rates all'avvio");
  mk = A.rateBlockIn("d_" + c1, "Meta");
  ok(/class="rt-row me"><span class="rt-who">Anna <small>tu<\/small>/.test(mk) && /role="radiogroup" aria-label="Il tuo voto per Meta"/.test(mk) && mk.split('data-act="rate"').length - 1 === 7, "voti: la mia riga è modificabile (0-5 + togli)");
  ok(/data-s="5" aria-checked="true"/.test(mk) && mk.split('class="rt-s on"').length - 1 === 5 && /data-s="0" aria-checked="false"/.test(mk), "voti: il mio 5 è selezionato");
  ok(/<span class="rt-who">Bruno<\/span><span class="rt ro" role="img" aria-label="Bruno: 4 stelle su 5">/.test(mk) && !/data-id="[^"]*"[^>]*>Bruno/.test(mk), "voti: il voto dell'altro si vede ma non si tocca");
  ok(/piace a entrambi/.test(mk) && /media <b class="num">4,5<\/b>/.test(mk), "voti: media e accordo");
  ok(/divisiva/.test(A.rateBlockIn("d_" + c2, "x")) && /non ha ancora votato/.test(A.rateBlockIn("d_" + c4, "x")) && /tocca per votare/.test(A.rateBlockIn("d_" + c4, "x")), "voti: divisiva / non ancora votato");
  ok(/aria-label="0 stelle: da scartare"/.test(mk) && !/class="rt-0 on"/.test(A.rateBlockIn("d_" + c3, "x")), "voti: lo 0 dell'altro non accende il mio 0");
  ok(/Anna <b class="num">5<\/b><i aria-hidden="true">★<\/i> · Bruno <b class="num">4<\/b>/.test(A.rateChipIn("d_" + c1)) && A.rateChipIn("d_" + c5) === "" && /Anna <b class="num">–<\/b> · Bruno <b class="num">0<\/b>/.test(A.rateChipIn("d_" + c3)), "voti: etichetta sulle card");
  audit("voti blocco", mk + "x".repeat(500));
  // voto ottimistico, ritorno indietro, 0 stelle, togliere
  const me = () => (A.RATE.map["d_" + c4] || {})[KA];
  let p = A.setRate("d_" + c4, 3);
  ok(me() === 3 && posts.length === 1 && posts[0][0] === API_TEST + "/api/rate" && posts[0][1].id === "d_" + c4 && posts[0][1].s === 3 && posts[0][2] === "Bearer tok.test" && Object.keys(posts[0][1]).length === 2, "voto: subito sullo schermo, POST /api/rate {id, s} senza indicare per chi");
  A.setRate("d_" + c4, 5);
  ok(posts.length === 1, "voto: un secondo clic durante il salvataggio non parte");
  answer(res(500, {})); await p;
  ok(me() === undefined && /Non sono riuscito a salvare il voto/.test(d.els.toast.textContent), "voto: errore → torna com'era, con avviso");
  p = A.setRate("d_" + c4, 0);
  answer(res(200, ratesBody({["d_" + c4]:{[KA]:0}}))); await p;
  ok(me() === 0 && /Voto salvato: 0 stelle/.test(d.els.toast.textContent) && /class="rt-0 on"/.test(A.rateBlockIn("d_" + c4, "x")), "voto: 0 stelle è un voto vero");
  // clic delegato: stesso valore = toglie
  const click = ds => d.listeners.click.forEach(f => f({target:{id:"", closest:s => s === "[data-act]" ? {dataset:ds, setAttribute(){}, classList:{toggle(){}}, querySelector(){ return null; }} : null}, preventDefault(){}}));
  click({act:"rate", id:"d_" + c4, s:"0"});
  ok(posts[posts.length - 1][1].s === null && me() === undefined, "voto: clic sul valore già dato → toglie il voto (s:null)");
  answer(res(200, ratesBody())); await tick(); await tick();
  click({act:"rate", id:"d_" + c4, s:"2"});
  ok(posts[posts.length - 1][1].s === 2, "voto: clic su una stella → POST con quel valore");
  answer(res(401, {})); await tick(); await tick(); await tick();
  ok(!d.ls["agosto2027.token"] && A.RATE.state === "off" && A.RATE.people.length === 0 && /non vale più/.test(d.els.toast.textContent), "voto: link personale rifiutato → scollegato");

  // pagina #/voti
  const v = boot("#/voti", {api:true, token:"tok.test", fetch:(url, init) => Promise.resolve(res(200, url.endsWith("/api/rates") ? ratesBody() : {ok:true, me:"Anna", favs:[]}))});
  ok(/Carico i voti/.test(v.els.app.innerHTML), "pagina voti: caricamento");
  await tick(); await tick(); await tick();
  const V = v.App;
  mk = v.els.app.innerHTML;
  ok(V.S.page === "rates" && /<b>Anna<\/b> \(tu\) e <b>Bruno<\/b>/.test(mk) && /id="voti-in"/.test(mk), "pagina voti: intestazione con i profili del Worker");
  const names = h => [...h.matchAll(/class="vrow-n" href="#\/([dt])\/([^"]+)"/g)].map(x => x[1] + "_" + x[2]);
  ok(names(mk).join() === ["d_" + c1, "t_" + firstTrip, "d_" + c2, "d_" + c3].join() || names(mk).join() === ["t_" + firstTrip, "d_" + c1, "d_" + c2, "d_" + c3].join(), "classifica: per media decrescente → " + names(mk).join());
  ok(/media <b class="num">4,5<\/b>/.test(mk) && /class="vrow-i num">1</.test(mk) && /Classifica<sup class="num">4<\/sup>/.test(mk) && /Entrambi ≥ 4<sup class="num">2<\/sup>/.test(mk) && /Divisivi<sup class="num">1<\/sup>/.test(mk), "pagina voti: conteggi delle viste");
  ok(/Da votare: tu<sup class="num">\d+<\/sup>/.test(mk) && /Da votare: Bruno<sup/.test(mk) && /hai votato <b>3<\/b> di \d+/.test(mk), "pagina voti: 'da votare' per ciascuno e avanzamento");
  const ids = l => l.map(x => x.id), pool = [...new Set(R.dests.map(c => "d_" + c).concat(R.trips.map(t => "t_" + t)))].map(V.item).filter(Boolean);
  ok(ids(V.votiList("both", pool)).sort().join() === ["d_" + c1, "t_" + firstTrip].sort().join(), "vista 'entrambi ≥ 4'");
  ok(ids(V.votiList("div", pool)).join() === "d_" + c2, "vista 'divisivi' (differenza ≥ 2)");
  const todoA = ids(V.votiList("todo:" + KA, pool)), todoB = ids(V.votiList("todo:" + KB, pool));
  ok(todoA.includes("d_" + c3) && !todoA.includes("d_" + c1) && !todoB.includes("d_" + c3) && todoB.includes("d_" + c5), "vista 'non ancora votati da X'");
  audit("pagina voti", mk);
  const vclick = ds => v.listeners.click.forEach(f => f({target:{id:"", closest:s => s === "[data-act]" ? {dataset:ds, setAttribute(){}} : null}, preventDefault(){}}));
  vclick({act:"vt", k:"view", v:"div"});
  ok(names(v.els["voti-in"].innerHTML).join() === "d_" + c2 && /data-v="div" aria-pressed="true"/.test(v.els["voti-in"].innerHTML), "pagina voti: clic su Divisivi");
  vclick({act:"vt", k:"view", v:"rank"}); vclick({act:"vt", k:"tab", v:"pop"});
  ok(names(v.els["voti-in"].innerHTML).join() === "t_" + firstTrip, "pagina voti: filtro Popular trips");
  vclick({act:"vt", k:"tab", v:"all"}); vclick({act:"vt", k:"view", v:"todo:" + KA});
  const tm = v.els["voti-in"].innerHTML;
  ok(tm.split('class="vrow"').length - 1 === 30 && /data-act="vt-more"/.test(tm) && !/class="vrow-i/.test(tm), "pagina voti: 'da votare' a pagine di 30");
  vclick({act:"vt-more"});
  ok(v.els["voti-in"].innerHTML.split('class="vrow"').length - 1 === 60, "pagina voti: Mostra altre");
  const area = pool.find(x => x.id === "d_" + c2).area;
  v.listeners.change.forEach(f => f({target:{closest:s => s === "select[data-vk]" ? {dataset:{vk:"area"}, value:area} : null}}));
  vclick({act:"vt", k:"view", v:"rank"});
  ok(V.S.v.area === area && names(v.els["voti-in"].innerHTML).every(id => pool.find(x => x.id === id).area === area) && names(v.els["voti-in"].innerHTML).includes("d_" + c2), "pagina voti: filtro per area");
  audit("pagina voti filtrata", v.els["voti-in"].innerHTML + "x".repeat(500));
  ok(/href="#\/voti"/.test(v.els.app.innerHTML.match(/<nav id="topnav"[\s\S]*?<\/nav>/)[0]) && /aria-current="page">Voti/.test(v.els.app.innerHTML), "menu: voce Voti");
}

// 16. confronto affiancato: scelta di 2-3 voci, barra, pagina, link condivisibile
{
  const d = boot("", {api:true, token:"tok.test", fetch:(url, init) => Promise.resolve(res(200, url.endsWith("/api/rates") ? ratesBody() : {ok:true, me:"Anna", favs:[{id:"d_" + c1, by:"Anna", at:"2026-11-20T10:00:00Z", p:null, cur:null}]}))});
  await tick(); await tick(); await tick();
  const A = d.App, bar = () => d.els.cmpbar;
  ok(/data-act="cmp" data-id="d_[A-Z]{3}" aria-pressed="false"/.test(d.els.grid.innerHTML) && /<span class="lbl">Confronta<\/span>/.test(d.els.grid.innerHTML), "confronto: pulsante su ogni card");
  ok(bar().hidden === true, "confronto: barra nascosta finché non si sceglie nulla");
  const withP = R.dests.map(c => A.item("d_" + c)).filter(x => x && x.pp != null && x.totLo != null).slice(0, 2).map(x => x.id), tid = "t_" + firstTrip;
  A.cmpToggle(withP[0]);
  ok(A.CMP.ids.join() === withP[0] && bar().hidden === false && /1 di 3/.test(bar().innerHTML) && /aggiungine un'altra/.test(bar().innerHTML) && d.ls["agosto2027.cmp"] === JSON.stringify([withP[0]]), "confronto: prima voce, barra e scelta salvata sul dispositivo");
  A.cmpToggle(tid); A.cmpToggle(withP[1]);
  ok(A.CMP.ids.length === 3 && /href="#\/confronto"/.test(bar().innerHTML) && /3 di 3/.test(bar().innerHTML), "confronto: tre voci e pulsante Confronta");
  A.cmpToggle("d_" + c5 === withP[0] || "d_" + c5 === withP[1] ? "d_" + c4 : "d_" + c5);
  ok(A.CMP.ids.length === 3 && /al massimo 3/.test(d.els.toast.textContent), "confronto: la quarta non entra, con avviso");
  d.nav("#/confronto");
  let mk = d.els.app.innerHTML;
  ok(A.S.page === "cmp" && bar().hidden === true && /role="table"/.test(mk) && /class="cmp n3 hd2"/.test(mk) && /style="--n:3"/.test(mk), "pagina confronto: tabella a 3 colonne, sul telefono la terza è nascosta");
  ok(mk.split('role="columnheader"').length - 1 === 4 && /class="cmp-r cmp-h" role="row"/.test(mk), "pagina confronto: intestazione (fissa) con le voci");
  for(const lbl of ["Prezzo migliore", "Costo totale stimato", "Date", "Ore di volo", "Scali", "Clima ad agosto", "Voti"]) ok(new RegExp(`role="rowheader">${lbl}`).test(mk), "pagina confronto: riga «" + lbl + "»");
  ok(/class="cmp-pp num">[\d.]+ €<\/b><span class="cmp-s">A\/R · da (Linate|Malpensa|Roma|Pisa)/.test(mk) && /<span class="cmp-s">voli · da /.test(mk), "pagina confronto: prezzo pp con aeroporto (A/R per le mete, voli per i trip)");
  ok(/class="est">stima<\/span><span class="cmp-s">voli \+ a terra [\d.]+ €–[\d.]+ € \(giro «/.test(mk) && /voli \+ interni \+ a terra, \d+ notti/.test(mk) && /coppia [\d.]+ € – [\d.]+ €/.test(mk), "pagina confronto: costo totale stimato");
  ok(/il più basso/.test(mk) && /\d+h \d\dm/.test(mk) && /(diretto|1 scalo|2 scali)/.test(mk) && /<b>\w{3} \d+ ago → \w{3} \d+ ago<\/b>/.test(mk), "pagina confronto: evidenza del migliore, ore di volo, scali, date");
  ok(/class="cmp-v"><span class="rt-who">Anna<\/span>/.test(mk) && /aria-label="Bruno: 5 stelle su 5"/.test(mk) && /la più votata|media <b/.test(mk), "pagina confronto: voti di entrambi");
  ok(/class="cmp-pick"/.test(mk) && mk.split('data-act="cmp-hide"').length - 1 === 3 && /data-i="2" aria-pressed="true"/.test(mk), "pagina confronto: sul telefono si sceglie quale colonna nascondere");
  audit("pagina confronto", mk);
  const click = ds => d.listeners.click.forEach(f => f({target:{id:"", closest:s => s === "[data-act]" ? {dataset:ds, setAttribute(){}} : null}, preventDefault(){}}));
  click({act:"cmp-hide", i:"0"});
  ok(/class="cmp n3 hd0"/.test(d.els.app.innerHTML), "pagina confronto: cambio della colonna nascosta");
  click({act:"cmp", id:tid});
  mk = d.els.app.innerHTML;
  ok(A.CMP.ids.length === 2 && /class="cmp n2"/.test(mk) && !/class="cmp-pick"/.test(mk) && !mk.includes(`href="#/t/${firstTrip}"`), "pagina confronto: Togli → due colonne, niente selettore");
  click({act:"cmp-clear"});
  ok(A.CMP.ids.length === 0 && /Scegli 2 o 3 mete o giri/.test(d.els.app.innerHTML) && d.ls["agosto2027.cmp"] === "[]", "confronto: svuota");
  d.nav(`#/confronto/${withP[0]},${tid},d_XXX,${withP[0]}`);
  ok(A.CMP.ids.join() === [withP[0], tid].join() && /class="cmp n2"/.test(d.els.app.innerHTML), "confronto: link con le voci nell'indirizzo (sconosciute e doppie scartate)");
  d.nav("#/preferiti"); await tick(); await tick();
  ok(new RegExp(`class="pill cmpp[^"]*" data-act="cmp" data-id="d_${c1}"`).test(d.els.app.innerHTML), "confronto: si sceglie anche dai preferiti");
  ok(/data-act="cmp" data-id="d_/.test(A.pageHTML({page:"dest", id:c1})) && /data-act="cmp" data-id="t_/.test(A.pageHTML({page:"trip", id:firstTrip})), "confronto: pulsante nelle pagine di meta e trip");
  // scelta ritrovata al caricamento successivo; senza Worker il confronto funziona lo stesso, senza riga dei voti
  const again = boot("#/confronto", {api:false, ls:{"agosto2027.cmp":JSON.stringify([withP[0], withP[1], "boh", 7])}});
  mk = again.els.app.innerHTML;
  ok(again.App.CMP.ids.join() === withP.join() && /class="cmp n2"/.test(mk) && !/role="rowheader">Voti/.test(mk), "confronto: scelta ritrovata dal dispositivo, senza Worker niente riga voti");
  audit("pagina confronto senza Worker", mk);
  const one = boot("#/confronto", {ls:{"agosto2027.cmp":JSON.stringify([withP[0]])}});
  ok(/Hai scelto solo/.test(one.els.app.innerHTML) && !/role="table"/.test(one.els.app.innerHTML), "confronto: con una sola voce invita ad aggiungerne un'altra");
}

// 17. mappa: mete con coordinate, colore per fascia di prezzo, legenda, clic → pagina meta
{
  const W = JSON.parse(WORLD_TXT);
  ok(W.w === 1000 && W.d.length > 10000 && /^M[\d. -]+L/.test(W.d) && !/NaN|e-|[\d.]{9}/.test(W.d) && WORLD_TXT.length < 80000, "world.json: contorno leggero e valido (" + WORLD_TXT.length + " caratteri)");
  ok(DATA0.raw.dests.every(x => typeof x.lat === "number" && typeof x.lon === "number" && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180), "mappa: ogni meta ha lat/lon");
  let answer = null; const calls = [];
  const d = boot("#/mappa", {fetch:url => { calls.push(url); return new Promise(r => { answer = r; }); }});
  const A = d.App;
  let mk = d.els.app.innerHTML;
  ok(A.S.page === "map" && calls.join() === "world.json" && /Carico la mappa/.test(mk) && !/class="mland"/.test(mk), "mappa: il contorno si scarica solo qui, punti già visibili");
  const good = DATA0.raw.dests.filter(x => x.g !== "sconsigliato");
  ok(mk.split('<a class="mp ').length - 1 === good.length && A.mapPoints().length === good.length, "mappa: un punto per meta (" + good.length + ")");
  const [mx, my] = A.mapXY(45.46, 9.19), dps = A.mapPoints().find(p => p.d.code === "DPS");
  ok(Math.abs(mx - 525.5) < 0.2 && Math.abs(my - 101.5) < 0.2 && (!dps || (dps.x > 800 && dps.y > 240)), "mappa: proiezione equirettangolare (Milano a " + mx + "," + my + ")");
  const pts = A.mapPoints(), priced = pts.filter(p => p.pp != null);
  ok(priced.length > 10 && priced.every(p => p.bin === (p.pp <= 600 ? 0 : p.pp <= 900 ? 1 : p.pp <= 1200 ? 2 : p.pp <= 1600 ? 3 : 4)) && pts.filter(p => p.pp == null).every(p => p.bin === -1), "mappa: fasce di prezzo 600 / 900 / 1.200 / 1.600");
  const one = priced[0];
  ok(new RegExp(`<a class="mp m${one.bin}" href="#/d/${one.d.code}" aria-label="[^"]*: [\\d.]+ € a persona da [^"]+"><title>`).test(mk), "mappa: ogni punto è un link alla meta, con nome e prezzo");
  ok(/class="mleg"/.test(mk) && /fino a 600 €/.test(mk) && /oltre 1\.600 €/.test(mk) && /voli non ancora in vendita/.test(mk) && /Più intenso = più economico/.test(mk) && mk.split('<i class="mk m').length - 1 >= 5, "mappa: legenda con le fasce");
  ok(/<details class="mlist"/.test(mk) && mk.slice(mk.indexOf("<details class=\"mlist\"")).split("<li><i class=\"mk ").length - 1 === good.length, "mappa: elenco testuale di tutte le mete in vista");
  ok(!/NaN|undefined|Infinity/.test((mk.match(/(cx|cy|r|x|y|viewBox|font-size)="[^"]*"/g) || []).join("")), "mappa: coordinate valide");
  audit("mappa", mk);
  answer(res(200, W)); await tick(); await tick(); await tick();
  ok(A.WORLD.state === "ok" && /<path class="mland" d="M/.test(d.els["map-in"].innerHTML) && !/Carico la mappa/.test(d.els["map-in"].innerHTML), "mappa: continenti disegnati quando arriva world.json");
  const click = ds => d.listeners.click.forEach(f => f({target:{id:"", closest:s => s === "[data-act]" ? {dataset:ds, setAttribute(){}} : null}, preventDefault(){}}));
  click({act:"mp", k:"zoom", v:"Africa"});
  mk = d.els["map-in"].innerHTML;
  const inAfr = good.filter(x => x.lon >= -28 && x.lon <= 64 && x.lat >= -37 && x.lat <= 40).length;
  ok(/class="map z-zone" viewBox="422\.2 116\.7 255\.6 213\.[89]"/.test(mk) && mk.split('<a class="mp ').length - 1 === inAfr && /<details class="mlist" open>/.test(mk), "mappa: zona Africa (" + inAfr + " mete) → " + (mk.match(/viewBox="[^"]+"/) || [""])[0]);
  click({act:"mp", k:"zoom", v:"world"}); click({act:"mp", k:"tab", v:"vis"});
  ok(d.els["map-in"].innerHTML.split('<a class="mp ').length - 1 === good.filter(x => x.tab === "vis").length, "mappa: filtro Già visitati");
  audit("mappa filtrata", d.els["map-in"].innerHTML);
  const e = boot("#/mappa", {fetch:() => Promise.resolve(res(404, {}))});
  await tick(); await tick(); await tick();
  ok(e.App.WORLD.state === "error" && /data-act="map-retry"/.test(e.els["map-in"].innerHTML) && e.els["map-in"].innerHTML.split('<a class="mp ').length - 1 === good.length, "mappa: senza contorno i punti restano e si può riprovare");
  ok(/href="#\/mappa"/.test(boot("", {api:false}).els.app.innerHTML.match(/<nav id="topnav"[\s\S]*?<\/nav>/)[0]), "menu: voce Mappa anche senza Worker");
}

console.log(`${checks} controlli, ${fails} falliti · pagine: ${R.dests.length} mete, ${R.trips.length} trip · origini nei dati: ${R.origins.join(", ")} · img in home: ${RAWn.d}/${RAWn.v}/${RAWn.p}`);
process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
