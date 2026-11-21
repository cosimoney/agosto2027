/* Test Node della pagina v2 con un DOM minimale: node test_v2.js
   Controlla: home (3 sezioni), una pagina dettaglio per sezione, deep link come primo caricamento,
   niente undefined/NaN nel markup, tutte le immagini referenziate esistono in img/. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "agosto-2027-v2.html"), "utf8");
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if(!m) throw new Error("script non trovato");
if(!/<title>Agosto 2027 da Milano<\/title>/.test(html)) throw new Error("title errato");
if(/\/\*__(CSS|JS|DATA|PHOTOS)__\*\//.test(html)) throw new Error("segnaposto non sostituito");

function boot(hash){
  const els = {};
  const mk = id => ({id, innerHTML:"", textContent:"", hidden:false, value:"", placeholder:"", open:false, dataset:{}, style:{},
    classList:{toggle(){}, add(){}, remove(){}}, setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, addEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; }, appendChild(){}, scrollIntoView(){}, close(){}, showModal(){}, closest(){ return null; }});
  const listeners = {};
  const document = {title:"", hidden:false, getElementById:id => els[id] || (els[id] = mk(id)), querySelectorAll:() => [], querySelector:() => null,
    createElement:() => mk("x"), addEventListener:(t, f) => { (listeners[t] = listeners[t] || []).push(f); }};
  const window = {scrollY:0, scrollTo(){}, addEventListener:(t, f) => { (listeners["w:" + t] = listeners["w:" + t] || []).push(f); }, matchMedia:() => ({matches:true})};
  const ctx = {document, window, location:{hash}, history:{scrollRestoration:"auto", back(){}}, console, setInterval:() => 0, clearInterval(){}, setTimeout, requestAnimationFrame:f => f(),
    Image:function(){}, btoa:s => Buffer.from(s, "binary").toString("base64"), encodeURIComponent, decodeURIComponent};
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx, {filename:"v2.js"});
  return {ctx, els, App:window.App, nav(h){ ctx.location.hash = h; listeners["w:hashchange"].forEach(f => f()); }, listeners};
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

console.log(`${checks} controlli, ${fails} falliti · pagine: ${R.dests.length} mete, ${R.trips.length} trip · origini nei dati: ${R.origins.join(", ")} · img in home: ${RAWn.d}/${RAWn.v}/${RAWn.p}`);
process.exit(fails ? 1 : 0);
