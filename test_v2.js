/* Test Node della pagina v2 con un DOM minimale: node test_v2.js
   Controlla: home (3 sezioni), una pagina dettaglio per sezione, deep link come primo caricamento,
   niente undefined/NaN nel markup, tutte le immagini referenziate esistono in img/.
   Preferiti: senza Worker o senza token la stella resta il link Telegram; con il token (Worker finto) stella piena/vuota,
   toggle ottimistico con ritorno indietro se il Worker fallisce, pagina #/preferiti, rotta #/login/<token>.
   Andamento del prezzo: grafico dello storico su mete e trip, Giorno / Settimana / Mese, serie per città, pochi dati, dato parziale. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "agosto-2027-v2.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if(!m) throw new Error("script non trovato");
if(!/<title>Agosto 2027 da Milano<\/title>/.test(html)) throw new Error("title errato");
if(/\/\*__(CSS|JS|DATA|PHOTOS|API)__\*\//.test(html)) throw new Error("segnaposto non sostituito");
if(!/<div class="toast" id="toast"[^>]*hidden>/.test(html)) throw new Error("toast mancante nel template");
const API_TEST = "https://worker.test";

// opts: {api: true = sito collegato al Worker finto, token: token gia' salvato nel dispositivo, fetch: (url, init) => Promise<Response finta>}
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
  const els = {};
  const mk = id => ({id, innerHTML:"", textContent:"", hidden:false, value:"", placeholder:"", open:false, dataset:{}, style:{},
    classList:{toggle(){}, add(){}, remove(){}, contains(){ return false; }}, setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, addEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; }, appendChild(){}, scrollIntoView(){}, close(){}, showModal(){}, closest(){ return null; }});
  const listeners = {};
  const document = {title:"", hidden:false, getElementById:id => els[id] || (els[id] = mk(id)), querySelectorAll:() => [], querySelector:() => null,
    createElement:() => mk("x"), addEventListener:(t, f) => { (listeners[t] = listeners[t] || []).push(f); }};
  const window = {scrollY:0, scrollTo(){}, addEventListener:(t, f) => { (listeners["w:" + t] = listeners["w:" + t] || []).push(f); }, matchMedia:() => ({matches:true})};
  const ctx = {document, window, location:{hash}, history:{scrollRestoration:"auto", back(){}}, console, setInterval:() => 0, clearInterval(){}, setTimeout, requestAnimationFrame:f => f(),
    Image:function(){}, btoa:s => Buffer.from(s, "binary").toString("base64"), encodeURIComponent, decodeURIComponent, clearTimeout(){},
    localStorage:{getItem:k => (k in ls ? ls[k] : null), setItem:(k, v) => { ls[k] = String(v); }, removeItem:k => { delete ls[k]; }},
    fetch:opts.fetch || (() => Promise.reject(new Error("rete non prevista in questo test")))};
  ctx.setTimeout = () => 0;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, {filename:"v2.js"});
  return {ctx, els, ls, App:window.App, nav(h){ ctx.location.hash = h; listeners["w:hashchange"].forEach(f => f()); }, listeners};
}
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if(!c){ fails++; console.log("FAIL", msg); } };
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
const R = vm.runInContext("({dests:RAW.dests.map(d=>d.code), trips:RAW.trips_popular.trips.map(t=>t.id), origins:[...new Set(RAW.combos.map(c=>c.o))]})", b.ctx);
let nimg = 0;
for(const c of R.dests) nimg += audit("d/" + c, b.App.pageHTML({page:"dest", id:c}));
for(const t of R.trips) nimg += audit("t/" + t, b.App.pageHTML({page:"trip", id:t}));
audit("crediti", b.App.pageHTML({page:"credits"}));
audit("404", b.App.pageHTML({page:"dest", id:"XXX"}) + b.App.pageHTML({page:"trip", id:"<script>"}));
ok(!/<script>/.test(b.App.pageHTML({page:"trip", id:"<script>"})), "escape dell'id nella pagina non trovata");
ok(b.App.parse("#/d/dps").id === "DPS" && b.App.parse("#/t/sri-lanka").id === "sri-lanka" && b.App.parse("#/boh").page === "home", "parse delle rotte");


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

console.log(`${checks} controlli, ${fails} falliti · pagine: ${R.dests.length} mete, ${R.trips.length} trip · origini nei dati: ${R.origins.join(", ")} · img in home: ${RAWn.d}/${RAWn.v}/${RAWn.p}`);
process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
