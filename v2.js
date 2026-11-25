/* Agosto 2027 v2: sito di viaggio a pagine (hash routing). Dati: RAW (build.py + build_trips.py), foto: PH (img/manifest.json).
   Rotte: #/ (nuove mete) · #/visitati · #/trips · #/d/<IATA> · #/t/<trip.id> · #/preferiti · #/login/<token> · #/<alias> (PIN) · #/crediti
          #/voti (voti di coppia, solo sui giri completi) · #/confronto[/id,id,id] (fianco a fianco) · #/mappa
   Preferiti: se API (base del Worker Cloudflare, da bot/config.json "worker_url") e' valorizzata e il dispositivo ha un
   token personale (link #/login/<token> mandato dal bot con /sito), la stella salva subito via Worker; altrimenti apre Telegram. */
"use strict";
const BOT_USERNAME = "Trip2027_bot";
const API = "/*__API__*/".replace(/\/+$/, "");
const WEEKEND_URL = "https://cosimoney.github.io/flightsMI/";
/* I dati non stanno piu' nella pagina: data.json (accanto a index.html) viene scaricato all'avvio e passato a start().
   Con window.__DATA__ gia' presente (build_v2.py --inline, test) si parte subito senza rete. */
const DATA_URL = "/*__DATA_URL__*/";
const WORLD_URL = "world.json";
function start(RAW, PH){

/* ------------------------------------------------------------------ base */
const MESI = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const GIORNI = ["dom","lun","mar","mer","gio","ven","sab"];
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = n => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ".");
const eur = n => num(n) + " €";
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const dt = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtD = iso => { const x = dt(iso); return `${GIORNI[x.getDay()]} ${x.getDate()} ${MESI[x.getMonth()]}`; };
const addD = (iso, n) => { const x = dt(iso); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const hm = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const clamp = x => Math.max(0, Math.min(1, x));
const host = u => String(u).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
const safeUrl = u => /^https?:\/\//i.test(String(u)) ? String(u) : "#";
const uniq = a => [...new Set(a)];

const DESTS = RAW.dests || [], COMBOS = RAW.combos || [], META = RAW.meta || {}, COV = RAW.cov || {}, ITIN = RAW.trips || {};
const DEST = Object.fromEntries(DESTS.map(d => [d.code, d]));
const CL = RAW.clima || {ottimo:1, buono:.8, accettabile:.5};
const CL_RANK = {ottimo:0, buono:1, accettabile:2, sconsigliato:3};
const POP = RAW.trips_popular || {trips:[], legs:[], city:{}, styles:[], skipped:[], clima:CL, meta:{}};
const PT = Object.fromEntries(POP.trips.map(t => [t.id, t]));
const BYD = {};
for(const c of COMBOS) (BYD[c.d] = BYD[c.d] || []).push(c);
const ALL_DEPS = uniq(COMBOS.map(c => c.dep).concat(POP.trips.flatMap(t => t.cells.map(c => c.dep)))).sort();

/* aeroporti di partenza: arrivano come valori del campo origine (c.o). Si confrontano solo i prezzi dei voli. */
const ONAME = {LIN:"Linate", MXP:"Malpensa", FCO:"Roma", CIA:"Roma Ciampino", PSA:"Pisa"};
const OSEL = [["all","Tutti"],["LIN","Linate"],["MXP","Malpensa"],["ROM","Roma"],["PSA","Pisa"]];
const OORDER = ["LIN","MXP","FCO","CIA","PSA"];
const oName = o => ONAME[o] || o;
const oKey = o => (o === "FCO" || o === "CIA") ? "ROM" : o;
const oMatch = (o, sel) => sel === "all" || oKey(o) === sel || (sel === "MIL" && (o === "LIN" || o === "MXP"));
const CITIES = [["MIL", "Milano"], ["ROM", "Roma"], ["PSA", "Pisa"]];
// migliori prezzi affiancati per citta' di partenza; view(gruppo) -> aggregato o null, line(aggregato) -> [prezzo, riga piccola]
function byCity(view, cur, line){
  const items = CITIES.map(([g, name]) => [g, name, view(g)]).filter(x => x[2]);
  if(items.length < 2) return "";
  const lo = Math.min(...items.map(x => line(x[2])[0]));
  return `<div class="byc" role="group" aria-label="Miglior prezzo per città di partenza">${items.map(([g, name, a]) => { const [pr, sm] = line(a); return `<button class="byc-i${pr === lo ? " lo" : ""}" data-k="origin" data-v="${cur === g ? "all" : g}" aria-pressed="${cur === g}"><span class="l">da ${name}${pr === lo ? " · il più basso" : ""}</span><b class="num">${eur(pr)} <small>pp</small></b><span class="s">${sm}</span></button>`; }).join("")}</div>`;
}
const oRank = o => { const i = OORDER.indexOf(o); return i < 0 ? 9 : i; };
const HAS_O = new Set(COMBOS.map(c => oKey(c.o)).concat(POP.trips.flatMap(t => t.cells.map(c => oKey(c.o)))));

/* ------------------------------------------------------------------ foto */
const PHO = PH.photos || {};
const stageKey = name => { const n = norm(name); for(const [a, k] of PH.stage || []) if(PHO[k] && n.includes(a)) return k; return null; };
const coverD = code => (PH.cover || {})[code] && PHO[PH.cover[code]] ? PH.cover[code] : null;
function coverT(t){
  const k = (PH.pop || {})[t.id];
  if(k && PHO[k]) return k;
  for(const s of t.stages){ const x = stageKey(s[0]); if(x) return x; }
  return coverD(t.arr) || coverD(t.dep);
}
function galleryD(code){
  const cov = coverD(code), ks = ((PH.gallery || {})[code] || []).slice();
  for(const t of ITIN[code] || []) for(const s of t.t){ const k = stageKey(s[0]); if(k) ks.push(k); }
  return uniq(ks).filter(k => PHO[k] && k !== cov).slice(0, 5);
}
function galleryT(t){
  const cov = coverT(t), ks = t.stages.map(s => stageKey(s[0])).filter(Boolean);
  for(const c of [t.arr, t.dep]){ if(coverD(c)) ks.push(coverD(c)); for(const k of (PH.gallery || {})[c] || []) ks.push(k); }
  return uniq(ks).filter(k => PHO[k] && k !== cov).slice(0, 5);
}
// varianti ridotte (p.s = larghezze presenti in img/, vedi photo_variants.py): il browser sceglie con srcset + sizes.
// Su telefono le card dichiarano 66vw: a densita' 3 basta la variante da 800 px, la differenza non si vede.
// La copertina riempie lo schermo in altezza (object-fit: cover), quindi sul telefono e' piu' larga dello schermo: 150vw.
const SIZES = {card:"(max-width:620px) 66vw, (max-width:1000px) 50vw, 420px", feat:"(max-width:620px) 66vw, (max-width:1000px) 50vw, 840px",
  hero:"(max-width:720px) 150vw, 100vw", full:"100vw", gal:"(max-width:720px) 66vw, 40vw", thumb:"120px"};
const variant = (f, w) => f.replace(/\.webp$/, "-" + w + ".webp");
const srcsetOf = p => (p.s || []).length ? p.s.map(w => `${variant(p.f, w)} ${w}w`).concat(`${p.f} ${p.w}w`).join(", ") : "";
function img(k, o){
  const p = PHO[k]; o = o || {};
  const ss = srcsetOf(p);
  return `<img src="${esc(p.f)}"${ss ? ` srcset="${esc(ss)}" sizes="${SIZES[o.sz] || SIZES.card}"` : ""} width="${p.w}" height="${p.h}" alt="${esc(o.alt || p.cap)}"${o.eager ? ` fetchpriority="high"` : ` loading="lazy"`} decoding="async"${o.cls ? ` class="${o.cls}"` : ""}>`;
}
const creditTxt = k => { const p = PHO[k]; return p ? `Foto: <a href="${esc(safeUrl(p.src))}" target="_blank" rel="noopener">${esc(p.by)}</a> · ${esc(p.lic)}` : ""; };
const noPhoto = txt => `<span class="nophoto" aria-hidden="true">${esc(txt)}</span>`;

/* ------------------------------------------------------------------ stato */
const F0 = {q:"", origin:"all", area:"all", country:"all", budget:0, stops:1, dur:"all", dep:"all", clima:"all", sort:"score"};
const P0 = {q:"", origin:"all", kind:"all", area:"all", style:"all", budget:0, stops:1, sort:"tot"};
const S = {tab:"new", f:Object.assign({}, F0), p:Object.assign({}, P0), panel:false, cell:null, homeY:0, depth:0, route:null, page:null, lb:[], lbi:0, heroT:null, h:{per:"day", off:{}},
  c:{hide:2}, v:{view:"rank", area:"all", sort:"auto", max:"0", n:30}, m:{tab:"all", zoom:"world"}};
const TABS = {new:{hash:"#/", label:"Nuove mete", sub:"Paesi dove non siete mai stati, scelti per il clima di agosto."},
              vis:{hash:"#/visitati", label:"Già visitati", sub:"Paesi che conoscete già, con un giro diverso da quello fatto."},
              pop:{hash:"#/trips", label:"Popular trips", sub:"Itinerari completi, anche open-jaw: tappe, voli e costo a terra."}};
const favUrl = id => `https://t.me/${BOT_USERNAME}?start=fav_${encodeURIComponent(id)}`;
const star = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>`;

/* ------------------------------------------------------------------ preferiti (Worker) */
// FAV.state: off (nessun Worker) | anon (manca il token) | loading | ok | expired (token non piu' valido) | error (rete)
const TOKEN_KEY = "agosto2027.token";
const FAV = {token:"", map:new Map(), me:"", state:"off", busy:new Set(), toastT:null};
function readToken(){ try { return localStorage.getItem(TOKEN_KEY) || ""; } catch(e){ return ""; } }
function saveToken(v){
  FAV.token = v || "";
  try { if(v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch(e){ /* navigazione privata: il token resta solo in memoria */ }
}
const favLive = () => !!(API && FAV.token);
// Indirizzo corto #/<alias>: chi e' entrato con il PIN su questo dispositivo ({alias, name}). Gli alias li conosce solo il Worker.
const WHO_KEY = "agosto2027.who";
function readWho(){ try { const w = JSON.parse(localStorage.getItem(WHO_KEY) || "null"); return w && typeof w.alias === "string" ? w : null; } catch(e){ return null; } }
function saveWho(w){ try { if(w) localStorage.setItem(WHO_KEY, JSON.stringify(w)); else localStorage.removeItem(WHO_KEY); } catch(e){ /* resta la sessione in memoria */ } FAV.who = w || null; }
const favOn = id => FAV.map.has(id);
async function favCall(path, body){
  const r = await fetch(API + path, {method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    headers: Object.assign({Authorization: "Bearer " + FAV.token}, body ? {"Content-Type": "application/json"} : {})});
  if(r.status === 401){ const e = new Error("unauthorized"); e.auth = true; throw e; }
  if(!r.ok) throw new Error("http " + r.status);
  return r.json();
}
function favApply(j){ FAV.map = new Map((j.favs || []).map(f => [f.id, f])); FAV.me = j.me || ""; FAV.state = "ok"; }
function favExpired(){ saveToken(""); saveWho(null); FAV.map = new Map(); FAV.me = ""; FAV.state = "expired"; rateReset(); }
function favPaint(){
  document.querySelectorAll("[data-act='fav']").forEach(el => {
    const on = favOn(el.dataset.id), l = el.querySelector(".lbl");
    el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on)); el.setAttribute("title", on ? "Togli dai preferiti" : "Salva tra i preferiti");
    if(l) l.textContent = on ? "Nei preferiti" : "Salva tra i preferiti";
  });
  if(S.page === "favs") $("app").innerHTML = favsHTML();
}
async function loadFavs(){
  if(!favLive()) return;
  if(FAV.state !== "ok") FAV.state = "loading";
  try { favApply(await favCall("/api/favs")); }
  catch(e){ if(e.auth) favExpired(); else if(FAV.state !== "ok") FAV.state = "error"; }
  favPaint();
}
function toast(msg){
  const el = $("toast"); if(!el) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(FAV.toastT); FAV.toastT = setTimeout(() => { el.hidden = true; }, 3600);
}
// ottimistico: la stella cambia subito; se il Worker non conferma torna com'era
async function toggleFav(id){
  if(!favLive() || FAV.busy.has(id)) return;
  const was = FAV.map.get(id), on = !was;
  FAV.busy.add(id);
  if(on) FAV.map.set(id, {id, by:FAV.me, at:new Date().toISOString(), p:null, cur:null}); else FAV.map.delete(id);
  favPaint();
  try { favApply(await favCall("/api/fav", {id, on})); toast(on ? "Salvato tra i preferiti" : "Tolto dai preferiti"); }
  catch(e){
    if(was) FAV.map.set(id, was); else FAV.map.delete(id);
    if(e.auth){ favExpired(); toast("Il link personale non vale più: chiedine uno nuovo al bot con /sito"); }
    else toast("Non sono riuscito a salvare. Riprova tra poco.");
  }
  FAV.busy.delete(id);
  favPaint();
}
const favBtn = (id, name) => favLive()
  ? `<button class="fav${favOn(id) ? " on" : ""}" data-act="fav" data-id="${esc(id)}" aria-pressed="${favOn(id)}" aria-label="${esc(name)} tra i preferiti" title="${favOn(id) ? "Togli dai preferiti" : "Salva tra i preferiti"}">${star}</button>`
  : `<a class="fav" href="${favUrl(id)}" target="_blank" rel="noopener" aria-label="Salva ${esc(name)} tra i preferiti su Telegram" title="Salva tra i preferiti (Telegram)">${star}</a>`;
const favCta = id => favLive()
  ? `<button class="btn ghost${favOn(id) ? " on" : ""}" data-act="fav" data-id="${esc(id)}" aria-pressed="${favOn(id)}">${star} <span class="lbl">${favOn(id) ? "Nei preferiti" : "Salva tra i preferiti"}</span></button>`
  : `<a class="btn ghost" href="${favUrl(id)}" target="_blank" rel="noopener">${star} Salva tra i preferiti</a>`;

/* ------------------------------------------------------------------ destinazioni: logica */
// volo: [prezzo, compagnie, durataMin andata, scali, partenza, arrivo, giorni+, scali via, da, a]
function scoreOf(f, d){
  const price = clamp((2200 - f[0]) / 1700);
  const comfort = 0.5 * [1, 0.7, 0.3][Math.min(f[3], 2)] + 0.5 * clamp((32 * 60 - f[2]) / (25 * 60));
  return Math.round(100 * (0.5 * price + 0.25 * comfort + 0.25 * (CL[d.g] || 0)));
}
function options(c, stops){
  const out = (c.a || []).filter(f => f[3] <= stops).map(f => ({f, two:false}));
  if(stops >= 2 && c.b && c.a.length){
    const p1 = c.a[0][0];
    out.push({f:c.b, two:true, save:p1 - c.b[0], pct:Math.round(100 * (p1 - c.b[0]) / p1)});
  }
  return out.sort((x, y) => x.f[0] - y.f[0]);
}
function match(c, skip){
  const f = S.f, d = DEST[c.d];
  if(!d || d.tab !== S.tab || d.g === "sconsigliato") return false;
  if(skip !== "origin" && !oMatch(c.o, f.origin)) return false;
  if(skip !== "area" && f.area !== "all" && d.area !== f.area) return false;
  if(skip !== "country" && f.country !== "all" && d.country !== f.country) return false;
  if(skip !== "dur" && f.dur !== "all" && c.n !== +f.dur) return false;
  if(skip !== "dep" && f.dep !== "all" && c.dep !== f.dep) return false;
  if(skip !== "clima" && f.clima === "ottimo" && d.g !== "ottimo") return false;
  if(skip !== "clima" && f.clima === "buono" && CL_RANK[d.g] > 1) return false;
  if(f.q && !norm(d.city + " " + d.country + " " + d.code + " " + d.area).includes(norm(f.q))) return false;
  const o = options(c, f.stops);
  if(!o.length) return false;
  if(skip !== "budget" && f.budget && o[0].f[0] > f.budget) return false;
  return true;
}
function fold(d, cs, stops){
  const a = {d, min:Infinity, max:0, n:0, best:null, bestS:-1, cheap:null, origins:new Set(), cellBest:{}};
  for(const c of cs){
    const o = options(c, stops)[0];
    if(!o) continue;
    const s = scoreOf(o.f, d), k = c.dep + "|" + c.n, p = o.f[0];
    a.n++; a.origins.add(c.o);
    if(p < a.min || (p === a.min && oRank(c.o) < oRank(a.cheap.c.o))){ a.min = p; a.cheap = {c, o}; }
    a.max = Math.max(a.max, p);
    if(s > a.bestS){ a.bestS = s; a.best = {c, o}; }
    const cb = a.cellBest[k];
    if(!cb || p < cb.o.f[0] || (p === cb.o.f[0] && oRank(c.o) < oRank(cb.c.o))) a.cellBest[k] = {c, o};
  }
  return a.n ? a : null;
}
function aggD(){
  const groups = new Map();
  for(const c of COMBOS){ if(!match(c, null)) continue; (groups.get(c.d) || groups.set(c.d, []).get(c.d)).push(c); }
  const list = [...groups].map(([code, cs]) => fold(DEST[code], cs, S.f.stops)).filter(Boolean);
  const by = {
    score: (x, y) => y.bestS - x.bestS || x.min - y.min,
    price: (x, y) => x.min - y.min || y.bestS - x.bestS,
    clima: (x, y) => CL_RANK[x.d.g] - CL_RANK[y.d.g] || y.bestS - x.bestS,
  };
  return list.sort(by[S.f.sort] || by.score);
}
const viewD = (code, origin, stops) => fold(DEST[code], (BYD[code] || []).filter(c => oMatch(c.o, origin)), stops);
const stopsTxt = f => f[3] === 0 ? "diretto" : `${f[3]} ${f[3] === 1 ? "scalo" : "scali"}${f[7] ? " · " + esc(f[7]) : ""}`;
const climaCls = g => g === "ottimo" ? "ok" : g === "buono" ? "info" : "warn";
const EST_TXT = META.estNote || "stima: somma di due solo andata";
const estBadge = c => c && c.e ? `<span class="est" title="Google Flights non restituisce l'A/R su questa rotta: il prezzo è la somma del miglior solo andata e del miglior ritorno nelle stesse date. L'A/R vero di solito costa meno.">${esc(EST_TXT)}</span>` : "";
const priceU = c => c && c.e ? "a persona · stima" : "a persona · A/R";
const twoBadge = o => o.two ? `<span class="b warn wrapb">2 scali: risparmi ${eur(o.save)} pp (${o.pct}%)</span>` : "";
// badge aeroporto dell'offerta mostrata (o = aeroporto di quell'offerta); "anche da Linate" se esiste un'opzione da LIN
function oBadge(o, set, glass){
  const pl = glass ? "glass" : "plain";
  return o === "LIN" ? `<span class="b ${glass ? "sun" : "ok"}">da Linate</span>` : `<span class="b ${pl}">da ${esc(oName(o))}</span>` + (set.has("LIN") ? `<span class="b ${glass ? "sun" : "ok"}">anche da Linate</span>` : "");
}
function alsoBadge(o, set){
  const rest = uniq([...set].filter(x => x !== o && x !== "LIN").sort((x, y) => oRank(x) - oRank(y)).map(oName));
  return rest.length ? `<span class="b plain">anche ${esc(rest.join(", "))}</span>` : "";
}
function originBadges(set){
  const os = [...set].sort((x, y) => oRank(x) - oRank(y)), rest = uniq(os.filter(o => o !== "LIN").map(oName));
  return (set.has("LIN") ? `<span class="b ok">da Linate</span>` : "") + (rest.length ? `<span class="b plain">${set.has("LIN") ? "anche " : "da "}${esc(rest.join(", "))}</span>` : "");
}
const gfD = (o, code, dep, ret) => `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${o} to ${code} on ${dep} through ${ret}`)}&curr=EUR&hl=it`;

/* ------------------------------------------------------------------ popular trips: logica */
const L = POP.legs, PCL = POP.clima || CL;
const cityOf = c => (POP.city || {})[c] || c;
const mid = t => (t.land[0] + t.land[1]) / 2;
function tfs(segs, trip){
  const str = s => [...s].map(c => c.charCodeAt(0));
  const ld = (tag, bytes) => [tag, bytes.length, ...bytes];
  let out = [];
  for(const [date, from, to] of segs)
    out = out.concat(ld(0x1a, [...ld(0x12, str(date)), ...ld(0x6a, ld(0x12, str(from))), ...ld(0x72, ld(0x12, str(to)))]));
  out = out.concat([0x42, 1, 1, 0x48, 1, 0x98, 0x01, trip]);
  const b64 = typeof btoa === "function" ? btoa(String.fromCharCode.apply(null, out)) : Buffer.from(out).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_");
}
const gfUrl = (segs, trip) => `https://www.google.com/travel/flights/search?tfs=${tfs(segs, trip)}&hl=it&curr=EUR`;
// opzione = [indice air, prezzo voli Google pp, extra stimato pp, leg andata, leg ritorno | -1]
function pview(t, op, two, ref){
  const a = t.air[op[0]], fl = op[1], extra = op[2], out = L[op[3]], back = op[4] >= 0 ? L[op[4]] : null;
  const interni = t.itot + extra;
  const v = {op, a, two:!!two, voli:fl, extra, interni, out, back, lo:fl + interni + t.land[0], hi:fl + interni + t.land[1], tot:Math.round(fl + interni + mid(t))};
  if(two && ref){ v.save = (ref.voli + ref.extra) - (fl + extra); v.pct = Math.round(100 * v.save / (ref.voli + ref.extra)); }
  return v;
}
function poptions(t, c, stops){
  const out = (c.a || []).map(op => pview(t, op, false));
  if(stops >= 2 && c.b && out.length) out.push(pview(t, c.b, true, out[0]));
  return out.sort((x, y) => (x.voli + x.extra) - (y.voli + y.extra));
}
function pscore(t, v){
  const price = clamp((5500 - v.tot) / 4000);
  const worst = Math.max(v.out[3], v.back ? v.back[3] : v.out[3]);
  const comfort = 0.5 * [1, 0.7, 0.3][Math.min(worst, 2)] + 0.5 * clamp((32 * 60 - v.out[2]) / (25 * 60));
  return Math.round(100 * (0.5 * price + 0.25 * comfort + 0.25 * (PCL[t.g] || 0)));
}
function viewT(t, origin, stops){
  const a = {t, min:Infinity, max:0, n:0, cheap:null, best:null, bestS:-1, origins:new Set(), cellBest:{}, cs:[]};
  for(const c of t.cells){
    if(!oMatch(c.o, origin)) continue;
    const o = poptions(t, c, stops)[0];
    if(!o) continue;
    const s = pscore(t, o), k = c.dep + "|" + c.n;
    a.n++; a.origins.add(c.o); a.cs.push(c);
    if(o.tot < a.min || (o.tot === a.min && oRank(c.o) < oRank(a.cheap.c.o))){ a.min = o.tot; a.cheap = {c, o}; }
    a.max = Math.max(a.max, o.tot);
    if(s > a.bestS){ a.bestS = s; a.best = {c, o}; }
    const cb = a.cellBest[k];
    if(!cb || o.tot < cb.o.tot || (o.tot === cb.o.tot && oRank(c.o) < oRank(cb.c.o))) a.cellBest[k] = {c, o};
  }
  return a.n ? a : null;
}
function matchT(t, skip){
  const p = S.p;
  if(skip !== "area" && p.area !== "all" && t.area !== p.area) return false;
  if(skip !== "kind" && p.kind !== "all" && t.type !== p.kind) return false;
  if(skip !== "style" && p.style !== "all" && !t.style.includes(p.style)) return false;
  if(p.q && !norm(t.name + " " + t.countries.join(" ") + " " + t.area + " " + t.stages.map(s => s[0]).join(" ")).includes(norm(p.q))) return false;
  return true;
}
function aggT(skipBudget){
  const p = S.p, list = [];
  for(const t of POP.trips){
    if(!matchT(t, null)) continue;
    const a = viewT(t, p.origin, p.stops);
    if(!a) continue;
    if(!skipBudget && p.budget && a.min > p.budget) continue;
    list.push(a);
  }
  const by = {
    tot: (x, y) => x.min - y.min || y.bestS - x.bestS,
    voli: (x, y) => (x.cheap.o.voli + x.cheap.o.extra) - (y.cheap.o.voli + y.cheap.o.extra) || x.min - y.min,
    score: (x, y) => y.bestS - x.bestS || x.min - y.min,
  };
  return list.sort(by[p.sort] || by.tot);
}
const kindBadge = t => t.type === "oj" ? `<span class="b info">open-jaw</span>` : `<span class="b plain">A/R</span>`;
const routeTxt = t => t.type === "oj" ? `${esc(cityOf(t.arr))} <span>${esc(t.arr)}</span> ⋯ ${esc(cityOf(t.dep))} <span>${esc(t.dep)}</span>` : `${esc(cityOf(t.arr))} <span>${esc(t.arr)} · A/R</span>`;
function howTxt(t, v){
  if(v.a.k === "ow") return `2 solo-andata: ${esc(v.out[8])}→${esc(v.a.a)} + ${esc(v.a.b)}→${esc(v.back[9])}`;
  return `A/R su ${esc(cityOf(v.a.a))} ${esc(v.a.a)}` + (v.extra ? ` + ${v.a.add.map(e => esc(e[0])).join(", ")}` : "");
}
const ptwoBadge = v => v.two ? `<span class="b warn wrapb">2 scali: risparmi ${eur(v.save)} pp (${v.pct}%)</span>` : "";

/* ------------------------------------------------------------------ componenti: card */
function cardD(a, i, feat){
  const d = a.d, b = a.cheap, k = coverD(d.code), ret = addD(b.c.dep, b.c.n);
  return `<article class="card rise${feat ? " feat" : ""}" style="--i:${Math.min(i, 8)}">
    <div class="card-ph">${k ? img(k, {alt:PHO[k].cap + ", " + d.country, sz:feat ? "feat" : "card"}) : noPhoto(d.code)}
      <div class="card-top"><span class="bs"><span class="b glass">clima ${esc(d.g)}</span>${oBadge(b.c.o, a.origins, true)}</span>
        <span class="card-r"><span class="score" title="Punteggio 0-100: prezzo pp 50%, comodità 25%, clima 25%"><span class="sr">Punteggio </span>${a.bestS}</span></span></div>
      <div class="card-name"><span class="k">${esc(d.country)} · <span class="iata">${esc(d.code)}</span></span><h3 class="n">${esc(d.city)}</h3></div>
    </div>
    <div class="card-bd">
      <div class="pr"><span class="pp num">${eur(a.min)}</span><span class="u">${priceU(b.c)}</span><span class="cp num">coppia ${eur(a.min * 2)}</span></div>
      <p class="meta"><b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b> · ${b.c.n} giorni · da ${esc(oName(b.c.o))} · ${stopsTxt(b.o.f)}${a.max > a.min ? ` · altre date fino a ${eur(a.max)}` : ""}</p>
      ${d.giro ? `<p class="giro"><s>${esc(d.seen)}</s> → <b>${esc(d.giro)}</b></p>` : ""}
      <div class="bs">${alsoBadge(b.c.o, a.origins)}<span class="b plain">${esc(d.temp)}</span>${priceBadge("d_" + d.code)}${d.flag ? `<span class="b warn wrapb">${esc(d.flag)}</span>` : ""}${twoBadge(b.o)}${estBadge(b.c)}</div>
      <div class="card-ft">${cmpBtn("d_" + d.code, d.city)}</div>
    </div>
    <a class="card-link" href="#/d/${esc(d.code)}"><span class="sr">Apri ${esc(d.city)}, da ${eur(a.min)} a persona</span></a>
    ${favBtn("d_" + d.code, d.city)}
  </article>`;
}
function cardT(a, i, feat){
  const t = a.t, o = a.cheap.o, c = a.cheap.c, k = coverT(t), ret = addD(c.dep, c.n);
  return `<article class="card pop rise${feat ? " feat" : ""}" style="--i:${Math.min(i, 8)}">
    <div class="card-ph">${k ? img(k, {alt:PHO[k].cap + ", " + t.name, sz:feat ? "feat" : "card"}) : noPhoto(t.arr)}
      <div class="card-top"><span class="bs"><span class="b glass">${t.type === "oj" ? "open-jaw" : "A/R"}</span><span class="b glass">clima ${esc(t.g)}</span>${oBadge(c.o, a.origins, true)}</span>
        <span class="card-r"><span class="score" title="Punteggio 0-100: totale stimato pp 50%, comodità voli 25%, clima 25%"><span class="sr">Punteggio </span>${a.bestS}</span></span></div>
      <div class="card-name"><span class="k">${esc(t.countries.join(" + "))} · ${t.nights} notti</span><h3 class="n">${esc(t.name)}</h3></div>
    </div>
    <div class="card-bd">
      <div class="pr"><span class="pp num">${eur(o.voli)}</span><span class="u">a persona · voli</span><span class="cp num">coppia ${eur(o.voli * 2)}</span></div>
      <div class="pr2"><span>Totale stimato <b class="num">${eur(a.min)} pp</b> <span class="est">stima</span></span><span class="num">coppia ${eur(a.min * 2)}</span></div>
      <p class="meta"><b>${fmtD(c.dep)} → ${fmtD(ret)}</b> · ${c.n} giorni · da ${esc(oName(c.o))} · ${howTxt(t, o)}</p>
      <p class="meta">${t.stages.map(s => esc(s[0])).join(" → ")}</p>
      <div class="bs">${alsoBadge(c.o, a.origins)}<span class="b plain">ritmo ${esc(t.pace)}</span>${priceBadge("t_" + t.id)}${t.visited ? `<span class="b plain">giro nuovo</span>` : ""}${t.flag ? `<span class="b warn wrapb">${esc(t.flag)}</span>` : ""}${ptwoBadge(o)}</div>
      <div class="card-ft">${rateChip("t_" + t.id)}${cmpBtn("t_" + t.id, t.name)}</div>
    </div>
    <a class="card-link" href="#/t/${esc(t.id)}"><span class="sr">Apri ${esc(t.name)}, voli da ${eur(o.voli)} a persona</span></a>
    ${favBtn("t_" + t.id, t.name)}
  </article>`;
}

/* ------------------------------------------------------------------ home */
// detail: false = home (barra trasparente sulla foto, menu completo) · "nav" = pagina di sezione (barra piena, menu completo)
//         "photo" / "plain" = pagina di dettaglio (indietro + marchio), "plain" con barra piena
function topHTML(detail){
  const main = !detail || detail === "nav", solid = detail === "plain" || detail === "nav";
  const favA = API ? `<a class="nav-fav" href="#/preferiti"${S.page === "favs" ? ` aria-current="page"` : ""}>${star}<span>Preferiti</span></a>` : "";
  const cur = pg => S.page === pg ? ` aria-current="page"` : "";
  const nav = Object.entries(TABS).map(([k, t]) => `<a href="${t.hash}"${!detail && S.page === "home" && S.tab === k ? ` aria-current="page"` : ""}>${t.label}</a>`).join("") +
    `<a href="#/mappa"${cur("map")}>Mappa</a>` + (API ? `<a href="#/voti"${cur("rates")}>Voti</a>` : "") + favA;
  return `<div class="top${solid ? " solid" : ""}" id="top"${solid ? ` data-solid="1"` : ""}><div class="wrap top-in">
    ${main ? `<a class="brand" href="#/">Agosto 2027<i>da Milano, Roma, Pisa</i></a>` : `<a class="back" href="${TABS[S.tab].hash}" data-act="back"><span aria-hidden="true">←</span> Tutte le mete</a>`}
    ${main ? `<button class="menu-b" data-act="menu" aria-expanded="false" aria-controls="topnav" aria-label="Menu"><span aria-hidden="true"></span></button>` : ""}
    <nav id="topnav" aria-label="Sezioni"${main ? ` class="main"` : ""}>${main ? nav : favA + `<a class="brand" href="#/">Agosto 2027</a>`}</nav></div></div>`;
}
/* copertine della home: posti esotici e iconici tra le mete del progetto [foto, meta]. A ogni caricamento si parte da una
   a caso e si ruota tra 4; il box "In copertina" segue la foto (prezzo pp e link alla pagina della meta). */
const HERO = [["zanzibar","ZNZ"],["sossusvlei","WDH"],["bali","DPS"],["le-morne","MRU"],["masai-mara","MBA"],["machu-picchu","LIM"],["nusa-penida","DPS"],["galapagos","GPS"],["moorea","PPT"],["seychelles","SEZ"]];
function heroPicks(){
  let list = HERO.filter(([k, c]) => PHO[k] && PHO[k].w >= 1000 && DEST[c]).map(([k, c]) => { const a = viewD(c, "all", 1); return {k, code:c, city:DEST[c].city, min:a ? a.min : null}; });
  const priced = list.filter(h => h.min != null);
  if(priced.length >= 3) list = priced;
  if(!list.length){
    const cur = S.tab, f = S.f; S.tab = "new"; S.f = Object.assign({}, F0);
    list = aggD().filter(a => coverD(a.d.code)).slice(0, 4).map(a => ({k:coverD(a.d.code), code:a.d.code, city:a.d.city, min:a.min}));
    S.f = f; S.tab = cur;
  }
  const i = Math.floor(Math.random() * list.length);
  return list.slice(i).concat(list.slice(0, i)).slice(0, 4);
}
const heroPP = h => h.min != null ? "da " + eur(h.min) + " pp" : "scopri la meta";
function footHTML(){
  return `<footer class="foot"><div class="wrap foot-in"><span>Agosto 2027 da Milano, Roma, Pisa · prezzi Google Flights al ${esc(META.date || "")}</span>
    <span><a href="#/mappa">Mappa</a> · <a href="#/confronto">Confronto</a> · ${API ? `<a href="#/voti">Voti</a> · <a href="#/preferiti">Preferiti</a> · ` : ""}<a href="#/crediti">Crediti delle foto</a> · <a href="https://t.me/${BOT_USERNAME}" target="_blank" rel="noopener">Bot Telegram</a></span></div></footer>`;
}
function homeHTML(){
  const picks = S.hero = heroPicks(), p0 = picks[0];
  const bg = p0 ? img(p0.k, {eager:true, cls:"on", alt:"", sz:"hero"}) : "";
  const origins = [["Milano", ["LIN", "MXP"]], ["Roma", ["ROM"]], ["Pisa", ["PSA"]]].filter(([, ks]) => ks.some(k => HAS_O.has(k))).map(x => x[0]);
  return topHTML(false) + `
  <header class="hero" id="hero">
    <div class="hero-bg" id="hero-bg">${bg}</div>
    <p class="credit" id="hero-credit">${p0 ? esc(PHO[p0.k].cap) + " · " + creditTxt(p0.k) : ""}</p>
    <div class="wrap hero-in">
      <p class="kicker rise">Fuori Europa<span class="dot"></span>in due<span class="dot"></span>10-12 giorni</p>
      <h1 class="mega rise" style="--i:1">Agosto <em>2027</em></h1>
      <div class="hero-row rise" style="--i:2">
        <p class="lede">Dove andare quando l'Europa è piena: mete, giri e voli già confrontati.</p>
        ${p0 ? `<a class="cover-note" id="hero-note" href="#/d/${esc(p0.code)}"><span class="arr" aria-hidden="true">→</span><span>In copertina · <span id="hero-cap">${esc(PHO[p0.k].cap)}</span><br><b id="hero-city">${esc(p0.city)}</b> <span id="hero-pp">${heroPP(p0)}</span></span></a>` : ""}
      </div>
      <ul class="rules rise" style="--i:3">
        <li>andata <b>${ALL_DEPS.length ? fmtD(ALL_DEPS[0]) + " → " + fmtD(ALL_DEPS[ALL_DEPS.length - 1]) : "6 → 14 ago"}</b></li>
        <li>durata <b>10 / 11 / 12 giorni</b></li>
        <li>da <b>${esc(origins.join(", ") || "Milano")}</b></li>
        <li>max <b>1 scalo</b> per tratta</li>
        <li>prezzi <b>A/R per persona</b></li>
      </ul>
    </div>
  </header>
  <section class="kpis" aria-label="Numeri"><div class="wrap kpis-in" id="kpis"></div></section>
  <main id="main">
    <div class="wrap"><nav class="tabs" id="tabs" aria-label="Sezioni"></nav><p class="tab-sub" id="tab-sub"></p></div>
    <div class="fbar" id="fbar"><div class="wrap">
      <div class="fbar-in">
        <label class="search"><span aria-hidden="true">⌕</span><span class="sr">Cerca</span><input type="search" id="q" placeholder="Cerca meta o paese…" autocomplete="off"></label>
        <button class="pill" id="fbtn" data-act="panel" aria-expanded="false" aria-controls="fpanel">Filtri <span class="n" id="fn" hidden></span></button>
        <span id="fsort"></span>
      </div>
      <div class="active" id="active"></div>
      <button class="scrim" id="scrim" data-act="panel-close" aria-label="Chiudi i filtri" hidden></button>
      <div class="fpanel" id="fpanel" hidden></div>
    </div></div>
    <div class="wrap"><p class="count" id="count" aria-live="polite"></p><div class="grid" id="grid"></div></div>
    <section class="sec wrap"><details class="xlists"><summary><span class="eyebrow">Mete escluse</span><span class="xl-t">Scartate per scali o clima, nessun volo trovato</span><span class="xl-i" aria-hidden="true">+</span></summary><div class="lists" id="lists"></div></details></section>
    <section class="sec wrap" style="padding-top:0"><p class="eyebrow" style="margin-bottom:14px">Come leggere i numeri</p><div class="notes" id="notes"></div></section>
  </main>` + footHTML();
}
const chips = (items, cur, key) => `<div class="chips">${items.map(([v, l, off]) => `<button class="chip" data-k="${key}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}"${off ? " disabled" : ""}>${esc(l)}</button>`).join("")}</div>`;
const sel = (key, lbl, opts, cur, cls) => `<select data-k="${key}" aria-label="${esc(lbl)}"${cls ? ` class="${cls}"` : ""}>${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const fg = (lbl, inner) => `<div class="fg"><span class="l">${lbl}</span>${inner}</div>`;
const originItems = () => OSEL.map(([v, l]) => [v, l, v !== "all" && !HAS_O.has(v)]);
function homeParts(){
  const pop = S.tab === "pop", st = pop ? S.p : S.f, base = pop ? P0 : F0;
  let kpis, panel, grid, count, lists, notes, sort, n;
  const k = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  if(!pop){
    const list = aggD(); n = list.length;
    const pool = skip => COMBOS.filter(c => match(c, skip));
    const areas = uniq(pool("area").map(c => DEST[c.d].area)).sort((a, b) => a.localeCompare(b, "it"));
    const countries = uniq(pool("country").map(c => DEST[c.d].country)).sort((a, b) => a.localeCompare(b, "it"));
    const deps = uniq(pool("dep").map(c => c.dep)).sort();
    const tot = DESTS.filter(d => d.tab === S.tab && d.g !== "sconsigliato").length;
    const cheap = [...list].sort((x, y) => x.min - y.min)[0], top = [...list].sort((x, y) => y.bestS - x.bestS)[0];
    const lin = list.filter(a => a.origins.has("LIN")).length;
    kpis = k("Mete con voli validi", `${list.length}<small> / ${tot}</small>`, `${num(list.reduce((s, a) => s + a.n, 0))} combinazioni di date`) +
      k("Prezzo pp più basso", cheap ? eur(cheap.min) : "–", cheap ? `${esc(cheap.d.city)} · coppia ${eur(cheap.min * 2)}` : "nessun volo") +
      k("Miglior punteggio", top ? `${top.bestS}<small> / 100</small>` : "–", top ? `${esc(top.d.city)} · ${eur(top.best.o.f[0])} pp · clima ${esc(top.d.g)}` : "") +
      k("Da Linate", lin, `mete raggiungibili da LIN su ${list.length}`);
    panel = fg("Aeroporto di partenza", chips(originItems(), st.origin, "origin")) +
      fg("Area", chips([["all", "Tutte"], ...areas.map(a => [a, a])], st.area, "area")) +
      fg("Paese", sel("country", "Paese", [["all", "Tutti"], ...countries.map(c => [c, c])], st.country)) +
      fg("Budget per persona", sel("budget", "Budget massimo per persona", [0, 800, 1000, 1200, 1500, 1800, 2200].map(b => [b, b ? "fino a " + eur(b) : "Nessun limite"]), st.budget)) +
      fg("Max scali per tratta", chips([[0, "Diretto"], [1, "1"], [2, "2 (se conviene)"]], st.stops, "stops")) +
      fg("Durata", chips([["all", "Tutte"], [10, "10 giorni"], [11, "11"], [12, "12"]], st.dur, "dur")) +
      fg("Data di andata", sel("dep", "Data di andata", [["all", "Tutte"], ...deps.map(x => [x, fmtD(x)])], st.dep)) +
      fg("Clima ad agosto", chips([["all", "Tutti"], ["buono", "Buono o meglio"], ["ottimo", "Solo ottimo"]], st.clima, "clima"));
    sort = sel("sort", "Ordina per", [["score", "Ordina: punteggio"], ["price", "Ordina: prezzo pp"], ["clima", "Ordina: clima"]], st.sort, "pill");
    count = `<b>${list.length}</b> ${list.length === 1 ? "meta" : "mete"} · prezzo A/R <b>per persona</b> nella data più economica`;
    grid = list.map((a, i) => cardD(a, i, i === 0 && list.length > 3)).join("");
    lists = listsD(); notes = notesD();
  } else {
    const list = aggT(false); n = list.length;
    const areas = uniq(POP.trips.filter(t => matchT(t, "area")).map(t => t.area)).sort((a, b) => a.localeCompare(b, "it"));
    const styles = (POP.styles || []).filter(s => POP.trips.some(t => matchT(t, "style") && t.style.includes(s)));
    const cheap = [...list].sort((x, y) => x.min - y.min)[0], top = [...list].sort((x, y) => y.bestS - x.bestS)[0];
    const fl = [...list].sort((x, y) => x.cheap.o.voli - y.cheap.o.voli)[0];
    kpis = k("Trip con voli validi", `${list.length}<small> / ${POP.trips.length}</small>`, `${list.filter(a => a.t.type === "oj").length} open-jaw`) +
      k("Voli pp più bassi", fl ? eur(fl.cheap.o.voli) : "–", fl ? `${esc(fl.t.name)} · ${fmtD(fl.cheap.c.dep)}` : "nessun trip") +
      k("Totale stimato pp", cheap ? eur(cheap.min) : "–", cheap ? `${esc(cheap.t.name)} · coppia ${eur(cheap.min * 2)}` : "") +
      k("Miglior punteggio", top ? `${top.bestS}<small> / 100</small>` : "–", top ? `${esc(top.t.name)} · ${eur(top.best.o.tot)} pp` : "");
    panel = fg("Aeroporto di partenza", chips(originItems(), st.origin, "origin")) +
      fg("Tipo di biglietto", chips([["all", "Tutti"], ["oj", "Open-jaw"], ["rt", "A/R"]], st.kind, "kind")) +
      fg("Area", chips([["all", "Tutte"], ...areas.map(a => [a, a])], st.area, "area")) +
      fg("Stile di viaggio", sel("style", "Stile di viaggio", [["all", "Tutti"], ...styles.map(s => [s, s])], st.style)) +
      fg("Budget totale per persona", sel("budget", "Budget totale massimo per persona", [0, 2000, 2500, 3000, 3500, 4000, 5000].map(b => [b, b ? "fino a " + eur(b) : "Nessun limite"]), st.budget)) +
      fg("Max scali per tratta", chips([[1, "1"], [2, "2 (se conviene)"]], st.stops, "stops"));
    sort = sel("sort", "Ordina per", [["tot", "Ordina: totale pp"], ["voli", "Ordina: voli pp"], ["score", "Ordina: punteggio"]], st.sort, "pill");
    count = `<b>${list.length}</b> trip · <b>voli per persona</b> in evidenza, sotto il totale stimato (voli + interni + a terra)`;
    grid = list.map((a, i) => cardT(a, i, i === 0 && list.length > 3)).join("");
    lists = listsT(); notes = notesT();
  }
  const LBL = {origin:v => "da " + (OSEL.concat(CITIES).find(x => x[0] === v) || [0, v])[1], area:v => v, country:v => v, budget:v => "fino a " + eur(+v) + " pp", stops:v => +v === 0 ? "solo diretti" : "fino a 2 scali",
    dur:v => v + " giorni", dep:v => "andata " + fmtD(v), clima:v => v === "ottimo" ? "clima ottimo" : "clima buono o meglio", kind:v => v === "oj" ? "open-jaw" : "A/R", style:v => v, q:v => "«" + v + "»"};
  const act = Object.keys(base).filter(key => key !== "sort" && String(st[key]) !== String(base[key]));
  const active = act.length ? act.map(key => `<button class="achip" data-act="rm" data-k="${key}" aria-label="Togli il filtro ${esc(LBL[key](st[key]))}">${esc(LBL[key](st[key]))} ×</button>`).join("") + `<button class="achip all" data-act="reset">Azzera</button>` : "";
  const head = `<div class="fpanel-h"><span>Filtri</span><button class="pill" data-act="panel-close">Mostra ${n} ${n === 1 ? "risultato" : "risultati"}</button></div>`;
  const cnt = tab => { const cur = S.tab; let r; if(tab === "pop") r = aggT(true).length; else { S.tab = tab; r = new Set(COMBOS.filter(c => match(c, null)).map(c => c.d)).size; S.tab = cur; } return r; };
  const tabs = Object.entries(TABS).map(([key, t]) => `<a class="tab" href="${t.hash}"${S.tab === key ? ` aria-current="page"` : ""}>${t.label}<sup class="num">${cnt(key)}</sup></a>`).join("");
  const empty = `<p class="empty" style="grid-column:1/-1">Nessun risultato con questi filtri. <button class="achip all" data-act="reset">Azzera i filtri</button></p>`;
  return {kpis, tabs, sub:TABS[S.tab].sub, panel:head + panel, sort, active, nact:act.filter(x => x !== "q").length, count, grid:grid || empty, lists, notes};
}
function listsD(){
  const tabD = DESTS.filter(d => d.tab === S.tab);
  const valid = new Set(COMBOS.filter(c => c.a.length).map(c => c.d));
  const cov = c => COV[c] || [0, 0, null];
  const some = new Set(COMBOS.map(c => c.d));   // anche solo con 2 scali, anche solo come stima
  const stops = tabD.filter(d => d.g !== "sconsigliato" && !valid.has(d.code) && (cov(d.code)[1] > 0 || some.has(d.code)));
  const nodata = tabD.filter(d => d.g !== "sconsigliato" && cov(d.code)[1] === 0 && !some.has(d.code));
  const clima = tabD.filter(d => d.g === "sconsigliato");
  const box = (t, items, sub) => `<div class="lbox"><h3>${t}</h3><p class="note">${sub}</p><ul>${items.length ? items.join("") : "<li><span>nessuna</span></li>"}</ul></div>`;
  const a = d => `<a href="#/d/${esc(d.code)}">${esc(d.city)}</a>`;
  return box("Scartate per troppi scali", stops.map(d => `<li>${a(d)} <span>${esc(d.code)} · solo con 2 scali${cov(d.code)[2] ? ", da " + eur(cov(d.code)[2]) + " pp" : ""}</span></li>`), "Nessuna opzione con al massimo 1 scalo per tratta nelle date richieste.") +
    box("Nessun volo trovato", nodata.map(d => `<li>${a(d)} <span>${esc(d.code)} · ${esc(d.country)}</span></li>`), `Al ${esc(META.date || "")} Google Flights non restituiva voli per agosto 2027 su queste rotte, né come A/R né come due solo andata. Si ricontrollano a ogni giro.`) +
    box("Scartate per clima", clima.map(d => `<li>${a(d)} <span>· ${esc(d.temp)}, ${esc(d.rain)}. ${esc(d.why)}</span></li>`).concat((RAW.excluded || []).map(e => `<li><span>${esc(e)}</span></li>`)), "Troppo caldo o in piena stagione di piogge, monsoni, uragani; in coda le esclusioni a monte.");
}
function notesD(){
  return `<p><b>Prezzi.</b> Google Flights al ${esc(META.date || "")}, A/R per persona in economy (tariffa base, 1 adulto); il prezzo coppia è il doppio. A nove mesi dalla partenza i prezzi sono indicativi.</p>
  <p><b>Stime.</b> Sulle rotte poco cercate Google Flights non restituisce l'A/R per date così lontane, anche se i voli esistono. Lì il prezzo è la somma del miglior solo andata e del miglior ritorno nelle stesse date, con la regola scali applicata a ciascuna tratta, ed è sempre segnato «stima»: l'A/R vero di solito costa meno. Per la data più economica di ogni meta si prova anche a chiedere l'A/R vero, che quando arriva sostituisce la stima.${META.estDests ? ` Oggi ${META.estDests} mete hanno almeno una data stimata.` : ""}</p>
  <p><b>Aeroporti.</b> Si confrontano solo i prezzi dei voli, da qualunque aeroporto partano. Linate è il preferito ed è segnalato; il filtro «Aeroporto di partenza» restringe la ricerca.</p>
  <p><b>Scali.</b> Di base al massimo 1 scalo per tratta. Un'opzione con 2 scali compare solo con «Max scali: 2» e solo se costa almeno il ${Math.round((META.minPct || .25) * 100)}% e almeno ${META.minEur || 150} € a persona in meno del miglior volo con al massimo 1 scalo per la stessa meta, aeroporto e date. Mai 3 o più scali.</p>
  <p><b>Punteggio (0-100).</b> 50% prezzo pp (100 a 500 €, 0 a 2.200 €), 25% comodità (scali e durata dell'andata), 25% clima di agosto (ottimo 1 · buono 0,8 · accettabile 0,5).</p>
  <p><b>Scansione.</b> ${DESTS.length} destinazioni × ${ALL_DEPS.length} date di andata × 10/11/12 giorni: ${num(META.q || 0)} ricerche, ${num(META.ok || 0)} con voli.</p>`;
}
function listsT(){
  const box = (t, items, sub) => `<div class="lbox"><h3>${t}</h3><p class="note">${sub}</p><ul>${items.length ? items.join("") : "<li><span>nessuno</span></li>"}</ul></div>`;
  const no = POP.trips.filter(t => !t.best);
  return box("Trip senza voli validi", no.map(t => `<li><a href="#/t/${esc(t.id)}">${esc(t.name)}</a> <span>${esc(t.arr)}${t.dep !== t.arr ? "→" + esc(t.dep) : ""} · ${esc(t.why || "")} · a terra ${eur(t.land[0])}–${eur(t.land[1])} pp</span></li>`),
      `Al ${esc((POP.meta || {}).date || "")} nessuna combinazione con al massimo 1 scalo per tratta nelle date richieste: da ricontrollare più avanti.`) +
    box("Classici d'agosto lasciati fuori", (POP.skipped || []).map(s => `<li><span>${esc(s)}</span></li>`), "Scartati a monte per clima, distanza o perché esclusi.");
}
function notesT(){
  const m = POP.meta || {};
  return `<p><b>Cosa è reale e cosa è stima.</b> Reali: i prezzi dei singoli voli letti su Google Flights il ${esc(m.date || "")} (economy, 1 adulto, tariffa base). Stime: la somma di due solo-andata usata per gli open-jaw, i voli interni e il costo a terra (fascia mid-range in camera doppia, alta stagione). Il totale coppia è il doppio.</p>
  <p><b>Open-jaw.</b> Ogni open-jaw è confrontato con l'alternativa «A/R su un solo aeroporto + tratta interna stimata» e vince la combinazione più economica. Il link multi-city apre la ricerca vera su Google Flights, dove il biglietto unico di solito costa meno della somma.</p>
  <p><b>Scali.</b> Al massimo 1 scalo per tratta; un'opzione con 2 scali compare solo con «Max scali: 2» e solo se fa risparmiare almeno il ${Math.round((m.minPct || .25) * 100)}% e ${m.minEur || 150} € a persona.</p>
  <p><b>Punteggio (0-100).</b> 50% totale stimato pp (100 a 1.500 €, 0 a 5.500 €), 25% comodità dei voli, 25% clima di agosto.</p>
  <p><b>Scansione.</b> ${POP.trips.length} trip × ${ALL_DEPS.length} date di andata × 10/11/12 giorni: ${num(m.q || 0)} ricerche nuove (${num(m.ok || 0)} con voli) più ${num(m.reused || 0)} A/R riusati dalla scansione principale.</p>`;
}
function updateHome(){
  const p = homeParts();
  for(const [id, key] of [["kpis","kpis"],["tabs","tabs"],["fpanel","panel"],["fsort","sort"],["active","active"],["count","count"],["grid","grid"],["lists","lists"],["notes","notes"]]) $(id).innerHTML = p[key];
  $("tab-sub").textContent = p.sub;
  $("fn").textContent = p.nact; $("fn").hidden = !p.nact;
  const q = $("q"), v = (S.tab === "pop" ? S.p : S.f).q;
  if(q.value !== v) q.value = v;
  q.placeholder = S.tab === "pop" ? "Cerca trip, paese o tappa…" : "Cerca meta o paese…";
  setPanel(S.panel);
  document.querySelectorAll("#top nav a").forEach(a => { if(a.getAttribute("href") === TABS[S.tab].hash) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}
function setPanel(on){
  S.panel = on;
  $("fpanel").hidden = !on; $("scrim").hidden = !on; $("fbtn").setAttribute("aria-expanded", String(on)); $("fbar").classList.toggle("open", on);
}

/* ------------------------------------------------------------------ pagine dettaglio: blocchi comuni */
function galHTML(keys){
  if(keys.length < 2) return "";
  S.lb = keys;
  return `<section class="sec wrap"><p class="eyebrow">Galleria</p><h2 class="h2" style="margin:6px 0 22px">I posti <i>del giro</i></h2>
    <div class="gal n${keys.length}">${keys.map((k, i) => `<button data-act="lb" data-i="${i}" aria-label="Ingrandisci: ${esc(PHO[k].cap)}">${img(k, {sz:"gal"})}<span class="cap"><b>${esc(PHO[k].cap)}</b><small>${esc(PHO[k].by)} · ${esc(PHO[k].lic)}</small></span></button>`).join("")}</div></section>`;
}
function mxHTML(cellBest, cur, priceOf, tagOf){
  const keys = Object.keys(cellBest), ps = keys.map(k => priceOf(cellBest[k])), lo = Math.min(...ps), hi = Math.max(...ps);
  let mx = `<table class="mx"><thead><tr><th class="r" scope="col">Andata</th><th scope="col">10 giorni</th><th scope="col">11 giorni</th><th scope="col">12 giorni</th></tr></thead><tbody>`;
  for(const dep of ALL_DEPS){
    mx += `<tr><th class="r" scope="row">${fmtD(dep)}</th>`;
    for(const n of [10, 11, 12]){
      const k = dep + "|" + n, x = cellBest[k];
      if(!x){ mx += `<td><span class="cell na">–</span></td>`; continue; }
      const p = priceOf(x), h = hi > lo ? (hi - p) / (hi - lo) : 1;
      mx += `<td><button class="cell${p === lo ? " min" : ""}" data-cell="${k}" aria-pressed="${k === cur}" style="background:color-mix(in srgb, var(--lagoon) ${Math.round(6 + 30 * h)}%, var(--paper))" title="Rientro ${fmtD(addD(dep, n))}">${eur(x.o.f ? x.o.f[0] : x.o.voli)}<small>${esc(tagOf(x))}</small></button></td>`;
    }
    mx += `</tr>`;
  }
  return mx + `</tbody></table>`;
}
function vctl(st, origins, stopsItems){
  const os = OSEL.filter(([v]) => v === "all" || origins.has(v));
  const seg = (key, items, cur) => `<span class="seg">${items.map(([v, l]) => `<button data-k="${key}" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join("")}</span>`;
  return `<div class="v-ctl">${os.length > 2 ? `<span><span class="l">Da</span>${seg("origin", os, st.origin)}</span>` : ""}<span><span class="l">Max scali</span>${seg("stops", stopsItems, st.stops)}</span></div>`;
}
const pageNotFound = what => topHTML("plain") + `<main class="wrap cr-head sec"><p class="eyebrow">Pagina non trovata</p><h1 class="h2" style="margin:8px 0 18px">${esc(what)} <i>non c'è</i></h1><p class="sub">Il collegamento potrebbe essere vecchio.</p><p style="margin-top:22px"><a class="btn" href="#/">Tutte le mete</a></p></main>` + footHTML();

/* ------------------------------------------------------------------ pagina destinazione */
function itinHTML(d){
  const all = ITIN[d.code] || [];
  if(!all.length) return "";
  const pace = {intenso:"ok", medio:"info", rilassato:"plain"};
  const items = all.map((t, ix) => {
    const nights = t.t.reduce((s, x) => s + x[1], 0);
    const g = `https://www.google.com/search?q=${encodeURIComponent(`itinerario ${t.n} ${d.country} agosto ${nights} notti`)}`;
    const tl = t.t.map((x, i) => { const k = stageKey(x[0]); return `<li><span class="ph${k ? "" : " none"}" data-i="${i + 1}">${k ? img(k, {alt:PHO[k].cap, sz:"thumb"}) : ""}</span><span class="rail"></span><span class="n">${esc(x[0])}</span><span class="d">${x[1]} ${x[1] === 1 ? "notte" : "notti"}</span></li>`; }).join("");
    return `<details class="it"${ix === 0 ? " open" : ""}>
      <summary><div class="it-h"><div><h3 class="it-n">${esc(t.n)}</h3>
          <div class="bs" style="margin-top:10px">${(t.s || []).map(x => `<span class="b plain">${esc(x)}</span>`).join("")}<span class="b ${pace[t.r] || "plain"}">ritmo ${esc(t.r)}</span><span class="b plain">${nights} notti</span><span class="b sun" title="Stima a terra per persona, mid-range, volo internazionale escluso">a terra ~ ${esc(t.c)}</span></div></div>
          <span class="it-x" aria-hidden="true">+</span></div>
        <div class="tl-w"><ol class="tl">${tl}</ol></div></summary>
      <div class="it-b">
        <div><span class="k">Da non perdere</span><ul>${(t.h || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><p><span class="k">Come ci si muove</span>${esc(t.m)}</p>
          <p style="margin-top:14px"><span class="k">Costo a terra · stima</span>${esc(t.c)}, mid-range per l'intero giro, volo internazionale escluso</p></div>
        <p class="aug"><span class="k">Ad agosto</span>${esc(t.a)}</p>
        <div>${t.oj ? `<p><span class="k">Open-jaw</span>${esc(t.oj)} I prezzi in pagina restano A/R sullo stesso aeroporto.</p>` : ""}
          <p${t.oj ? ` style="margin-top:14px"` : ""}><span class="k">Fonti</span>${(t.src || []).map(u => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(host(u))} ↗</a>`).concat(`<a href="${g}" target="_blank" rel="noopener">cerca su Google ↗</a>`).join(" · ")}</p></div>
      </div></details>`;
  }).join("");
  return `<section class="sec wrap" id="itinerari"><p class="eyebrow">Itinerari popolari · 10-12 giorni</p><h2 class="h2" style="margin:6px 0 10px">${all.length} ${all.length === 1 ? "giro" : "giri"} <i>da copiare</i></h2>
    <p class="sub" style="margin-bottom:24px">Notti per tappa e costi indicativi a persona. Dove ci sono le fonti, tappe e prezzi sono stati confrontati online a novembre 2026.${d.giro ? " Giri pensati fuori dalle zone già viste." : ""}</p>
    <div class="itins">${items}</div></section>`;
}
function voliD(code){
  const d = DEST[code], a = viewD(code, S.f.origin, S.f.stops);
  const origins = new Set((BYD[code] || []).map(c => oKey(c.o)));
  const ctl = vctl(S.f, origins, [[0, "Diretto"], [1, "1"], [2, "2 (se conviene)"]]);
  const head = `<p class="eyebrow">Voli · A/R per persona</p><h2 class="h2" style="margin:6px 0 0">Quando <i>partire</i></h2>` +
    byCity(g => viewD(code, g, S.f.stops), S.f.origin, x => [x.min, `${esc(oName(x.cheap.c.o))} · ${fmtD(x.cheap.c.dep)} · ${x.cheap.c.n} giorni · ${stopsTxt(x.cheap.o.f)}`]);
  if(!a){
    const cov = COV[code] || [0, 0, null], any = (BYD[code] || []).length;
    const msg = any ? "Nessun volo con questi filtri: prova un altro aeroporto o più scali." : cov[1] > 0 ? `Per ora solo voli con 2 scali per tratta${cov[2] ? ", da " + eur(cov[2]) + " pp" : ""}.` : `Al ${esc(META.date || "")} Google Flights non restituisce voli per agosto 2027 su questa rotta, né come A/R né come due solo andata. Capita sulle rotte poco cercate o non ancora in vendita: si ricontrolla a ogni giro.`;
    return head + (any ? ctl : "") + `<p class="empty" style="margin-top:20px">${msg}</p>`;
  }
  if(!S.cell || !a.cellBest[S.cell]) S.cell = a.cheap.c.dep + "|" + a.cheap.c.n;
  const [dep, n] = S.cell.split("|"), ret = addD(dep, +n);
  const mx = mxHTML(a.cellBest, S.cell, x => x.o.f[0], x => oName(x.c.o) + (x.o.two ? " · 2 scali" : "") + (x.c.e ? " · stima" : ""));
  let fl = "";
  const cs = (BYD[code] || []).filter(c => c.dep === dep && c.n === +n && oMatch(c.o, S.f.origin)).sort((x, y) => oRank(x.o) - oRank(y.o));
  for(const c of cs) for(const o of options(c, S.f.stops)){
    const f = o.f;
    if(c.e && f[10]){   // stima: due biglietti solo andata, si mostrano tutte e due le tratte
      const r = f[10], leg = x => `${esc(x[4])} → ${esc(x[5])}${x[6] ? `<sup>+${x[6]}</sup>` : ""} ${esc(x[9])}`;
      const via = x => { const k = x[7] ? x[7].split("·").length : 0; return k === 0 ? "diretto" : `${k} ${k === 1 ? "scalo" : "scali"} · ${esc(x[7])}`; };
      fl += `<div class="fl"><div class="fl-l">
      <div class="fl-t"><span class="apt${c.o === "LIN" ? " lin" : ""}">${esc(f[8])}</span>${leg(f)}</div>
      <div class="fl-m">Andata ${eur(f[11])} · ${esc(f[1])} · ${via(f)} · ${hm(f[2])}</div>
      <div class="fl-t" style="margin-top:8px"><span class="apt">${esc(r[8])}</span>${leg(r)}</div>
      <div class="fl-m">Ritorno ${eur(r[0])} · ${esc(r[1])} · ${via(r)} · ${hm(r[2])} · punteggio ${scoreOf(f, d)}/100</div>
      <div class="bs">${c.o === "LIN" ? `<span class="b ok">da Linate</span>` : ""}${estBadge(c)}${twoBadge(o)}</div>
    </div><div class="fl-r"><div class="pp num">${eur(f[0])} <small>PP</small></div><div class="cp num">coppia ${eur(f[0] * 2)}</div><a href="${gfUrl([[dep, c.o, code]], 2)}" target="_blank" rel="noopener">Andata ↗</a> <a href="${gfUrl([[ret, code, c.o]], 2)}" target="_blank" rel="noopener">Ritorno ↗</a></div></div>`;
      continue;
    }
    fl += `<div class="fl"><div class="fl-l">
      <div class="fl-t"><span class="apt${c.o === "LIN" ? " lin" : ""}">${esc(f[8])}</span>${esc(f[4])} → ${esc(f[5])}${f[6] ? `<sup>+${f[6]}</sup>` : ""} ${esc(f[9])}</div>
      <div class="fl-m">${esc(f[1])} · ${stopsTxt(f)} · ${hm(f[2])} all'andata · punteggio ${scoreOf(f, d)}/100</div>
      ${o.two || c.o === "LIN" ? `<div class="bs">${c.o === "LIN" ? `<span class="b ok">da Linate</span>` : ""}${twoBadge(o)}</div>` : ""}
    </div><div class="fl-r"><div class="pp num">${eur(f[0])} <small>PP</small></div><div class="cp num">coppia ${eur(f[0] * 2)}</div><a href="${gfD(c.o, code, dep, ret)}" target="_blank" rel="noopener">Google Flights ↗</a></div></div>`;
  }
  return head + ctl + `<div class="v-cols"><div><h3 class="h3">Andata × durata</h3>${mx}<p class="note" style="margin-top:10px">Prezzo A/R per persona più basso della combinazione, con l'aeroporto sotto. Più intenso = più economico, il punto giallo segna il minimo. Tocca una cella per i voli.</p></div>
    <div><h3 class="h3">${fmtD(dep)} → ${fmtD(ret)} · ${n} giorni</h3>${fl}
    <p class="note">Orari, scali e durata si riferiscono all'andata; il prezzo è il totale A/R per persona con il ritorno più economico entro lo stesso limite di scali (il ritorno si sceglie su Google Flights).${Object.values(a.cellBest).some(x => x.c.e) ? ` <b>Le celle segnate «stima» non sono un A/R</b>: su questa rotta Google Flights non lo restituisce, quindi il prezzo è la somma del miglior solo andata e del miglior ritorno (due biglietti separati, stessa regola scali per ciascuna tratta). L'A/R vero di solito costa meno.` : ""}</p>
    <p style="margin-top:16px"><a class="btn sun" href="${gfD(a.cellBest[S.cell].c.o, code, dep, ret)}" target="_blank" rel="noopener">Apri su Google Flights ↗</a></p></div></div>`;
}
function destHTML(code){
  const d = DEST[code];
  if(!d) return pageNotFound("Questa meta");
  const a = viewD(code, "all", 1) || viewD(code, "all", 2), k = coverD(code);
  S.cell = null;
  const b = a && a.cheap, ret = b && addD(b.c.dep, b.c.n);
  const more = DESTS.filter(x => x.code !== code && x.area === d.area && x.g !== "sconsigliato").map(x => viewD(x.code, "all", 1)).filter(Boolean).sort((x, y) => y.bestS - x.bestS).slice(0, 3);
  return topHTML("photo") + `
  <header class="hero d">
    <div class="hero-bg">${k ? img(k, {eager:true, cls:"on", alt:PHO[k].cap + ", " + d.country, sz:"hero"}) : noPhoto(d.code)}</div>
    ${k ? `<p class="credit">${esc(PHO[k].cap)} · ${creditTxt(k)}</p>` : ""}
    <div class="wrap hero-in">
      <p class="kicker rise">${esc(d.country)}<span class="dot"></span>${esc(d.area)}<span class="dot"></span><span class="iata">${esc(d.code)}</span></p>
      <h1 class="title rise${d.city.length > 14 ? " long" : ""}" style="--i:1">${esc(d.city)}</h1>
      <div class="hero-row rise" style="--i:2">
        <div class="d-cta">
          ${b ? `<div class="tag"><span class="pp num">${eur(a.min)}</span><span class="u">${priceU(b.c)}<small class="num">coppia ${eur(a.min * 2)}</small></span></div>` : `<div class="tag"><span class="pp">n.d.</span><span class="u">voli<small>nessuno trovato per ora</small></span></div>`}
          <div class="d-when">${b ? `<b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b><span>${b.c.n} giorni · da ${esc(oName(b.c.o))} · ${stopsTxt(b.o.f)}${b.c.e ? " · somma di due solo andata" : ""}</span>` : `<span>Si ricontrolla a ogni giro</span>`}</div>
        </div>
        <div class="d-cta">${b ? `<button class="btn sun" data-act="scroll" data-to="voli">Vedi i voli</button>` : ""}${favCta("d_" + code)}${cmpBtn("d_" + code, d.city, "btn ghost")}</div>
      </div>
      <div class="d-facts rise" style="--i:3"><span class="b glass">clima ${esc(d.g)}</span><span class="b glass">${esc(d.temp)}</span>${a ? `<span class="b glass">punteggio ${a.bestS}/100</span>` : ""}${a ? oBadge(b.c.o, a.origins, true) : ""}${priceBadge("d_" + code, true)}${d.flag ? `<span class="b glass">${esc(d.flag)}</span>` : ""}</div>
    </div>
  </header>
  <main>
    <section class="sec wrap"><div class="why">
      <div><p class="eyebrow" style="margin-bottom:14px">Perché ad agosto</p><blockquote>${esc(d.why)}</blockquote></div>
      <div class="clima" role="group" aria-label="Clima ad agosto">
        <div><span class="k">Clima</span><span class="big">${esc(d.g)}</span></div>
        <div><span class="k">Temperature</span><span>${esc(d.temp)}</span></div>
        <div><span class="k">Piogge</span><span>${esc(d.rain)}</span></div>
        ${d.flag ? `<div><span class="k">Attenzione</span><span>${esc(d.flag)}</span></div>` : ""}
      </div></div>
      ${d.giro ? `<div class="seen"><div><span class="k">Hai già visto</span><span class="old">${esc(d.seen)}</span></div><span class="arr" aria-hidden="true">→</span><div><span class="k">Giro nuovo</span><span class="new">${esc(d.giro)}</span></div></div>` : ""}
    </section>
    ${galHTML(galleryD(code))}
    ${itinHTML(d)}
    <section class="voli sec" id="voli"><div class="wrap" id="voli-in">${voliD(code)}</div>${histSec("d_" + code)}</section>
    ${more.length ? `<section class="sec wrap"><p class="eyebrow">Stessa area</p><h2 class="h2" style="margin:6px 0 22px">Altre mete <i>in ${esc(d.area)}</i></h2><div class="more">${more.map((x, i) => cardD(x, i, false)).join("")}</div></section>` : ""}
  </main>` + footHTML();
}

/* ------------------------------------------------------------------ pagina popular trip */
function legHTML(f, lbl){
  return `<div><div class="fl-t"><span class="apt${f[8] === "LIN" || f[9] === "LIN" ? " lin" : ""}">${esc(f[8])}</span>${esc(f[4])} → ${esc(f[5])}${f[6] ? `<sup>+${f[6]}</sup>` : ""} ${esc(f[9])}</div>
    <div class="fl-m">${lbl} ${fmtD(f[10])} · ${esc(f[1])} · ${stopsTxt(f)} · ${hm(f[2])}</div></div>`;
}
function optHTML(t, c, v){
  const ret = addD(c.dep, c.n);
  let legs, link, lt;
  if(v.a.k === "ow"){
    legs = legHTML(v.out, `andata · ${eur(v.out[0])}`) + legHTML(v.back, `ritorno · ${eur(v.back[0])}`);
    link = gfUrl([[c.dep, v.out[8], v.a.a], [ret, v.a.b, v.back[9]]], 3); lt = "Google Flights multi-city ↗";
  } else {
    legs = legHTML(v.out, "andata") + `<div class="fl-m">ritorno ${fmtD(ret)} da ${esc(cityOf(v.a.a))}: il più economico entro lo stesso limite di scali, da scegliere su Google Flights</div>`;
    link = gfUrl([[c.dep, c.o, v.a.a], [ret, v.a.a, c.o]], 1); lt = "Google Flights A/R ↗";
  }
  const add = v.extra ? `<div class="fl-m"><span class="est">stima</span> + ${v.a.add.map(e => `${esc(e[0])} ~${eur(e[1])}`).join(" + ")} pp${v.a.note ? " · " + esc(v.a.note) : ""}</div>` : (v.a.note ? `<div class="fl-m">${esc(v.a.note)}</div>` : "");
  return `<div class="fl"><div class="fl-l">${legs}${add}
      <div class="bs">${v.a.k === "ow" ? `<span class="est">somma di 2 solo-andata · stima</span>` : `<span class="real">A/R · prezzo reale Google</span>`}${ptwoBadge(v)}</div>
    </div><div class="fl-r"><div class="pp num">${eur(v.voli)} <small>PP VOLI</small></div><div class="cp num">coppia ${eur(v.voli * 2)}</div><div class="cp num">totale stimato ${eur(v.tot)} pp</div><a href="${link}" target="_blank" rel="noopener">${lt}</a></div></div>`;
}
function voliT(id){
  const t = PT[id], a = viewT(t, S.p.origin, S.p.stops);
  const origins = new Set(t.cells.map(c => oKey(c.o)));
  const ctl = vctl(S.p, origins, [[1, "1"], [2, "2 (se conviene)"]]);
  const head = `<p class="eyebrow">Costi e voli · per persona</p><h2 class="h2" style="margin:6px 0 0">Quanto <i>costa</i></h2>` +
    byCity(g => viewT(t, g, S.p.stops), S.p.origin, x => [x.cheap.o.voli, `voli · ${esc(oName(x.cheap.c.o))} · ${fmtD(x.cheap.c.dep)} · ${x.cheap.c.n} giorni · totale stimato ~${eur(x.min)}`]);
  const land = `<tr><td>A terra, mid-range <span class="est">stima</span><small>${t.nights} notti in doppia, pasti, mezzi, ingressi e attività</small></td><td>${eur(t.land[0])} – ${eur(t.land[1])}</td></tr>`;
  if(!a){
    const msg = t.cells.length && t.best ? "Nessun volo con questi filtri: prova un altro aeroporto o più scali." : esc(t.why || "Nessun volo valido per ora.");
    return head + (t.cells.length ? ctl : "") + `<div class="v-cols" style="margin-top:20px"><div><h3 class="h3">Costo stimato</h3><table class="cost"><tbody>
      <tr><td>Voli internazionali<small>${msg}</small></td><td>n.d.</td></tr>
      <tr><td>Voli interni <span class="est">stima</span><small>${t.internal.length ? t.internal.map(e => `${esc(e[0])} ~${eur(e[1])}`).join(" · ") : "nessuno"}</small></td><td>${eur(t.itot)}</td></tr>${land}</tbody></table></div><div><p class="empty">${msg}</p></div></div>`;
  }
  if(!S.cell || !a.cellBest[S.cell]) S.cell = a.cheap.c.dep + "|" + a.cheap.c.n;
  const [dep, n] = S.cell.split("|"), ret = addD(dep, +n), v = a.cellBest[S.cell].o;
  const mx = mxHTML(a.cellBest, S.cell, x => x.o.voli + x.o.extra, x => oName(x.c.o) + (x.o.a.k === "ow" ? " · 2×OW" : " · A/R " + x.o.a.a) + (x.o.extra ? " +" + x.o.extra : "") + (x.o.two ? " · 2 sc." : ""));
  let fl = "";
  for(const c of a.cs.filter(c => c.dep === dep && c.n === +n).sort((x, y) => oRank(x.o) - oRank(y.o))) for(const o of poptions(t, c, S.p.stops)) fl += optHTML(t, c, o);
  const interni = t.internal.concat(v.extra ? v.a.add : []);
  const cost = `<table class="cost"><tbody>
    <tr><td>Voli internazionali <span class="${v.a.k === "ow" ? "est" : "real"}">${v.a.k === "ow" ? "somma di 2 solo-andata · stima" : "prezzo reale Google"}</span><small>${howTxt(t, v)} · ${fmtD(dep)} → ${fmtD(ret)}</small></td><td>${eur(v.voli)}</td></tr>
    <tr><td>Voli interni <span class="est">stima</span><small>${interni.length ? interni.map(e => `${esc(e[0])} ~${eur(e[1])}`).join(" · ") : "nessuno"}</small></td><td>${interni.length ? eur(v.interni) : "0 €"}</td></tr>${land}
    <tr class="t"><td>Totale stimato per persona<small class="num">coppia ${eur(v.lo * 2)} – ${eur(v.hi * 2)}</small></td><td>${eur(v.lo)} – ${eur(v.hi)}</td></tr></tbody></table>`;
  return head + ctl + `<div class="v-cols"><div><h3 class="h3">Costo stimato · ${fmtD(dep)}, ${n} giorni</h3>${cost}
      <h3 class="h3" style="margin-top:30px">Andata × durata · voli</h3>${mx}<p class="note" style="margin-top:10px">Voli internazionali per persona nella combinazione più economica; sotto, aeroporto e modo di volare («+N» = tratta extra stimata per chiudere il giro, in euro). Tocca una cella per i voli.</p></div>
    <div><h3 class="h3">${fmtD(dep)} → ${fmtD(ret)} · ${n} giorni</h3>${fl}
      <p class="note">Negli open-jaw il prezzo è la somma di due biglietti solo-andata letti su Google Flights: è una stima prudente, il biglietto multi-city unico di solito costa meno sul lungo raggio. Negli A/R orari e scali sono quelli dell'andata.</p></div></div>`;
}
function tripHTML(id){
  const t = PT[id];
  if(!t) return pageNotFound("Questo trip");
  const a = viewT(t, "all", 1) || viewT(t, "all", 2), k = coverT(t);
  S.cell = null;
  const b = a && a.cheap, ret = b && addD(b.c.dep, b.c.n);
  const stages = t.stages.map((s, i) => { const sk = stageKey(s[0]); return `<li><span class="ph${sk ? "" : " none"}" data-i="${i + 1}">${sk ? img(sk, {alt:PHO[sk].cap, sz:"thumb"}) : ""}</span><div class="tx"><span class="d">${s[1]} ${s[1] === 1 ? "notte" : "notti"}</span><h3 class="n">${esc(s[0])}</h3><p class="s">${esc(s[2])}</p></div></li>`; }).join("");
  return topHTML("photo") + `
  <header class="hero d">
    <div class="hero-bg">${k ? img(k, {eager:true, cls:"on", alt:PHO[k].cap + ", " + t.name, sz:"hero"}) : noPhoto(t.arr)}</div>
    ${k ? `<p class="credit">${esc(PHO[k].cap)} · ${creditTxt(k)}</p>` : ""}
    <div class="wrap hero-in">
      <p class="kicker rise">Popular trip<span class="dot"></span>${esc(t.countries.join(" + "))}<span class="dot"></span>${t.nights} notti</p>
      <h1 class="title long rise" style="--i:1">${esc(t.name)}</h1>
      <p class="route rise" style="--i:1">${routeTxt(t)}</p>
      <div class="hero-row rise" style="--i:2">
        <div class="d-cta">
          ${b ? `<div class="tag"><span class="pp num">${eur(b.o.voli)}</span><span class="u">a persona · voli<small class="num">totale stimato ~${eur(a.min)} pp</small></span></div>` : `<div class="tag"><span class="pp num">${eur(t.land[0])}+</span><span class="u">a persona · a terra<small>nessun volo trovato</small></span></div>`}
          <div class="d-when">${b ? `<b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b><span>${b.c.n} giorni · da ${esc(oName(b.c.o))} · coppia ${eur(a.min * 2)} tutto compreso</span>` : `<span>Date da ricontrollare più avanti</span>`}</div>
        </div>
        <div class="d-cta"><button class="btn sun" data-act="scroll" data-to="voli">Costi e voli</button>${favCta("t_" + id)}${cmpBtn("t_" + id, t.name, "btn ghost")}</div>
      </div>
      <div class="d-facts rise" style="--i:3"><span class="b glass">${t.type === "oj" ? "open-jaw" : "A/R"}</span><span class="b glass">clima ${esc(t.g)}</span><span class="b glass">${esc(t.temp)}</span><span class="b glass">ritmo ${esc(t.pace)}</span>${a ? `<span class="b glass">punteggio ${a.bestS}/100</span>` : ""}${a ? oBadge(b.c.o, a.origins, true) : ""}${priceBadge("t_" + id, true)}</div>
    </div>
  </header>
  <main>
    ${rateBlock("t_" + id, t.name)}
    <section class="sec wrap"><p class="eyebrow" style="margin-bottom:16px">Il meglio del giro</p><ul class="hi">${t.hi.map(h => `<li>${esc(h)}</li>`).join("")}</ul></section>
    <section class="sec wrap" style="padding-top:0"><div class="why">
      <div><p class="eyebrow" style="margin-bottom:14px">Perché ad agosto</p><blockquote>${esc(t.aug)}</blockquote></div>
      <div class="clima" role="group" aria-label="Clima ad agosto">
        <div><span class="k">Clima</span><span class="big">${esc(t.g)}</span></div>
        <div><span class="k">Temperature</span><span>${esc(t.temp)}</span></div>
        <div><span class="k">Stile</span><span>${esc(t.style.join(", "))} · ritmo ${esc(t.pace)}</span></div>
        ${t.flag ? `<div><span class="k">Attenzione</span><span>${esc(t.flag)}</span></div>` : ""}
      </div></div>
      ${t.visited ? `<div class="seen"><div><span class="k">Hai già visto</span><span class="old">${esc(t.seen)}</span></div><span class="arr" aria-hidden="true">→</span><div><span class="k">Giro nuovo</span><span class="new">${t.stages.map(s => esc(s[0])).join(" · ")}</span></div></div>` : ""}
    </section>
    ${galHTML(galleryT(t))}
    <section class="sec wrap" id="itinerari"><div class="two">
      <div><p class="eyebrow">Tappe · ${t.nights} notti</p><h2 class="h2" style="margin:6px 0 26px">Il giro, <i>tappa per tappa</i></h2><ol class="stages">${stages}</ol></div>
      <div class="side"><p class="eyebrow" style="margin-bottom:10px">Come ci si muove</p><p>${esc(t.ground)}</p>
        ${t.internal.length ? `<p class="eyebrow" style="margin:24px 0 10px">Voli interni <span class="est">stima</span></p><p>${t.internal.map(e => `${esc(e[0])} ~${eur(e[1])} pp`).join(" · ")}</p>` : ""}
        <p class="eyebrow" style="margin:24px 0 10px">A terra <span class="est">stima</span></p><p><b class="num">${eur(t.land[0])} – ${eur(t.land[1])}</b> a persona, mid-range in camera doppia.</p>
        ${(t.src || []).length ? `<p class="eyebrow" style="margin:24px 0 10px">Fonti</p><p>${t.src.map(u => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(host(u))} ↗</a>`).join(" · ")}</p>` : ""}
        ${DEST[t.arr] ? `<p style="margin-top:24px"><a href="#/d/${esc(t.arr)}">Scheda di ${esc(DEST[t.arr].city)} →</a></p>` : ""}</div>
    </div></section>
    <section class="voli sec" id="voli"><div class="wrap" id="voli-in">${voliT(id)}</div>${histSec("t_" + id)}</section>
  </main>` + footHTML();
}
function creditsHTML(){
  const items = Object.entries(PHO).sort((a, b) => a[1].cap.localeCompare(b[1].cap, "it")).map(([k, p]) =>
    `<li>${img(k, {sz:"thumb"})}<span><b>${esc(p.cap)}</b>${esc(p.by)} · ${esc(p.lic)} · <a href="${esc(safeUrl(p.src))}" target="_blank" rel="noopener">${/flickr\.com/.test(p.src) ? "Flickr" : "Wikimedia Commons"} ↗</a></span></li>`).join("");
  return topHTML("plain") + `<main class="wrap cr-head sec"><p class="eyebrow">Crediti</p><h1 class="h2" style="margin:8px 0 14px">Le foto <i>e chi le ha fatte</i></h1>
    <p class="sub">${Object.keys(PHO).length} fotografie da Wikimedia Commons e Flickr (trovate con Openverse), con licenze libere (CC0, CC BY, CC BY-SA, pubblico dominio). Sono state ridimensionate e convertite in WebP; ogni voce rimanda alla pagina originale con autore e licenza.</p>
    <ul class="cr">${items}</ul></main>` + footHTML();
}

/* ------------------------------------------------------------------ pagina preferiti */
// miglior prezzo dei soli voli di un trip (voli + tratte stimate), come nel bot
function flightT(t, origin){
  let m = null;
  for(const c of t.cells){
    if(!oMatch(c.o, origin)) continue;
    const o = poptions(t, c, 1)[0];
    if(o && (m == null || o.voli + o.extra < m.pp)) m = {pp:o.voli + o.extra, o:c.o, dep:c.dep, ret:addD(c.dep, c.n), n:c.n, stops:null};
  }
  return m;
}
function fmtWhen(at){
  if(!at) return "";
  const x = new Date(String(at).length === 10 ? at + "T12:00:00" : at), now = new Date();
  if(isNaN(x.getTime())) return "";
  if(x.toDateString() === now.toDateString()) return "oggi";
  return `il ${x.getDate()} ${MESI[x.getMonth()]}${x.getFullYear() !== now.getFullYear() ? " " + x.getFullYear() : ""}`;
}
const pctTxt = (a, b) => { const p = Math.round(100 * Math.abs(b - a) / a); return p ? ` (${b < a ? "−" : "+"}${p}%)` : ""; };
function favCard(f, i){
  const kind = f.id[0], key = f.id.slice(2), d = kind === "d" ? DEST[key] : null, t = kind === "t" ? PT[key] : null;
  const k = d ? coverD(key) : t ? coverT(t) : null;
  const name = d ? d.city : t ? t.name : (f.name || key);
  const where = d ? `${esc(d.country)} · <span class="iata">${esc(d.code)}</span>` : t ? `${esc(t.countries.join(" + "))} · ${t.nights} notti` : kind === "w" ? "Weekend da Milano" : esc(f.country || "");
  const href = d ? "#/d/" + esc(key) : t ? "#/t/" + esc(key) : kind === "w" ? WEEKEND_URL : "";
  // prezzo di oggi: quello del bot (stessa base del prezzo all'aggiunta); se manca, quello calcolato dai dati della pagina
  let cur = f.cur && f.cur.pp != null ? f.cur : null;
  if(!cur && d){ const a = viewD(key, "all", 1) || viewD(key, "all", 2); if(a) cur = {pp:a.min, o:a.cheap.c.o, dep:a.cheap.c.dep, ret:addD(a.cheap.c.dep, a.cheap.c.n), n:a.cheap.c.n, stops:a.cheap.o.f[3]}; }
  if(!cur && t) cur = flightT(t, "all");
  const city = g => { if(d){ const a = viewD(key, g, 1); return a ? a.min : null; } if(t){ const a = flightT(t, g); return a ? a.pp : null; } return null; };
  const cities = CITIES.map(([g, nm]) => [nm, city(g)]).filter(x => x[1] != null), lo = cities.length ? Math.min(...cities.map(x => x[1])) : null;
  const stops = cur && cur.stops != null ? (cur.stops === 0 ? "diretto" : cur.stops === 1 ? "1 scalo" : cur.stops + " scali") : "";
  const when = cur && cur.dep && cur.ret ? [`<b>${fmtD(cur.dep)} → ${fmtD(cur.ret)}</b>`, cur.n != null ? `${cur.n} giorni` : "", cur.o ? `da ${esc(oName(cur.o))}` : "", stops].filter(Boolean).join(" · ") : "";
  let delta = "";
  if(f.p != null && cur){
    const diff = cur.pp - f.p;
    delta = ` · all'aggiunta <b class="num">${eur(f.p)} pp</b> ` + (diff < 0 ? `<span class="b ok">sceso di ${eur(-diff)}${pctTxt(f.p, cur.pp)}</span>` : diff > 0 ? `<span class="b warn">salito di ${eur(diff)}${pctTxt(f.p, cur.pp)}</span>` : `<span class="b plain">prezzo invariato</span>`);
  }
  const added = [f.by ? `da <b>${esc(f.by)}</b>` : "", fmtWhen(f.at)].filter(Boolean).join(" ");
  return `<article class="card fv rise" style="--i:${Math.min(i, 8)}">
    <div class="card-ph">${k ? img(k, {alt:PHO[k].cap + ", " + name, sz:"card"}) : noPhoto(d ? d.code : t ? t.arr : key)}
      <div class="card-top"><span class="bs"><span class="b glass">${kind === "t" ? "giro" : kind === "w" ? "weekend" : "meta"}</span>${cur && cur.o ? `<span class="b glass">da ${esc(oName(cur.o))}</span>` : ""}</span></div>
      <div class="card-name"><span class="k">${where}</span><h3 class="n">${esc(name)}</h3></div>
    </div>
    <div class="card-bd">
      ${cur ? `<div class="pr"><span class="pp num">${eur(cur.pp)}</span><span class="u">a persona · ${kind === "t" ? "voli" : "A/R"}</span><span class="cp num">coppia ${eur(cur.pp * 2)}</span></div>` : `<div class="pr"><span class="pp">n.d.</span><span class="u">nessun volo trovato</span></div>`}
      ${when ? `<p class="meta">${when}</p>` : ""}
      ${cities.length ? `<div class="bs" aria-label="Miglior prezzo per città di partenza">${cities.map(([nm, pp]) => `<span class="b ${pp === lo ? "ok" : "plain"}">${nm} <b class="num">${eur(pp)}</b></span>`).join("")}</div>` : ""}
      <p class="meta fv-by">${star} Aggiunto${added ? " " + added : ""}${delta}</p>
      ${d || t ? `<div class="bs">${priceBadge(f.id)}${rateChip(f.id)}</div>` : ""}
      <div class="fv-act">${href ? `<a class="pill" href="${href}"${kind === "w" ? ` target="_blank" rel="noopener"` : ""}>Apri la pagina</a>` : ""}${d || t ? cmpBtn(f.id, name, "pill cmpp") : ""}<button class="pill rm" data-act="fav-rm" data-id="${esc(f.id)}" aria-label="Rimuovi ${esc(name)} dai preferiti">Rimuovi</button></div>
    </div>
    ${href && kind !== "w" ? `<a class="card-link" href="${href}"><span class="sr">Apri ${esc(name)}</span></a>` : ""}
    <div class="fv-on" aria-hidden="true">${star}</div>
  </article>`;
}
function favsHTML(){
  const head = topHTML("nav") + `<main class="wrap cr-head sec fv-page" id="favs"><p class="eyebrow">Preferiti</p><h1 class="h2" style="margin:8px 0 14px">Le mete <i>da tenere d'occhio</i></h1>`;
  const ask = `<p class="sub">I preferiti sono privati. Per vederli e salvarli da questo dispositivo scrivi <b>/sito</b> a @${BOT_USERNAME}: ti risponde con un link personale da aprire qui.</p>
    <p style="margin-top:22px"><a class="btn" href="https://t.me/${BOT_USERNAME}?start=sito" target="_blank" rel="noopener">Chiedi il link al bot</a></p>`;
  let body;
  if(!favLive()) body = (FAV.state === "expired" ? `<p class="sub fv-warn">Il link usato su questo dispositivo non vale più.</p>` : "") + ask;
  else if(FAV.state === "error") body = `<p class="sub">Non riesco a leggere i preferiti in questo momento.</p><p style="margin-top:22px"><button class="btn" data-act="fav-retry">Riprova</button></p>`;
  else if(FAV.state !== "ok") body = `<p class="sub">Carico i preferiti…</p>`;
  else {
    const list = [...FAV.map.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    body = (list.length
      ? `<p class="sub">${list.length === 1 ? "Un preferito condiviso" : list.length + " preferiti condivisi"} tra voi due. Il bot scrive su Telegram quando uno scende di prezzo o escono nuove date.</p>
         <div class="grid fv-grid">${list.map(favCard).join("")}</div>`
      : `<p class="sub">Ancora nessun preferito. Tocca la stella su una meta o su un giro: si salva subito e arriva la conferma su Telegram.</p>
         <p style="margin-top:22px"><a class="btn" href="#/">Tutte le mete</a></p>`)
      + `<p class="fv-me">${FAV.me ? `Collegato come <b>${esc(FAV.me)}</b> · ` : ""}<button class="achip all" data-act="fav-logout">Scollega questo dispositivo</button></p>`;
  }
  return head + body + `</main>` + footHTML();
}

/* ------------------------------------------------------------------ accesso con PIN: #/<alias> (Worker: POST /api/pin) */
// Il sito non conosce gli alias: ogni #/<parola> che non e' una rotta chiede il PIN e il Worker decide. Risposte: 200 {token, name},
// 401 PIN errato o non impostato (uguale per alias inesistenti), 429 {retry: secondi} dopo troppi errori.
const ALIAS_RE = /^[a-z]{2,12}$/, ROUTES = ["d", "t", "visitati", "trips", "crediti", "preferiti", "login", "voti", "mappa", "confronto"];
const PIN = {alias:"", busy:false, err:"", until:0, t:null};
const pinWait = () => Math.max(0, Math.ceil((PIN.until - Date.now()) / 1000));
const pinWaitTxt = s => { const m = Math.round(s / 60); return m >= 90 ? `${Math.round(m / 60)} ore` : m >= 60 ? "un'ora" : m <= 1 ? "un minuto" : `${m} minuti`; };
function pinHTML(){
  const w = pinWait(), off = w > 0 || PIN.busy;
  const msg = w > 0 ? `Troppi tentativi sbagliati. Riprova tra ${pinWaitTxt(w)}.` : PIN.err;
  return topHTML("nav") + `<main class="wrap cr-head sec pin-page" id="pin"><p class="eyebrow">Accesso</p><h1 class="h2" style="margin:8px 0 14px">Il tuo <i>PIN</i></h1>
    <p class="sub">Inserisci le 4 cifre per collegare questo dispositivo ai tuoi preferiti e ai tuoi voti.</p>
    <form class="pin-form" id="pin-form" novalidate>
      <label class="sr" for="pin-in">PIN di 4 cifre</label>
      <input class="pin-in" id="pin-in" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="••••" aria-describedby="pin-msg"${off ? " disabled" : ""}>
      <button class="btn" type="submit"${off ? " disabled" : ""}>${PIN.busy ? "Controllo…" : "Entra"}</button>
    </form>
    <p class="pin-msg${w > 0 ? " lock" : ""}" id="pin-msg" role="status" aria-live="polite">${esc(msg)}</p>
    <p class="pin-help">PIN non ancora impostato, o dimenticato? Scrivi <b>/pin</b> a @${BOT_USERNAME} per sceglierne uno nuovo. <a href="https://t.me/${BOT_USERNAME}?start=pin" target="_blank" rel="noopener">Apri il bot</a></p>
  </main>` + footHTML();
}
function pinPaint(){
  if(S.page !== "pin") return;
  $("app").innerHTML = pinHTML();
  clearTimeout(PIN.t);
  const w = pinWait(), el = $("pin-in");
  if(w > 0) PIN.t = setTimeout(pinPaint, Math.min(w, 30) * 1000 + 300);   // il conto alla rovescia si aggiorna da solo
  else if(el && el.focus && !PIN.busy) el.focus();
}
async function pinSubmit(v){
  const el = $("pin-in");
  v = String(v != null ? v : (el && el.value) || "").replace(/\D/g, "");
  if(PIN.busy || S.page !== "pin" || pinWait() > 0) return;
  if(v.length !== 4){ PIN.err = "Il PIN è di 4 cifre."; pinPaint(); return; }
  const alias = S.route.alias;
  PIN.busy = true; PIN.err = ""; pinPaint();
  let done = null;
  try {
    const r = await fetch(API + "/api/pin", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({alias, pin:v})});
    let j = null;
    try { j = await r.json(); } catch(e){ /* risposta non JSON */ }
    if(r.status === 200 && j && j.ok && j.token) done = j;
    else if(r.status === 429 && j && j.retry > 0) PIN.until = Date.now() + j.retry * 1000;
    else if(r.status === 401) PIN.err = `PIN errato o non ancora impostato.${j && j.left > 0 ? ` ${j.left === 1 ? "Resta un tentativo" : `Restano ${j.left} tentativi`} prima del blocco.` : ""}`;
    else PIN.err = "Qualcosa non ha funzionato. Riprova tra poco.";
  } catch(e){ PIN.err = "Non riesco a contattare il server. Controlla la connessione e riprova."; }
  PIN.busy = false;
  if(done){
    saveToken(done.token); saveWho({alias, name:String(done.name || "")});
    FAV.me = String(done.name || ""); FAV.map = new Map(); FAV.state = "loading"; rateReset(); loadFavs(); loadRates();
    if(S.page === "pin" && S.route.alias === alias) go();   // ora il dispositivo e' collegato: go() porta alla home e saluta
  } else pinPaint();
}

/* ------------------------------------------------------------------ badge prezzo: basso / tipico / alto rispetto allo storico */
// Confronta il prezzo dell'ultimo giro con la mediana dei giorni precedenti (come typical() di bot/alerts.py).
// Nascosto finche' la voce non ha almeno PB_MIN_DAYS giorni di storico; fascia "tipico" = mediana ± 5% (almeno 10 €).
const PB_MIN_DAYS = 5;
function priceLevel(id){
  const rows = histRows(id);
  if(rows.length < PB_MIN_DAYS) return null;
  const last = rows[rows.length - 1], cur = last.g.A[0];
  let prev = rows.slice(0, -1);
  const full = prev.filter(r => !r.part);
  if(full.length >= 3) prev = full;                  // i giorni a dato parziale restano fuori dal riferimento, se ne restano abbastanza
  const v = prev.map(r => r.g.A[0]).sort((a, b) => a - b), m = v.length;
  const typ = Math.round(m % 2 ? v[(m - 1) / 2] : (v[m / 2 - 1] + v[m / 2]) / 2), band = Math.max(10, typ * 0.05);
  const lvl = cur <= typ - band ? "low" : cur >= typ + band ? "high" : "mid";
  if(last.part && lvl === "high") return null;       // giro parziale: il prezzo vero poteva essere piu' basso
  return {lvl, cur, typ, days:rows.length};
}
const PB = {low:["▼", "prezzo basso", "ok"], mid:["●", "prezzo tipico", "plain"], high:["▲", "prezzo alto", "warn"]};
function priceBadge(id, glass){
  const l = priceLevel(id);
  if(!l) return "";
  const [ic, txt, cls] = PB[l.lvl], unit = id[0] === "t" ? "voli pp" : "pp";
  return `<span class="b ${glass ? "glass" : cls} pb pb-${l.lvl}" title="Ultimo giro ${eur(l.cur)} ${unit}, tipico ${eur(l.typ)} (mediana su ${l.days} giorni di storico)"><span aria-hidden="true">${ic}</span> ${txt}<span class="sr">: ${eur(l.cur)} contro ${eur(l.typ)} tipico</span></span>`;
}

/* ------------------------------------------------------------------ voti di coppia (Worker: /api/rates, /api/rate) */
// RATE.map = {id: {k: stelle 0-5}}, RATE.people = [{k, name, me}] (nomi e chiavi arrivano dal Worker, qui non c'e' nessun nome).
// RATE.state: off (nessun Worker o nessun token) | loading | ok | error
// Si votano solo i giri completi (Popular trips, id "t_..."): i voti dati in passato alle mete singole restano nel Worker ma il sito li ignora.
const RATE = {map:{}, people:[], state:"off", busy:new Set()};
const rated = id => /^t_/.test(String(id));
const rateOf = (id, k) => { const r = RATE.map[id]; return r && Number.isInteger(r[k]) ? r[k] : null; };
const rateMe = () => RATE.people.find(p => p.me) || null;
const rateVals = id => RATE.people.map(p => rateOf(id, p.k));
const rateAvg = id => { const v = rateVals(id).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const avgTxt = a => (Math.round(a * 10) / 10).toFixed(1).replace(".", ",");
const starsTxt = n => n === 1 ? "1 stella" : n + " stelle";
function rateApply(j){ RATE.map = j.rates || {}; RATE.people = j.people || []; RATE.state = "ok"; }
function rateReset(){ RATE.map = {}; RATE.people = []; RATE.state = "off"; }
async function loadRates(){
  if(!favLive()) return;
  if(RATE.state !== "ok") RATE.state = "loading";
  try { rateApply(await favCall("/api/rates")); }
  catch(e){ if(e.auth){ favExpired(); favPaint(); } else if(RATE.state !== "ok") RATE.state = "error"; }
  ratePaint();
}
// ottimistico come la stella dei preferiti; s = 0..5, null = toglie il voto
async function setRate(id, s){
  const me = rateMe();
  if(!favLive() || !me || !rated(id) || RATE.busy.has(id)) return;
  const was = rateOf(id, me.k);
  if(was === s) return;
  RATE.busy.add(id);
  const put = v => { const r = RATE.map[id] = Object.assign({}, RATE.map[id]); if(v == null) delete r[me.k]; else r[me.k] = v; };
  put(s); ratePaint();
  try { rateApply(await favCall("/api/rate", {id, s})); toast(s == null ? "Voto tolto" : `Voto salvato: ${starsTxt(s)}`); }
  catch(e){
    put(was);
    if(e.auth){ favExpired(); favPaint(); toast("Il link personale non vale più: chiedine uno nuovo al bot con /sito"); }
    else toast("Non sono riuscito a salvare il voto. Riprova tra poco.");
  }
  RATE.busy.delete(id);
  ratePaint();
}
const starsRO = v => `<span class="st" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i${v != null && i <= v ? ` class="on"` : ""}>★</i>`).join("")}</span>`;
// riga di una persona: la propria e' un gruppo di 6 scelte (0 e 1-5 stelle), quella dell'altro si legge soltanto
function rateRow(p, id, name){
  const v = rateOf(id, p.k);
  if(!p.me) return `<div class="rt-row"><span class="rt-who">${esc(p.name)}</span><span class="rt ro" role="img" aria-label="${esc(p.name)}: ${v == null ? "non ha ancora votato" : starsTxt(v) + " su 5"}">${starsRO(v)}</span><span class="rt-v">${v == null ? "non ha ancora votato" : v + " su 5"}</span></div>`;
  const b = i => `<button type="button" role="radio" class="${i ? "rt-s" : "rt-0"}${v != null && (i ? i <= v : v === 0) ? " on" : ""}" data-act="rate" data-id="${esc(id)}" data-s="${i}" aria-checked="${v === i}" aria-label="${i ? starsTxt(i) + " su 5" : "0 stelle: da scartare"}" title="${i ? starsTxt(i) : "0 stelle"}">${i ? "★" : "0"}</button>`;
  return `<div class="rt-row me"><span class="rt-who">${esc(p.name)} <small>tu</small></span><span class="rt" role="radiogroup" aria-label="Il tuo voto per ${esc(name)}">${[0, 1, 2, 3, 4, 5].map(b).join("")}</span><span class="rt-v">${v == null ? "tocca per votare" : `${v} su 5 · <button type="button" class="achip all" data-act="rate" data-id="${esc(id)}" data-s="">togli</button>`}</span></div>`;
}
const loginAsk = what => `Per ${what} scrivi <b>/sito</b> a @${BOT_USERNAME}: ti manda un link personale da aprire su questo dispositivo. <a href="https://t.me/${BOT_USERNAME}?start=sito" target="_blank" rel="noopener">Chiedi il link</a>`;
function rateVerdict(id){
  const v = rateVals(id);
  if(v.length < 2 || v.some(x => x == null)) return "";
  const a = rateAvg(id), d = Math.max(...v) - Math.min(...v);
  return `<span class="b ${d >= 2 ? "warn" : Math.min(...v) >= 4 ? "ok" : "plain"}">${d >= 2 ? "divisiva" : Math.min(...v) >= 4 ? "piace a entrambi" : "d'accordo"}</span> <span class="rt-avg">media <b class="num">${avgTxt(a)}</b></span>`;
}
function rateBlockIn(id, name){
  const head = `<div class="rate-h"><p class="eyebrow">I vostri voti</p><span class="rate-x">${RATE.state === "ok" ? rateVerdict(id) : ""}</span></div>`;
  if(!favLive()){
    const off = `<span class="rt off" role="img" aria-label="Voto non disponibile senza il link personale"><button type="button" class="rt-0" disabled>0</button>${[1, 2, 3, 4, 5].map(() => `<button type="button" class="rt-s" disabled>★</button>`).join("")}</span>`;
    return head + `<div class="rt-row"><span class="rt-who">Il tuo voto</span>${off}</div><p class="note rate-ask">${loginAsk("votare questo giro da 0 a 5 stelle e vedere i voti dell'altro")}</p>`;
  }
  if(RATE.state === "error") return head + `<p class="note">Non riesco a leggere i voti in questo momento. <button type="button" class="achip all" data-act="rate-retry">Riprova</button></p>`;
  if(RATE.state !== "ok") return head + `<p class="note">Carico i voti…</p>`;
  const ps = RATE.people.slice().sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  return head + ps.map(p => rateRow(p, id, name)).join("") + `<p class="note">Da 0 a 5 stelle, 5 = ci voglio andare. Ognuno vota per sé; <a href="#/voti">tutti i giri votati a confronto</a>.</p>`;
}
const rateBlock = (id, name) => API && rated(id) ? `<section class="wrap rate-sec"><div class="rate" data-rateblock="${esc(id)}" data-name="${esc(name)}">${rateBlockIn(id, name)}</div></section>` : "";
// etichetta compatta per le card: "Nome 4★ · Nome –" (solo se c'e' almeno un voto)
function rateChipIn(id){
  if(RATE.state !== "ok" || !RATE.map[id] || !rateVals(id).some(v => v != null)) return "";
  return `<span class="b plain rc-b" title="I vostri voti">${RATE.people.map(p => { const v = rateOf(id, p.k); return `${esc(p.name)} <b class="num">${v == null ? "–" : v}</b>${v == null ? "" : `<i aria-hidden="true">★</i>`}`; }).join(" · ")}</span>`;
}
const rateChip = id => API && rated(id) ? `<span class="rc" data-rate="${esc(id)}">${rateChipIn(id)}</span>` : "";
function ratePaint(){
  document.querySelectorAll("[data-rate]").forEach(el => { el.innerHTML = rateChipIn(el.dataset.rate); });
  document.querySelectorAll("[data-rateblock]").forEach(el => { el.innerHTML = rateBlockIn(el.dataset.rateblock, el.dataset.name || ""); });
  if(S.page === "rates"){ const el = $("voti-in"); if(el && el.innerHTML) el.innerHTML = votiBody(); else $("app").innerHTML = votiHTML(); }
  if(S.page === "cmp") $("app").innerHTML = cmpHTML();
}

/* ------------------------------------------------------------------ voci (mete e trip) per voti, confronto, mappa */
const itemIds = () => DESTS.filter(d => d.g !== "sconsigliato").map(d => "d_" + d.code).concat(POP.trips.map(t => "t_" + t.id));
// a terra di una meta: fascia del primo itinerario ("1.000–1.400 € pp")
function landD(code){
  const t = (ITIN[code] || [])[0], m = t && /(\d[\d.]*)\s*[–-]\s*(\d[\d.]*)/.exec(String(t.c || ""));
  return m ? {lo:+m[1].replace(/\./g, ""), hi:+m[2].replace(/\./g, ""), name:t.n} : null;
}
function item(id){
  const kind = id[0], key = id.slice(2);
  if(kind === "d" && DEST[key]){
    const d = DEST[key], a = viewD(key, "all", 1) || viewD(key, "all", 2), b = a && a.cheap, f = b && b.o.f, land = landD(key);
    return {id, kind, name:d.city, sub:d.country, href:"#/d/" + key, k:coverD(key), tab:d.tab, area:d.area, g:d.g, temp:d.temp, rain:d.rain, flag:d.flag || "", code:d.code,
      pp:a ? a.min : null, unit:b && b.c.e ? "stima" : "A/R", o:b ? b.c.o : null, lin:!!a && a.origins.has("LIN"), dep:b ? b.c.dep : null, n:b ? b.c.n : null, dur:f ? f[2] : null, stops:f ? f[3] : null, via:f ? f[7] : "",
      totLo:a && land ? a.min + land.lo : null, totHi:a && land ? a.min + land.hi : null, totNote:land ? `voli + a terra ${eur(land.lo)}–${eur(land.hi)} (giro «${land.name}»)` : "solo voli: nessuna stima a terra", score:a ? a.bestS : null};
  }
  if(kind === "t" && PT[key]){
    const t = PT[key], a = viewT(t, "all", 1) || viewT(t, "all", 2), b = a && a.cheap, v = b && b.o;
    return {id, kind, name:t.name, sub:t.countries.join(" + "), href:"#/t/" + key, k:coverT(t), tab:"pop", area:t.area, g:t.g, temp:t.temp, rain:"", flag:t.flag || "", code:t.arr,
      pp:v ? v.voli + v.extra : null, unit:"voli", o:b ? b.c.o : null, lin:!!a && a.origins.has("LIN"), dep:b ? b.c.dep : null, n:b ? b.c.n : null, dur:v ? v.out[2] : null,
      stops:v ? Math.max(v.out[3], v.back ? v.back[3] : v.out[3]) : null, via:v ? v.out[7] : "",
      nights:t.nights, oj:t.type === "oj", voli:v ? v.voli : null, est:!!v && v.a.k === "ow", interni:v ? v.interni : t.itot, land:t.land,
      totLo:v ? v.lo : t.land[0] + t.itot, totHi:v ? v.hi : t.land[1] + t.itot, totNote:v ? `voli + interni + a terra, ${t.nights} notti` : "senza voli internazionali", score:a ? a.bestS : null};
  }
  return null;
}
const stopsShort = n => n == null ? "" : n === 0 ? "diretto" : n === 1 ? "1 scalo" : n + " scali";

/* ------------------------------------------------------------------ confronto affiancato (fino a 3 voci, scelta salvata sul dispositivo) */
const CMP_KEY = "agosto2027.cmp", CMP_MAX = 3;
const CMP = {ids:[]};
function cmpRead(){ try { const a = JSON.parse(localStorage.getItem(CMP_KEY) || "[]"); return Array.isArray(a) ? uniq(a.filter(x => typeof x === "string" && item(x))).slice(0, CMP_MAX) : []; } catch(e){ return []; } }
function cmpSave(){ try { localStorage.setItem(CMP_KEY, JSON.stringify(CMP.ids)); } catch(e){ /* resta in memoria */ } }
const cmpOn = id => CMP.ids.includes(id);
function cmpToggle(id){
  if(cmpOn(id)) CMP.ids = CMP.ids.filter(x => x !== id);
  else if(CMP.ids.length >= CMP_MAX){ toast(`Si confrontano al massimo ${CMP_MAX} voci: toglierne una per aggiungere questa.`); return; }
  else if(item(id)) CMP.ids.push(id);
  S.c.hide = CMP.ids.length - 1;
  cmpSave(); cmpPaint();
}
const cmpIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 5h6v14H4zM14 5h6v14h-6z"/></svg>`;
const cmpBtn = (id, name, cls) => `<button type="button" class="${cls || "cmpb"}${cmpOn(id) ? " on" : ""}" data-act="cmp" data-id="${esc(id)}" aria-pressed="${cmpOn(id)}" aria-label="${cmpOn(id) ? "Togli" : "Aggiungi"} ${esc(name)} ${cmpOn(id) ? "dal" : "al"} confronto">${cmpIcon}<span class="lbl">${cmpOn(id) ? "Nel confronto" : "Confronta"}</span></button>`;
function cmpBarHTML(){
  const its = CMP.ids.map(item).filter(Boolean);
  return `<div class="cmpbar-in"><span class="cmpbar-t"><b>Confronto</b> <span class="num">${its.length} di ${CMP_MAX}</span><small>${its.map(x => esc(x.name)).join(" · ")}</small></span>
    ${its.length > 1 ? `<a class="btn sun" href="#/confronto">Confronta</a>` : `<span class="cmpbar-h">aggiungine un'altra</span>`}<button type="button" class="cmpbar-x" data-act="cmp-clear" aria-label="Svuota il confronto">×</button></div>`;
}
function cmpPaint(){
  document.querySelectorAll("[data-act='cmp']").forEach(el => {
    const on = cmpOn(el.dataset.id), l = el.querySelector(".lbl");
    el.classList.toggle("on", on); el.setAttribute("aria-pressed", String(on));
    if(l) l.textContent = on ? "Nel confronto" : "Confronta";
  });
  cmpBar();
  if(S.page === "cmp") $("app").innerHTML = cmpHTML();
}
function cmpBar(){
  const bar = $("cmpbar");
  if(bar){ const show = CMP.ids.length > 0 && S.page !== "cmp"; bar.hidden = !show; bar.innerHTML = show ? cmpBarHTML() : ""; }
}
function cmpHTML(){
  const its = CMP.ids.map(item).filter(Boolean), n = its.length;
  const head = topHTML("nav") + `<main class="wrap cr-head sec cmp-page" id="confronto"><p class="eyebrow">Confronto</p><h1 class="h2" style="margin:8px 0 14px">Fianco <i>a fianco</i></h1>`;
  if(n < 2) return head + `<p class="sub">${n ? `Hai scelto solo <b>${esc(its[0].name)}</b>: aggiungi almeno un'altra meta o un altro giro.` : "Scegli 2 o 3 mete o giri da mettere a confronto."} Il pulsante «Confronta» è su ogni card, nelle pagine delle mete, tra i preferiti e nei voti.</p>
    <p style="margin-top:22px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#/">Tutte le mete</a>${API ? `<a class="btn" href="#/preferiti">Dai preferiti</a>` : ""}</p></main>` + footHTML();
  const hide = n === 3 ? Math.min(Math.max(S.c.hide, 0), 2) : -1;
  const lo = (f) => { const v = its.map(f).filter(x => x != null); return v.length > 1 && Math.min(...v) < Math.max(...v) ? Math.min(...v) : null; };
  const loPP = lo(x => x.pp), loTot = lo(x => x.totLo), loDur = lo(x => x.dur), hiAvg = (() => { const v = its.filter(x => rated(x.id)).map(x => rateAvg(x.id)).filter(x => x != null); return v.length > 1 && Math.max(...v) > Math.min(...v) ? Math.max(...v) : null; })();
  const row = (label, cell, cls) => `<div class="cmp-r${cls ? " " + cls : ""}" role="row"><div class="cmp-l" role="rowheader">${label}</div>${its.map((x, i) => `<div class="cmp-c c${i}" role="cell">${cell(x, i)}</div>`).join("")}</div>`;
  const nd = `<span class="cmp-nd">n.d.</span>`;
  const best = t => ` <span class="b ok">${t}</span>`;
  const votes = x => {
    if(!rated(x.id)) return `<span class="cmp-s">si votano solo i giri completi</span>`;
    if(!favLive()) return `<span class="cmp-s">${loginAsk("votare e vedere i voti")}</span>`;
    if(RATE.state !== "ok") return `<span class="cmp-s">${RATE.state === "error" ? "voti non disponibili" : "carico i voti…"}</span>`;
    const a = rateAvg(x.id);
    return RATE.people.map(p => { const v = rateOf(x.id, p.k); return `<span class="cmp-v"><span class="rt-who">${esc(p.name)}</span><span class="rt ro" role="img" aria-label="${esc(p.name)}: ${v == null ? "nessun voto" : starsTxt(v) + " su 5"}">${starsRO(v)}</span><b class="num">${v == null ? "–" : v}</b></span>`; }).join("") +
      (a != null ? `<span class="cmp-s">media <b class="num">${avgTxt(a)}</b>${hiAvg != null && a === hiAvg ? best("la più votata") : ""}</span>` : `<span class="cmp-s">ancora nessun voto</span>`);
  };
  const table = `<div class="cmp n${n}${hide >= 0 ? " hd" + hide : ""}" role="table" aria-label="Confronto tra ${its.map(x => esc(x.name)).join(", ")}" style="--n:${n}">
    <div class="cmp-r cmp-h" role="row"><div class="cmp-l" role="columnheader"><span class="sr">Voce</span></div>${its.map((x, i) => `<div class="cmp-c c${i}" role="columnheader"><a class="cmp-ph" href="${x.href}" tabindex="-1" aria-hidden="true">${x.k ? img(x.k, {sz:"thumb", alt:""}) : noPhoto(x.code)}</a><span class="cmp-k">${x.kind === "t" ? "giro" : "meta"} · ${esc(x.sub)}</span><a class="cmp-n" href="${x.href}">${esc(x.name)}</a></div>`).join("")}</div>
    ${row("Prezzo migliore <small>a persona</small>", x => x.pp == null ? nd + `<span class="cmp-s">nessun volo trovato</span>` : `<b class="cmp-pp num">${eur(x.pp)}</b><span class="cmp-s">${x.unit === "voli" ? "voli" : x.unit === "stima" ? "stima, due solo andata" : "A/R"} · da ${esc(oName(x.o))}${x.lin && x.o !== "LIN" ? " · anche da Linate" : ""}</span>${loPP != null && x.pp === loPP ? best("il più basso") : ""}${priceBadge(x.id)}`)}
    ${row("Costo totale stimato <small>a persona</small>", x => x.totLo == null ? nd + `<span class="cmp-s">${esc(x.totNote)}</span>` : `<b class="num">${eur(x.totLo)} – ${eur(x.totHi)}</b> <span class="est">stima</span><span class="cmp-s">${esc(x.totNote)} · coppia ${eur(x.totLo * 2)} – ${eur(x.totHi * 2)}</span>${loTot != null && x.totLo === loTot ? best("il più basso") : ""}`)}
    ${row("Date", x => x.dep ? `<b>${fmtD(x.dep)} → ${fmtD(addD(x.dep, x.n))}</b><span class="cmp-s">${x.n} giorni, nella data più economica</span>` : nd)}
    ${row("Ore di volo <small>andata</small>", x => x.dur == null ? nd : `<b class="num">${hm(x.dur)}</b>${loDur != null && x.dur === loDur ? best("il più corto") : ""}`)}
    ${row("Scali", x => x.stops == null ? nd : `<b>${stopsShort(x.stops)}</b>${x.via ? `<span class="cmp-s">via ${esc(x.via)}</span>` : ""}`)}
    ${row("Clima ad agosto", x => `<span class="b ${climaCls(x.g)}">${esc(x.g)}</span><span class="cmp-s">${esc(x.temp)}${x.rain ? " · " + esc(x.rain) : ""}</span>${x.flag ? `<span class="cmp-s warn">${esc(x.flag)}</span>` : ""}`)}
    ${API ? row("Voti", votes) : ""}
    ${row(`<span class="sr">Azioni</span>`, x => `<a class="pill" href="${x.href}">Apri</a><button type="button" class="pill rm" data-act="cmp" data-id="${esc(x.id)}" aria-label="Togli ${esc(x.name)} dal confronto">Togli</button>`, "cmp-a")}
  </div>`;
  const pick = n === 3 ? `<div class="cmp-pick" role="group" aria-label="Colonne mostrate su telefono"><span class="l">Sul telefono due alla volta: nascondi</span><span class="seg">${its.map((x, i) => `<button type="button" data-act="cmp-hide" data-i="${i}" aria-pressed="${hide === i}">${esc(x.name)}</button>`).join("")}</span></div>` : "";
  return head + `<p class="sub">Prezzo dei voli nella data più economica, con al massimo 1 scalo per tratta (2 solo dove non c'è altro). Il costo totale somma ai voli la stima a terra.</p>${pick}${table}
    <p style="margin-top:22px"><button type="button" class="achip all" data-act="cmp-clear">Svuota il confronto</button></p></main>` + footHTML();
}

/* ------------------------------------------------------------------ pagina voti: le preferenze dei due a confronto, solo sui giri completi */
// Voci = Popular trips (giri con tappe, voli e costo totale stimato). Le mete singole non si votano.
const VSORT = [["auto", "Voti"], ["tot", "Costo totale"], ["voli", "Costo dei voli"], ["nights", "Durata"]];
const VMAX = [2000, 3000, 4000, 5000];
const votiPool = () => POP.trips.map(t => item("t_" + t.id)).filter(Boolean);
function votiViews(){
  return [["rank", "Classifica", "per media dei voti"], ["both", "Entrambi ≥ 4", "piace a tutti e due"], ["div", "Divisivi", "almeno 2 stelle di differenza"]]
    .concat(RATE.people.map(p => ["todo:" + p.k, p.me ? "Da votare: tu" : "Da votare: " + p.name, "non ancora votati da " + p.name]));
}
function votiList(view, pool){
  pool = pool.filter(x => rated(x.id));
  const vals = x => rateVals(x.id), all = v => v.length > 1 && v.every(y => y != null);
  let list;
  if(view === "both") list = pool.filter(x => { const v = vals(x); return all(v) && Math.min(...v) >= 4; });
  else if(view === "div") list = pool.filter(x => { const v = vals(x); return all(v) && Math.max(...v) - Math.min(...v) >= 2; });
  else if(view.startsWith("todo:")) return pool.filter(x => rateOf(x.id, view.slice(5)) == null).sort((x, y) => (y.score || 0) - (x.score || 0) || x.name.localeCompare(y.name, "it"));
  else list = pool.filter(x => vals(x).some(y => y != null));
  const cnt = x => vals(x).filter(y => y != null).length;
  if(view === "div") return list.sort((x, y) => { const a = vals(x), b = vals(y); return (Math.max(...b) - Math.min(...b)) - (Math.max(...a) - Math.min(...a)) || rateAvg(y.id) - rateAvg(x.id); });
  return list.sort((x, y) => rateAvg(y.id) - rateAvg(x.id) || cnt(y) - cnt(x) || (x.pp == null ? 1e9 : x.totLo) - (y.pp == null ? 1e9 : y.totLo));
}
// ordine scelto a mano: i giri senza voli (totale incompleto) vanno in fondo
function votiSort(list, sort){
  const by = {tot:x => x.pp == null ? 1e9 : x.totLo, voli:x => x.pp == null ? 1e9 : x.voli, nights:x => x.nights}[sort];
  return by ? list.slice().sort((x, y) => by(x) - by(y) || (x.pp == null ? 1e9 : x.totLo) - (y.pp == null ? 1e9 : y.totLo) || x.name.localeCompare(y.name, "it")) : list;
}
// voli pp (migliore, con aeroporto, reale o stima) + totale del viaggio pp (voli + interni + a terra)
function votiCost(x){
  const fl = x.pp == null ? `<b>n.d.</b><small>nessun volo trovato per ora</small>`
    : `<b class="num">${eur(x.voli)}</b> <span class="${x.est ? "est" : "real"}">${x.est ? "stima" : "prezzo reale"}</span><small>da ${esc(oName(x.o))} <span class="iata">${esc(x.o)}</span> · ${x.est ? "somma di 2 solo andata" : "A/R"}${x.lin && x.o !== "LIN" ? " · anche da Linate" : ""}</small>`;
  const parts = [x.pp == null ? "" : `voli ${eur(x.voli)}`, x.interni ? `interni ${eur(x.interni)}` : "", `a terra ${eur(x.land[0])}–${eur(x.land[1])}`].filter(Boolean).join(" + ");
  const tot = `<b class="num">${eur(x.totLo)} – ${eur(x.totHi)}</b> <span class="est">stima</span><small>${x.pp == null ? "senza voli internazionali: " : ""}${parts} · coppia ${eur(x.totLo * 2)} – ${eur(x.totHi * 2)}</small>`;
  return `<dl class="vcost"><div><dt>Voli <span>a persona</span></dt><dd>${fl}</dd></div><div><dt>Totale del viaggio <span>a persona</span></dt><dd>${tot}</dd></div></dl>`;
}
function votiRow(x, i, rank){
  const a = rateAvg(x.id), ps = RATE.people.slice().sort((p, q) => (q.me ? 1 : 0) - (p.me ? 1 : 0));
  return `<li class="vrow"><a class="vrow-ph" href="${x.href}" tabindex="-1" aria-hidden="true">${x.k ? img(x.k, {sz:"thumb", alt:""}) : noPhoto(x.code)}</a>
    <div class="vrow-t">${rank ? `<span class="vrow-i num">${i + 1}</span>` : ""}<a class="vrow-n" href="${x.href}">${esc(x.name)}</a>
      <span class="vrow-s">${esc(x.sub)} · <b class="num">${x.nights} notti</b>${x.oj ? " · open-jaw" : ""}${x.dep ? ` · ${fmtD(x.dep)} → ${fmtD(addD(x.dep, x.n))}` : ""}</span>
      ${votiCost(x)}
      <span class="bs">${a != null ? `<span class="b sun">media <b class="num">${avgTxt(a)}</b></span>` : ""}${rateVerdict(x.id).replace(/<span class="rt-avg">.*$/, "")}${priceBadge(x.id)}</span></div>
    <div class="vrow-r">${ps.map(p => rateRow(p, x.id, x.name)).join("")}</div>
    <div class="vrow-a">${cmpBtn(x.id, x.name, "cmpb sm")}</div></li>`;
}
function votiBody(){
  const V = S.v, all = votiPool(), max = +V.max || 0;
  const areas = uniq(all.map(x => x.area)).sort((a, b) => a.localeCompare(b, "it"));
  if(V.area !== "all" && !areas.includes(V.area)) V.area = "all";
  if(!VSORT.some(s => s[0] === V.sort)) V.sort = "auto";
  const pool = all.filter(x => (V.area === "all" || x.area === V.area) && (!max || (x.pp != null && x.totLo <= max)));
  const views = votiViews();
  if(!views.some(v => v[0] === V.view)) V.view = "rank";
  const list = votiSort(votiList(V.view, pool), V.sort), cur = views.find(v => v[0] === V.view), me = rateMe();
  const mine = me ? pool.filter(x => rateOf(x.id, me.k) != null).length : 0;
  const ranked = V.sort === "auto" && (V.view === "rank" || V.view === "both");
  const empty = {rank:"Ancora nessun voto qui. Parti da «Da votare: tu».", both:"Nessun giro con 4 o più stelle da entrambi, per ora.", div:"Nessun disaccordo: non ci sono giri con almeno 2 stelle di differenza."}[V.view] || "Tutto votato in questa sezione.";
  const sel = (k, label, opts) => `<label class="vt-sel"><span class="l">${label}</span><select class="pill" data-vk="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(V[k]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  return `<div class="vt-ctl">
      ${sel("area", "Area", [["all", "Tutte le aree"], ...areas.map(a => [a, a])])}
      ${sel("sort", "Ordina per", VSORT)}
      ${sel("max", "Totale a persona", [["0", "Qualsiasi"], ...VMAX.map(m => [String(m), "fino a " + eur(m)])])}
    </div>
    <div class="vt-views" role="group" aria-label="Cosa mostrare">${views.map(([v, l]) => `<button type="button" class="vt-v" data-act="vt" data-k="view" data-v="${esc(v)}" aria-pressed="${V.view === v}">${esc(l)}<sup class="num">${votiList(v, pool).length}</sup></button>`).join("")}</div>
    <p class="count" aria-live="polite"><b>${list.length}</b> ${list.length === 1 ? "giro" : "giri"} · ${esc(cur[2])}${V.sort !== "auto" ? ` · in ordine di ${esc(VSORT.find(s => s[0] === V.sort)[1].toLowerCase())}` : ""}${me ? ` · hai votato <b>${mine}</b> di ${pool.length}` : ""}</p>
    ${list.length ? `<ol class="vlist">${list.slice(0, V.n).map((x, i) => votiRow(x, i, ranked)).join("")}</ol>${list.length > V.n ? `<p style="margin-top:18px"><button type="button" class="pill" data-act="vt-more">Mostra altri ${Math.min(30, list.length - V.n)}</button></p>` : ""}` : `<p class="empty">${empty}</p>`}`;
}
function votiHTML(){
  const head = topHTML("nav") + `<main class="wrap cr-head sec vt-page" id="voti"><p class="eyebrow">Voti · solo giri completi</p><h1 class="h2" style="margin:8px 0 14px">Dove vuole andare <i>chi</i></h1>`;
  const what = `Si votano solo i giri completi (i Popular trips): per ognuno trovi il costo dei voli e la stima del costo totale del viaggio a persona, voli + interni + a terra.`;
  let body;
  if(!API) body = `<p class="sub">I voti non sono attivi su questa copia del sito.</p>`;
  else if(!favLive()) body = (FAV.state === "expired" ? `<p class="sub fv-warn">Il link usato su questo dispositivo non vale più.</p>` : "") +
    `<p class="sub">Ognuno dà da 0 a 5 stelle ai giri completi, dal proprio profilo; qui i voti si incrociano: classifica, cosa piace a entrambi, dove non siete d'accordo, cosa manca da votare.</p>
     <p class="sub" style="margin-top:12px">${what} ${loginAsk("votare")}</p>`;
  else if(RATE.state === "error") body = `<p class="sub">Non riesco a leggere i voti in questo momento.</p><p style="margin-top:22px"><button class="btn" data-act="rate-retry">Riprova</button></p>`;
  else if(RATE.state !== "ok") body = `<p class="sub">Carico i voti…</p>`;
  else body = `<p class="sub">Da 0 a 5 stelle, 5 = ci voglio andare. Ognuno vota per sé e vede il voto dell'altro: ${RATE.people.map(p => `<b>${esc(p.name)}</b>${p.me ? " (tu)" : ""}`).join(" e ")}. ${what}</p><div id="voti-in">${votiBody()}</div>`;
  return head + body + `</main>` + footHTML();
}

/* ------------------------------------------------------------------ mappa: mete colorate per prezzo pp (SVG, nessuna libreria) */
// Proiezione equirettangolare, la stessa di build_map.py. Il contorno delle terre (world.json, ~50 kB) si scarica solo qui.
const WORLD = {state:"idle", d:"", w:1000, h:388.9, lat0:82, k:1000 / 360};
const mapXY = (lat, lon) => [+((lon + 180) * WORLD.k).toFixed(1), +((WORLD.lat0 - lat) * WORLD.k).toFixed(1)];
const MBINS = [600, 900, 1200, 1600];                       // soglie in euro pp: 5 fasce, dal verde (economico) al rosso (caro)
const mBin = p => { let i = 0; while(i < MBINS.length && p > MBINS[i]) i++; return i; };
const mBinTxt = i => i === 0 ? `fino a ${eur(MBINS[0])}` : i === MBINS.length ? `oltre ${eur(MBINS[i - 1])}` : `${num(MBINS[i - 1] + 1)} – ${eur(MBINS[i])}`;
// riquadri [lon0, lon1, lat0, lat1]
const MZOOM = [["world", "Mondo", [-180, 180, -58, 82]], ["Asia", "Asia", [38, 150, -13, 57]], ["Africa", "Africa", [-28, 64, -37, 40]], ["Nord America", "Nord e Centro America", [-170, -50, 5, 74]],
  ["Sud America", "Sud America", [-95, -30, -57, 15]], ["Oceania", "Oceania", [108, 180, -50, 2]], ["Europa remota", "Europa remota", [-32, 50, 33, 81]]];
async function loadWorld(){
  if(WORLD.state === "ok" || WORLD.state === "loading") return;
  WORLD.state = "loading";
  try {
    const r = await fetch(WORLD_URL);
    if(!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    Object.assign(WORLD, {d:String(j.d || ""), w:j.w || 1000, h:j.h || 388.9, lat0:j.lat0 || 82, k:j.k || 1000 / 360, state:"ok"});
  } catch(e){ WORLD.state = "error"; }
  if(S.page === "map"){ const el = $("map-in"); if(el) el.innerHTML = mapBody(); }
}
function mapPoints(){
  return DESTS.filter(d => d.g !== "sconsigliato" && d.lat != null && d.lon != null && (S.m.tab === "all" || d.tab === S.m.tab)).map(d => {
    const a = viewD(d.code, "all", 1), a2 = a || viewD(d.code, "all", 2), [x, y] = mapXY(d.lat, d.lon);
    return {d, x, y, pp:a2 ? a2.min : null, two:!a && !!a2, est:!!(a2 && a2.cheap.c.e), bin:a2 ? mBin(a2.min) : -1, o:a2 ? a2.cheap.c.o : null};
  });
}
function mapBody(){
  const M = S.m, z = MZOOM.find(q => q[0] === M.zoom) || MZOOM[0], [lon0, lon1, la0, la1] = z[2];
  const [x0, y0] = mapXY(la1, lon0), [x1, y1] = mapXY(la0, lon1), vw = +(x1 - x0).toFixed(1), vh = +(y1 - y0).toFixed(1);
  const pts = mapPoints(), inView = pts.filter(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
  // punti piu' grandi (in unita' della mappa) quando lo schermo e' stretto e si guarda una zona: restano toccabili
  const narrow = typeof window !== "undefined" && window.innerWidth < 720 && M.zoom !== "world";
  const r = +(vw / (narrow ? 62 : 115)).toFixed(2), fs = +(vw / (narrow ? 24 : 46)).toFixed(2), sw = +(vw / 900).toFixed(2);
  // prima le piu' care, cosi' le economiche (piu' intense) restano sopra; le n.d. sotto a tutte
  const dots = inView.slice().sort((a, b) => (a.pp == null ? -1 : 0) - (b.pp == null ? -1 : 0) || (b.pp || 0) - (a.pp || 0)).map(p => {
    const lbl = `${p.d.city}, ${p.d.country}: ${p.pp == null ? "nessun volo trovato" : eur(p.pp) + " a persona da " + oName(p.o) + (p.two ? " (solo con 2 scali)" : "") + (p.est ? " (stima: somma di due solo andata)" : "")}`;
    const right = p.x > x0 + vw * 0.72;
    return `<a class="mp ${p.bin < 0 ? "nd" : "m" + p.bin}" href="#/d/${esc(p.d.code)}" aria-label="${esc(lbl)}"><title>${esc(lbl)}</title><circle class="hit" cx="${p.x}" cy="${p.y}" r="${+(r * 2.1).toFixed(2)}"/><circle class="dot" cx="${p.x}" cy="${p.y}" r="${r}" stroke-width="${sw}"/><text x="${+(p.x + (right ? -1 : 1) * r * 1.5).toFixed(1)}" y="${+(p.y + fs * 0.35).toFixed(1)}" font-size="${fs}" stroke-width="${+(fs / 4).toFixed(2)}"${right ? ` text-anchor="end"` : ""}>${esc(p.d.city.split(" (")[0])}${p.pp == null ? "" : " · " + eur(p.pp)}</text></a>`;
  }).join("");
  const home = [["Milano", 45.46, 9.19], ["Roma", 41.9, 12.5], ["Pisa", 43.68, 10.39]].map(([n, la, lo]) => { const [x, y] = mapXY(la, lo); return x >= x0 && x <= x1 && y >= y0 && y <= y1 ? `<rect class="mhome" x="${+(x - r * 0.55).toFixed(1)}" y="${+(y - r * 0.55).toFixed(1)}" width="${+(r * 1.1).toFixed(2)}" height="${+(r * 1.1).toFixed(2)}" stroke-width="${sw}"><title>${n}: partenza</title></rect>` : ""; }).join("");
  const counts = [0, 1, 2, 3, 4].map(i => inView.filter(p => p.bin === i).length), nNd = inView.filter(p => p.bin < 0).length;
  const legend = `<ul class="mleg" aria-label="Legenda: prezzo A/R a persona">${[0, 1, 2, 3, 4].map(i => `<li><i class="mk m${i}"></i>${mBinTxt(i)} <span class="num">(${counts[i]})</span></li>`).join("")}<li><i class="mk nd"></i>nessun volo trovato <span class="num">(${nNd})</span></li><li><i class="mk home"></i>partenza</li></ul>`;
  const land = WORLD.state === "ok" ? `<path class="mland" d="${WORLD.d}"/>` : "";
  const status = WORLD.state === "error" ? `<p class="note">Il contorno dei continenti non si è caricato: i punti restano al loro posto. <button type="button" class="achip all" data-act="map-retry">Riprova</button></p>` : WORLD.state !== "ok" ? `<p class="note">Carico la mappa…</p>` : "";
  const sorted = inView.slice().sort((a, b) => (a.pp == null ? 1e9 : a.pp) - (b.pp == null ? 1e9 : b.pp) || a.d.city.localeCompare(b.d.city, "it"));
  const list = `<details class="mlist"${M.zoom !== "world" ? " open" : ""}><summary>Elenco delle ${inView.length} mete in vista, dalla più economica</summary><ol>${sorted.map(p => `<li><i class="mk ${p.bin < 0 ? "nd" : "m" + p.bin}"></i><a href="#/d/${esc(p.d.code)}">${esc(p.d.city)}</a> <span>${esc(p.d.country)}</span> <b class="num">${p.pp == null ? "n.d." : eur(p.pp)}</b>${p.two ? ` <span class="est">2 scali</span>` : ""}${priceBadge("d_" + p.d.code)}</li>`).join("")}</ol></details>`;
  return `<div class="m-ctl">
      <div class="chips" role="group" aria-label="Sezione">${[["all", "Tutte"], ["new", "Nuove mete"], ["vis", "Già visitati"]].map(([v, l]) => `<button type="button" class="chip" data-act="mp" data-k="tab" data-v="${v}" aria-pressed="${M.tab === v}">${l}</button>`).join("")}</div>
      <div class="chips" role="group" aria-label="Zona">${MZOOM.map(([v, l]) => `<button type="button" class="chip" data-act="mp" data-k="zoom" data-v="${esc(v)}" aria-pressed="${M.zoom === v}">${esc(l)}</button>`).join("")}</div>
    </div>
    <figure class="mfig"><div class="mscroll"><svg class="map z-${M.zoom === "world" ? "world" : "zone"}" viewBox="${x0} ${y0} ${vw} ${vh}" role="group" aria-label="Mappa: ${inView.length} mete, colore per prezzo a persona">${land}${home}${dots}</svg></div>
      <figcaption>${legend}<p class="note">Prezzo A/R a persona più basso tra tutte le date, con al massimo 1 scalo per tratta (2 dove non c'è altro). <b>Verde = economico, rosso = caro.</b> Tocca un punto per aprire la meta${M.zoom === "world" ? "; sul telefono conviene scegliere una zona" : ""}.</p>${status}</figcaption></figure>
    ${list}`;
}
function mapHTML(){
  loadWorld();
  return topHTML("nav") + `<main class="wrap cr-head sec m-page" id="mappa"><p class="eyebrow">Mappa</p><h1 class="h2" style="margin:8px 0 14px">Dove costa <i>meno volare</i></h1>
    <div id="map-in">${mapBody()}</div></main>` + footHTML();
}

/* ------------------------------------------------------------------ router */
/* ------------------------------------------------------------------ andamento del prezzo (storico dei giri, RAW.hist) */
const HIST = RAW.hist || {days:[], runs:[], e:[], t:{}};
const HSER = [["A", "Migliore assoluto"], ["MIL", "Milano"], ["ROM", "Roma"], ["PSA", "Pisa"]];
const HG = ["MIL", "ROM", "PSA"];
const hRank = e => e[0] + (e[6] || 0);
const fmtDY = iso => { const x = dt(iso); return `${x.getDate()} ${MESI[x.getMonth()]}`; };
const hStops = n => n === 0 ? "diretto" : `${n} ${n === 1 ? "scalo" : "scali"}`;
const hEntry = e => `${esc(oName(e[1]))} · ${fmtD(e[2])} → ${fmtD(addD(e[2], e[3]))} · ${e[3]} giorni · ${hStops(e[4])}${e[5] ? ` · totale stimato ~${eur(e[5])}` : ""}${e[7] ? ` · ${esc(EST_TXT)}` : ""}`;
function histRows(id){
  return ((HIST.t || {})[id] || []).map(r => {
    const d = HIST.days[r[0]], run = HIST.runs[r[0]] || ["", 0, 1], g = {};
    HG.forEach((k, i) => { const e = HIST.e[r[i + 1]]; if(e) g[k] = e; });
    const ks = HG.filter(k => g[k]);
    if(!d || !ks.length) return null;
    const bg = ks.reduce((a, k) => hRank(g[k]) < hRank(g[a]) ? k : a, ks[0]);
    g.A = g[bg];
    return {d, g, bg, part:!!r[4], src:run[0] || "", n:run[2] || 1, last:r[5] || null};
  }).filter(Boolean);
}
function histAgg(rows, per){
  const m = new Map();
  for(const r of rows){
    const k = per === "month" ? r.d.slice(0, 7) + "-01" : per === "week" ? addD(r.d, -((dt(r.d).getDay() + 6) % 7)) : r.d;
    let b = m.get(k);
    if(!b){ b = {k, g:{}, on:{}, bg:null, part:true, days:0, last:null, n:1, src:""}; m.set(k, b); }
    b.days++; b.part = b.part && r.part;
    for(const s of ["A"].concat(HG)){ const e = r.g[s]; if(e && (!b.g[s] || hRank(e) < hRank(b.g[s]))){ b.g[s] = e; b.on[s] = r.d; if(s === "A") b.bg = r.bg; } }
    if(per === "day"){ b.last = r.last; b.n = r.n; b.src = r.src; }
  }
  return [...m.values()];
}
function hStep(x){ const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
function hDelta(a, b){
  const d = b - a, p = Math.round(100 * Math.abs(d) / a);
  if(!d) return `<span class="hd eq">invariato</span>`;
  return `<span class="hd ${d < 0 ? "dn" : "up"}"><span aria-hidden="true">${d < 0 ? "▼" : "▲"}</span> ${d < 0 ? "−" : "+"}${eur(Math.abs(d))}${p ? ` <small>${d < 0 ? "−" : "+"}${p}%</small>` : ""}</span>`;
}
function histHTML(id){
  const rows = histRows(id);
  if(!rows.length) return "";
  const H = S.h, trip = id[0] === "t", unit = trip ? "voli pp" : "pp";
  const have = HSER.filter(([k]) => k === "A" || rows.some(r => r.g[k]));
  const ser = have.length > 2 ? have : have.slice(0, 1);          // una sola città con dati: basta la linea del migliore
  if(!ser.some(([k]) => !H.off[k])) H.off = {};
  const vis = ser.filter(([k]) => !H.off[k]), F = vis[0][0], fName = vis[0][1];
  const pts = rows.filter(r => r.g[F]), pp = r => r.g[F][0];
  const first = pts[0], last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const lo = pts.reduce((a, r) => pp(r) <= pp(a) ? r : a, pts[0]);
  const tile = (l, v, s) => `<div class="hst"><span class="l">${l}</span><b class="num">${v}</b><span class="s">${s}</span></div>`;
  const stats = `<div class="hstats" role="group" aria-label="Riepilogo dell'andamento, ${esc(fName)}">` +
    tile("Ultimo", `${eur(pp(last))} <small>${unit}</small>`, `${fmtD(last.d)} · coppia ${eur(pp(last) * 2)}${last.g[F][7] ? " · stima" : ""}${last.part ? " · dato parziale" : ""}`) +
    tile("Minimo storico", `${eur(pp(lo))} <small>${unit}</small>`, lo.d === last.d ? "è il prezzo dell'ultimo giro" : `visto ${fmtD(lo.d)}`) +
    tile("Dall'inizio", prev ? hDelta(pp(first), pp(last)) : `<span class="hd eq">n.d.</span>`, prev ? `dal ${fmtD(first.d)} (${eur(pp(first))})` : "serve un secondo giro") +
    tile("Dall'ultimo giro", prev ? hDelta(pp(prev), pp(last)) : `<span class="hd eq">n.d.</span>`, prev ? `rispetto a ${fmtD(prev.d)} (${eur(pp(prev))})` : "serve un secondo giro") + `</div>`;

  const bs = histAgg(rows, H.per), n = bs.length, vals = [];
  bs.forEach(b => vis.forEach(([k]) => { if(b.g[k]) vals.push(b.g[k][0]); }));
  const mn = Math.min(...vals), mx = Math.max(...vals), step = hStep(Math.max(mx - mn, mx * 0.04, 10) / 3);
  let y0 = Math.floor(mn / step) * step, y1 = Math.ceil(mx / step) * step;
  if(y0 === y1){ y0 = Math.max(0, y0 - step); y1 += step; }
  const PH = n <= 2 ? 160 : 230, T = 30, B = 12;
  const Y = v => +(T + (1 - (v - y0) / (y1 - y0)) * (PH - T - B)).toFixed(1);
  const t0 = dt(bs[0].k).getTime(), t1 = dt(bs[n - 1].k).getTime();
  const X = b => n === 1 ? 50 : +(100 * (dt(b.k).getTime() - t0) / (t1 - t0)).toFixed(2);
  let grid = "", ylab = "";
  for(let v = y0; v <= y1 + 1e-6; v += step){ grid += `<line class="hgrid" x1="0" x2="1000" y1="${Y(v)}" y2="${Y(v)}"/>`; ylab += `<span class="hy num" style="top:${Y(v)}px">${eur(v)}</span>`; }
  const paths = vis.map(([k]) => {
    const p = bs.filter(b => b.g[k]); let so = "", da = "";
    for(let i = 1; i < p.length; i++){
      const s = `M${+(X(p[i - 1]) * 10).toFixed(1)} ${Y(p[i - 1].g[k][0])}L${+(X(p[i]) * 10).toFixed(1)} ${Y(p[i].g[k][0])}`;
      if(p[i - 1].part || p[i].part) da += s; else so += s;
    }
    return (so ? `<path class="hl s-${k}" d="${so}"/>` : "") + (da ? `<path class="hl s-${k} dash" d="${da}"/>` : "");
  }).join("");
  const dots = vis.map(([k]) => bs.map((b, i) => b.g[k] && (n <= 45 || b.part || b.g[k][7] || i === n - 1) ? `<i class="hdot s-${k}${b.part ? " part" : ""}${b.g[k][7] ? " est" : ""}" style="left:${X(b)}%;top:${Y(b.g[k][0])}px"></i>` : "").join("")).join("");
  const lb = bs[n - 1].g[F] ? bs[n - 1] : null;
  const lastLbl = lb ? `<span class="hlast num${n === 1 ? " c" : ""}" style="left:${X(lb)}%;top:${Y(lb.g[F][0])}px">${eur(lb.g[F][0])}</span>` : "";
  const bTitle = b => H.per === "month" ? `${MESI[dt(b.k).getMonth()]} ${b.k.slice(0, 4)}` : H.per === "week" ? `Settimana del ${fmtDY(b.k)}` : `${fmtD(b.k)} ${b.k.slice(0, 4)}`;
  const showA = vis.some(([k]) => k === "A");
  const cols = bs.map((b, i) => {
    const x = X(b), l = i ? (X(bs[i - 1]) + x) / 2 : 0, r = i < n - 1 ? (x + X(bs[i + 1])) / 2 : 100;
    const shown = vis.filter(([k]) => b.g[k] && !(k === "A" && vis.some(([g]) => g === b.bg)));
    const rowsTip = shown.map(([k, name]) => {
      const e = b.g[k], lk = k === "A" ? b.bg : k, lv = b.last && lk in b.last ? b.last[lk] : undefined;
      return `<span class="ht-r"><i class="hk s-${k}"></i><span class="ht-n">${esc(name)}${showA && k === b.bg ? " · il più basso" : ""}</span><b class="num">${eur(e[0])} <small>${unit}</small></b>
        <span class="ht-s">coppia ${eur(e[0] * 2)} · ${hEntry(e)}${H.per !== "day" && b.days > 1 ? ` · visto il ${fmtDY(b.on[k])}` : ""}${lv !== undefined ? ` · ultimo giro del giorno: ${lv == null ? "nessun volo trovato" : eur(lv)}` : ""}</span></span>`;
    }).join("");
    const label = `${bTitle(b)}: ` + (shown.map(([k, name]) => `${name} ${eur(b.g[k][0])} ${unit}`).join(", ") || "nessun dato per le serie scelte") + (b.part ? " (dato parziale)" : "");
    return `<button type="button" class="hcol" style="left:${+l.toFixed(2)}%;width:${+(r - l).toFixed(2)}%" aria-label="${esc(label)}"><i style="left:${+(100 * (x - l) / (r - l)).toFixed(1)}%"></i></button><span class="htip" role="tooltip" style="left:clamp(0px,calc(${x}% - 125px),calc(100% - 250px))"><b class="ht-d">${bTitle(b)}${H.per !== "day" && b.days > 1 ? ` · minimo di ${b.days} giorni` : ""}</b>${b.part ? ` <span class="est">dato parziale</span>` : ""}${rowsTip || `<span class="ht-s">Nessun dato per le serie scelte.</span>`}</span>`;
  }).join("");
  const nx = Math.min(n, 5), xi = uniq(Array.from({length:nx}, (_, i) => nx === 1 ? 0 : Math.round(i * (n - 1) / (nx - 1))));
  const xlab = xi.map(i => `<span class="hx${n > 1 && i === 0 ? " f" : n > 1 && i === n - 1 ? " e" : ""}" style="left:${X(bs[i])}%">${H.per === "month" ? `${MESI[dt(bs[i].k).getMonth()]} ${bs[i].k.slice(2, 4)}` : fmtDY(bs[i].k)}</span>`).join("");
  const desc = `Andamento del prezzo più basso per persona (${fName}): ${rows.length} ${rows.length === 1 ? "giorno" : "giorni"} di dati dal ${fmtD(first.d)} al ${fmtD(last.d)}, ultimo ${eur(pp(last))}, minimo ${eur(pp(lo))}.`;
  const seg = `<span class="seg" role="group" aria-label="Aggregazione">${[["day", "Giorno"], ["week", "Settimana"], ["month", "Mese"]].map(([v, l]) => `<button type="button" data-act="hist" data-hk="per" data-hv="${v}" aria-pressed="${H.per === v}">${l}</button>`).join("")}</span>`;
  const legend = ser.length > 1 ? `<span class="hlegs" role="group" aria-label="Serie mostrate">${ser.map(([k, name]) => `<button type="button" class="hleg" data-act="hist" data-hk="ser" data-hv="${k}" aria-pressed="${!H.off[k]}"><i class="hk s-${k}"></i>${esc(name)}</button>`).join("")}</span>` : "";
  const anyPart = rows.some(r => r.part), cell = e => e ? `<b class="num">${eur(e[0])}</b><small>${esc(e[1])} · ${fmtDY(e[2])} → ${fmtDY(addD(e[2], e[3]))} · ${hStops(e[4])}${e[5] ? ` · tot. ~${eur(e[5])}` : ""}${e[7] ? " · stima" : ""}</small>` : "n.d.";
  const table = `<details class="htab"><summary>Tabella dei valori</summary><div class="hscroll"><table><caption class="sr">${esc(desc)}</caption><thead><tr><th scope="col">${H.per === "day" ? "Giorno" : H.per === "week" ? "Settimana del" : "Mese"}</th>${ser.map(([, name]) => `<th scope="col">${esc(name)}</th>`).join("")}<th scope="col">Nota</th></tr></thead><tbody>` +
    bs.slice().reverse().map(b => `<tr><th scope="row">${H.per === "week" ? fmtDY(b.k) : bTitle(b)}</th>${ser.map(([k]) => `<td>${cell(b.g[k])}</td>`).join("")}<td>${[b.part ? "dato parziale" : "", H.per !== "day" && b.days > 1 ? `minimo di ${b.days} giorni` : "", b.n > 1 ? `${b.n} giri, minimo del giorno` : "", /locale/.test(b.src) ? "scansione dal computer" : ""].filter(Boolean).join(" · ") || "giro completo"}</td></tr>`).join("") + `</tbody></table></div></details>`;
  return `<div class="hist">
    <div class="hhead"><div><p class="eyebrow">Andamento · ${trip ? "voli" : "A/R"} per persona</p><h3 class="h3">Il prezzo <i>nel tempo</i></h3></div><div class="hctl">${seg}${legend}</div></div>
    ${stats}
    <div class="hfig${n <= 2 ? " few" : ""}"><div class="hplot" style="height:${PH}px"><svg viewBox="0 0 1000 ${PH}" preserveAspectRatio="none" role="img" aria-label="${esc(desc)}"><title>${esc(desc)}</title>${grid}${paths}</svg>${ylab}${dots}${lastLbl}${cols}</div><div class="hxax" aria-hidden="true">${xlab}</div></div>
    ${rows.length < 7 ? `<p class="note hbuild"><b>Storico in costruzione: ${rows.length} ${rows.length === 1 ? "giorno" : "giorni"} di dati.</b> Si aggiunge un punto a ogni giro di scansione, uno al giorno.</p>` : ""}
    <p class="note">Prezzo più basso trovato a ogni giro fra tutte le date di agosto, con la regola scali (2 scali solo se conviene)${trip ? "; il totale stimato aggiunge voli interni e spese a terra" : ""}. Con più giri nello stesso giorno vale il minimo. Passa sul grafico o tocca un punto per aeroporto, date e scali.${rows.some(r => HG.some(k => r.g[k] && r.g[k][7])) ? ` <b>Punto quadrato = stima</b>: quel giorno il prezzo era la somma di due solo andata, non un A/R.` : ""}${anyPart ? ` <b>Punto vuoto e tratto tratteggiato = dato parziale</b>: quel giorno la scansione ha trovato molti meno voli del solito, il prezzo vero poteva essere più basso.` : ""}</p>
    ${table}
  </div>`;
}
const histSec = id => { const h = histHTML(id); return h ? `<div class="wrap hist-w" id="hist-in">${h}</div>` : ""; };

function parse(hash){
  const h = String(hash || "").replace(/^#\/?/, "").split("?")[0], parts = h.split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch(e){ return x; } });
  if(parts[0] === "d" && parts[1]) return {page:"dest", id:parts[1].toUpperCase()};
  if(parts[0] === "t" && parts[1]) return {page:"trip", id:parts[1]};
  if(parts[0] === "crediti") return {page:"credits"};
  if(parts[0] === "preferiti") return {page:"favs"};
  if(parts[0] === "login") return {page:"login", token:parts[1] || ""};
  if(parts[0] === "voti") return {page:"rates"};
  if(parts[0] === "mappa") return {page:"map"};
  if(parts[0] === "confronto") return {page:"cmp", ids:parts[1] ? parts[1].split(",").filter(Boolean) : null};
  if(API && parts.length === 1 && h === parts[0] && ALIAS_RE.test(h) && !ROUTES.includes(h) && /^#\//.test(String(hash))) return {page:"pin", alias:h};
  return {page:"home", tab:parts[0] === "visitati" ? "vis" : parts[0] === "trips" ? "pop" : "new"};
}
function pageHTML(r){
  return r.page === "dest" ? destHTML(r.id) : r.page === "trip" ? tripHTML(r.id) : r.page === "credits" ? creditsHTML() : r.page === "favs" || r.page === "login" ? favsHTML() :
    r.page === "rates" ? votiHTML() : r.page === "pin" ? pinHTML() : r.page === "cmp" ? cmpHTML() : r.page === "map" ? mapHTML() : homeHTML();
}
function go(){
  let r = parse(location.hash);
  const prev = S.route, app = $("app");
  let hello = null;
  if(r.page === "pin"){
    const w = readWho();
    if(favLive() && w && w.alias === r.alias){
      // dispositivo gia' collegato a questo indirizzo: si va alla home, senza chiedere di nuovo il PIN
      hello = w.name || FAV.me || "";
      try { history.replaceState(null, "", "#/"); } catch(e){ /* resta l'indirizzo com'e' */ }
      r = {page:"home", tab:"new"};
    } else if(PIN.alias !== r.alias){ PIN.alias = r.alias; PIN.err = ""; PIN.until = 0; PIN.busy = false; }
  }
  if(r.page === "login"){
    // link personale mandato dal bot: si salva il token e lo si toglie subito dalla barra degli indirizzi e dalla cronologia
    if(API && r.token){ saveToken(r.token); saveWho(null); FAV.map = new Map(); FAV.state = "loading"; rateReset(); loadFavs(); loadRates(); }
    try { history.replaceState(null, "", "#/preferiti"); } catch(e){ /* resta l'indirizzo com'e' */ }
    r = {page:"favs"};
  } else if(r.page === "favs" && favLive() && FAV.state !== "loading") loadFavs();
  else if(r.page === "rates" && favLive() && RATE.state !== "loading"){ S.v.n = 30; loadRates(); }
  else if(r.page === "cmp" && r.ids){
    // link condivisibile #/confronto/d_DPS,t_x: la scelta arriva dall'indirizzo e diventa quella del dispositivo
    CMP.ids = uniq(r.ids.filter(x => item(x))).slice(0, CMP_MAX); S.c.hide = CMP.ids.length - 1; cmpSave();
  }
  S.prev = prev;
  if(prev && prev.page === "home") S.homeY = window.scrollY || 0;
  clearInterval(S.heroT);
  if(r.page === "home"){
    const sameHome = prev && prev.page === "home";
    if(sameHome && r.tab !== S.tab){ S.f.area = "all"; S.f.country = "all"; }
    S.tab = r.tab; S.page = "home"; S.route = r;
    if(!sameHome){ app.innerHTML = homeHTML(); startHero(); }
    updateHome();
    document.title = "Agosto 2027 da Milano";
    if(!sameHome) window.scrollTo(0, prev ? S.homeY : 0);
    else if(S.panel) setPanel(false);
  } else {
    S.page = r.page; S.route = r; S.panel = false;
    app.innerHTML = pageHTML(r);
    const name = r.page === "dest" ? (DEST[r.id] || {}).city : r.page === "trip" ? (PT[r.id] || {}).name : r.page === "favs" ? "Preferiti" : r.page === "rates" ? "Voti" : r.page === "cmp" ? "Confronto" : r.page === "map" ? "Mappa" : r.page === "pin" ? "Accesso" : "Crediti foto";
    document.title = (name ? name + " · " : "") + "Agosto 2027 da Milano";
    window.scrollTo(0, 0);
  }
  if(r.page === "pin"){ const el = $("pin-in"); if(el && el.focus) el.focus(); }
  if(hello !== null) toast(hello ? `Ciao ${hello}` : "Ciao! Dispositivo collegato");
  cmpBar();
  onScroll();
}
function startHero(){
  if(!S.hero || S.hero.length < 2) return;
  if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  S.heroT = setInterval(() => {
    const bg = $("hero-bg"); if(!bg || document.hidden) return;
    i = (i + 1) % S.hero.length;
    const h = S.hero[i], p = PHO[h.k], im = new Image(), ss = srcsetOf(p);
    im.onload = () => {
      const el = document.createElement("img");
      if(ss){ el.srcset = ss; el.sizes = SIZES.hero; }
      el.src = p.f; el.width = p.w; el.height = p.h; el.alt = "";
      bg.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bg.querySelectorAll("img.on").forEach(x => { x.classList.remove("on"); setTimeout(() => x.remove(), 1600); });
        el.classList.add("on");
        $("hero-city").textContent = h.city; $("hero-pp").textContent = heroPP(h); $("hero-cap").textContent = p.cap;
        $("hero-note").setAttribute("href", "#/d/" + h.code); $("hero-credit").innerHTML = esc(p.cap) + " · " + creditTxt(h.k);
      }));
    };
    if(ss){ im.sizes = SIZES.hero; im.srcset = ss; }
    im.src = p.f;
  }, 7000);
}
function onScroll(){
  const top = $("top"); if(!top || !top.classList) return;
  if(S.page === "credits" || (top.dataset && top.dataset.solid)) return;
  top.classList.toggle("solid", (window.scrollY || 0) > 80);
}
function openLb(i){
  const lb = $("lb"), k = S.lb[i]; if(!k) return;
  S.lbi = i;
  const p = PHO[k];
  $("lb-fig").innerHTML = `${img(k, {eager:true, sz:"full"})}<figcaption><b>${esc(p.cap)}</b>${creditTxt(k)}</figcaption>`;
  if(!lb.open && lb.showModal) lb.showModal();
}
function setF(k, v){
  const st = S.page === "trip" || (S.page === "home" && S.tab === "pop") ? S.p : S.f;
  st[k] = (k === "stops" || k === "budget") ? +v : v;
  if(S.page === "home") updateHome();
  else if(S.page === "dest") $("voli-in").innerHTML = voliD(S.route.id);
  else if(S.page === "trip") $("voli-in").innerHTML = voliT(S.route.id);
}
function init(){
  if("scrollRestoration" in history) history.scrollRestoration = "manual";
  document.addEventListener("click", e => {
    const t = e.target, act = t.closest("[data-act]");
    const tn = $("topnav");
    if(tn && tn.classList.contains("open") && !(act && act.dataset.act === "menu")){ tn.classList.remove("open"); const mb = document.querySelector(".menu-b"); if(mb) mb.setAttribute("aria-expanded", "false"); }
    if(act){
      const a = act.dataset.act;
      if(a === "menu"){ const on = !tn.classList.contains("open"); tn.classList.toggle("open", on); act.setAttribute("aria-expanded", String(on)); return; }
      if(a === "fav" || a === "fav-rm"){ e.preventDefault(); toggleFav(act.dataset.id); return; }
      if(a === "fav-retry"){ FAV.state = "loading"; favPaint(); loadFavs(); return; }
      if(a === "fav-logout"){ saveToken(""); saveWho(null); FAV.map = new Map(); FAV.me = ""; FAV.state = "anon"; rateReset(); favPaint(); ratePaint(); return; }
      if(a === "rate"){ e.preventDefault(); const me = rateMe(), v = act.dataset.s === "" ? null : +act.dataset.s; setRate(act.dataset.id, me && v != null && rateOf(act.dataset.id, me.k) === v ? null : v); return; }
      if(a === "rate-retry"){ RATE.state = "loading"; ratePaint(); loadRates(); return; }
      if(a === "cmp"){ e.preventDefault(); cmpToggle(act.dataset.id); return; }
      if(a === "cmp-clear"){ CMP.ids = []; cmpSave(); cmpPaint(); return; }
      if(a === "cmp-hide"){ S.c.hide = +act.dataset.i; $("app").innerHTML = cmpHTML(); return; }
      if(a === "vt"){ S.v[act.dataset.k] = act.dataset.v; S.v.n = 30; $("voti-in").innerHTML = votiBody(); return; }
      if(a === "vt-more"){ S.v.n += 30; $("voti-in").innerHTML = votiBody(); return; }
      if(a === "mp"){ S.m[act.dataset.k] = act.dataset.v; $("map-in").innerHTML = mapBody(); return; }
      if(a === "map-retry"){ WORLD.state = "idle"; loadWorld(); $("map-in").innerHTML = mapBody(); return; }
      if(a === "back"){ if(S.prev && S.prev.page === "home"){ e.preventDefault(); history.back(); } return; }
      if(a === "panel"){ setPanel(!S.panel); return; }
      if(a === "panel-close"){ setPanel(false); return; }
      if(a === "reset"){ if(S.tab === "pop") S.p = Object.assign({}, P0, {sort:S.p.sort}); else S.f = Object.assign({}, F0, {sort:S.f.sort}); updateHome(); return; }
      if(a === "rm"){ const st = S.tab === "pop" ? S.p : S.f; st[act.dataset.k] = (S.tab === "pop" ? P0 : F0)[act.dataset.k]; updateHome(); return; }
      if(a === "scroll"){ const el = $(act.dataset.to); if(el) el.scrollIntoView({behavior:"smooth", block:"start"}); return; }
      if(a === "hist"){
        if(act.dataset.hk === "per") S.h.per = act.dataset.hv; else S.h.off[act.dataset.hv] = !S.h.off[act.dataset.hv];
        const el = $("hist-in"); if(el && S.route) el.innerHTML = histHTML((S.page === "trip" ? "t_" : "d_") + S.route.id);
        return;
      }
      if(a === "lb"){ openLb(+act.dataset.i); return; }
      if(a === "lb-x"){ $("lb").close(); return; }
      if(a === "lb-p"){ openLb((S.lbi - 1 + S.lb.length) % S.lb.length); return; }
      if(a === "lb-n"){ openLb((S.lbi + 1) % S.lb.length); return; }
    }
    if(t.id === "lb"){ t.close(); return; }
    const chip = t.closest("button[data-k][data-v]");
    if(chip){ setF(chip.dataset.k, chip.dataset.v); return; }
    const cell = t.closest("[data-cell]");
    if(cell){ S.cell = cell.dataset.cell; $("voli-in").innerHTML = S.page === "trip" ? voliT(S.route.id) : voliD(S.route.id); return; }
  });
  document.addEventListener("change", e => {
    const s = e.target.closest("select[data-k]"); if(s){ setF(s.dataset.k, s.value); return; }
    const v = e.target.closest("select[data-vk]"); if(v){ S.v[v.dataset.vk] = v.value; S.v.n = 30; $("voti-in").innerHTML = votiBody(); }
  });
  document.addEventListener("submit", e => { if(e.target && e.target.id === "pin-form"){ e.preventDefault(); pinSubmit(); } });
  document.addEventListener("input", e => {
    if(e.target.id !== "pin-in") return;
    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
    if(v !== e.target.value) e.target.value = v;
    if(v.length === 4) pinSubmit(v);   // quattro cifre: si prova subito, senza dover toccare "Entra"
  });
  document.addEventListener("input", e => { if(e.target.id === "q"){ (S.tab === "pop" ? S.p : S.f).q = e.target.value.trim(); updateHome(); } });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && S.panel) setPanel(false);
    if($("lb").open){ if(e.key === "ArrowLeft") openLb((S.lbi - 1 + S.lb.length) % S.lb.length); if(e.key === "ArrowRight") openLb((S.lbi + 1) % S.lb.length); }
  });
  window.addEventListener("hashchange", go);
  window.addEventListener("scroll", onScroll, {passive:true});
  FAV.token = API ? readToken() : "";
  FAV.who = FAV.token ? readWho() : null;
  FAV.state = !API ? "off" : FAV.token ? "loading" : "anon";
  CMP.ids = cmpRead();
  if(favLive()){ loadFavs(); loadRates(); }
  go();
}
const App = {S, parse, pageHTML, homeParts, aggD, aggT, viewD, viewT, go, favUrl, BOT_USERNAME, API, FAV, favsHTML, toggleFav, loadFavs, flightT, histHTML, histRows, histAgg, HIST,
  PIN, pinHTML, pinSubmit, readWho, RATE, loadRates, setRate, rateBlockIn, rateChipIn, rateBlock, rateChip, votiHTML, votiList, votiPool, votiSort, eur, priceLevel, priceBadge, CMP, cmpToggle, cmpHTML, cmpBarHTML, item, mapHTML, mapBody, mapPoints, mapXY, loadWorld, WORLD, img, srcsetOf};
if(typeof window !== "undefined") window.App = App;
init();
  return App;
}
/* ------------------------------------------------------------------ avvio: stato di caricamento, dati, errore */
const BOOT = {busy:false, bound:false};
function bootMsg(html){ const a = document.getElementById("app"); if(a) a.innerHTML = `<div class="boot" role="status" aria-live="polite">${html}</div>`; }
async function boot(){
  if(BOOT.busy) return;
  const pre = typeof window !== "undefined" && window.__DATA__;
  if(pre) return start(pre.raw, pre.photos);
  if(!BOOT.bound){ BOOT.bound = true; document.addEventListener("click", e => { if(e.target && e.target.closest && e.target.closest("#boot-retry")) boot(); }); }
  BOOT.busy = true;
  bootMsg(`<span class="boot-dot" aria-hidden="true"></span><b>Agosto 2027</b><span>Carico mete e prezzi…</span>`);
  try {
    const r = await fetch(DATA_URL);
    if(!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    if(!j || !j.raw || !j.photos) throw new Error("dati incompleti");
    BOOT.busy = false;
    start(j.raw, j.photos);
  } catch(e){
    BOOT.busy = false;
    bootMsg(`<b>Agosto 2027</b><span>Non riesco a caricare mete e prezzi. Controlla la connessione.</span><button class="btn" id="boot-retry" type="button">Riprova</button>`);
  }
}
if(typeof document !== "undefined") boot();
