/* Agosto 2027 v2: sito di viaggio a pagine (hash routing). Dati: RAW (build.py + build_trips.py), foto: PH (img/manifest.json).
   Rotte: #/ (nuove mete) · #/visitati · #/trips · #/d/<IATA> · #/t/<trip.id> · #/crediti */
"use strict";
const BOT_USERNAME = "Trip2027_bot";
const RAW = /*__DATA__*/;
const PH = /*__PHOTOS__*/;

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
function img(k, o){
  const p = PHO[k]; o = o || {};
  return `<img src="${esc(p.f)}" width="${p.w}" height="${p.h}" alt="${esc(o.alt || p.cap)}"${o.eager ? ` fetchpriority="high"` : ` loading="lazy"`} decoding="async"${o.cls ? ` class="${o.cls}"` : ""}>`;
}
const creditTxt = k => { const p = PHO[k]; return p ? `Foto: <a href="${esc(safeUrl(p.src))}" target="_blank" rel="noopener">${esc(p.by)}</a> · ${esc(p.lic)}` : ""; };
const noPhoto = txt => `<span class="nophoto" aria-hidden="true">${esc(txt)}</span>`;

/* ------------------------------------------------------------------ stato */
const F0 = {q:"", origin:"all", area:"all", country:"all", budget:0, stops:1, dur:"all", dep:"all", clima:"all", sort:"score"};
const P0 = {q:"", origin:"all", kind:"all", area:"all", style:"all", budget:0, stops:1, sort:"tot"};
const S = {tab:"new", f:Object.assign({}, F0), p:Object.assign({}, P0), panel:false, cell:null, homeY:0, depth:0, route:null, page:null, lb:[], lbi:0, heroT:null};
const TABS = {new:{hash:"#/", label:"Nuove mete", sub:"Paesi dove non siete mai stati, scelti per il clima di agosto."},
              vis:{hash:"#/visitati", label:"Già visitati", sub:"Paesi che conoscete già, con un giro diverso da quello fatto."},
              pop:{hash:"#/trips", label:"Popular trips", sub:"Itinerari completi, anche open-jaw: tappe, voli e costo a terra."}};
const favUrl = id => `https://t.me/${BOT_USERNAME}?start=fav_${encodeURIComponent(id)}`;
const star = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>`;
const favBtn = (id, name) => `<a class="fav" href="${favUrl(id)}" target="_blank" rel="noopener" aria-label="Salva ${esc(name)} tra i preferiti su Telegram" title="Salva tra i preferiti (Telegram)">${star}</a>`;

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
    <div class="card-ph">${k ? img(k, {alt:PHO[k].cap + ", " + d.country}) : noPhoto(d.code)}
      <div class="card-top"><span class="bs"><span class="b glass">clima ${esc(d.g)}</span>${oBadge(b.c.o, a.origins, true)}</span>
        <span class="card-r"><span class="score" title="Punteggio 0-100: prezzo pp 50%, comodità 25%, clima 25%"><span class="sr">Punteggio </span>${a.bestS}</span></span></div>
      <div class="card-name"><span class="k">${esc(d.country)} · <span class="iata">${esc(d.code)}</span></span><h3 class="n">${esc(d.city)}</h3></div>
    </div>
    <div class="card-bd">
      <div class="pr"><span class="pp num">${eur(a.min)}</span><span class="u">a persona · A/R</span><span class="cp num">coppia ${eur(a.min * 2)}</span></div>
      <p class="meta"><b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b> · ${b.c.n} giorni · da ${esc(oName(b.c.o))} · ${stopsTxt(b.o.f)}${a.max > a.min ? ` · altre date fino a ${eur(a.max)}` : ""}</p>
      ${d.giro ? `<p class="giro"><s>${esc(d.seen)}</s> → <b>${esc(d.giro)}</b></p>` : ""}
      <div class="bs">${alsoBadge(b.c.o, a.origins)}<span class="b plain">${esc(d.temp)}</span>${d.flag ? `<span class="b warn wrapb">${esc(d.flag)}</span>` : ""}${twoBadge(b.o)}</div>
    </div>
    <a class="card-link" href="#/d/${esc(d.code)}"><span class="sr">Apri ${esc(d.city)}, da ${eur(a.min)} a persona</span></a>
    ${favBtn("d_" + d.code, d.city)}
  </article>`;
}
function cardT(a, i, feat){
  const t = a.t, o = a.cheap.o, c = a.cheap.c, k = coverT(t), ret = addD(c.dep, c.n);
  return `<article class="card pop rise${feat ? " feat" : ""}" style="--i:${Math.min(i, 8)}">
    <div class="card-ph">${k ? img(k, {alt:PHO[k].cap + ", " + t.name}) : noPhoto(t.arr)}
      <div class="card-top"><span class="bs"><span class="b glass">${t.type === "oj" ? "open-jaw" : "A/R"}</span><span class="b glass">clima ${esc(t.g)}</span>${oBadge(c.o, a.origins, true)}</span>
        <span class="card-r"><span class="score" title="Punteggio 0-100: totale stimato pp 50%, comodità voli 25%, clima 25%"><span class="sr">Punteggio </span>${a.bestS}</span></span></div>
      <div class="card-name"><span class="k">${esc(t.countries.join(" + "))} · ${t.nights} notti</span><h3 class="n">${esc(t.name)}</h3></div>
    </div>
    <div class="card-bd">
      <div class="pr"><span class="pp num">${eur(o.voli)}</span><span class="u">a persona · voli</span><span class="cp num">coppia ${eur(o.voli * 2)}</span></div>
      <div class="pr2"><span>Totale stimato <b class="num">${eur(a.min)} pp</b> <span class="est">stima</span></span><span class="num">coppia ${eur(a.min * 2)}</span></div>
      <p class="meta"><b>${fmtD(c.dep)} → ${fmtD(ret)}</b> · ${c.n} giorni · da ${esc(oName(c.o))} · ${howTxt(t, o)}</p>
      <p class="meta">${t.stages.map(s => esc(s[0])).join(" → ")}</p>
      <div class="bs">${alsoBadge(c.o, a.origins)}<span class="b plain">ritmo ${esc(t.pace)}</span>${t.visited ? `<span class="b plain">giro nuovo</span>` : ""}${t.flag ? `<span class="b warn wrapb">${esc(t.flag)}</span>` : ""}${ptwoBadge(o)}</div>
    </div>
    <a class="card-link" href="#/t/${esc(t.id)}"><span class="sr">Apri ${esc(t.name)}, voli da ${eur(o.voli)} a persona</span></a>
    ${favBtn("t_" + t.id, t.name)}
  </article>`;
}

/* ------------------------------------------------------------------ home */
function topHTML(detail){
  const nav = Object.entries(TABS).map(([k, t]) => `<a href="${t.hash}"${!detail && S.page === "home" && S.tab === k ? ` aria-current="page"` : ""}${k === "vis" ? ` class="opt"` : ""}>${t.label}</a>`).join("");
  return `<div class="top${detail === "plain" ? " solid" : ""}" id="top"><div class="wrap top-in">
    ${detail ? `<a class="back" href="${TABS[S.tab].hash}" data-act="back"><span aria-hidden="true">←</span> Tutte le mete</a>` : `<a class="brand" href="#/">Agosto 2027<i>da Milano</i></a>`}
    <nav aria-label="Sezioni">${detail ? `<a class="brand" href="#/">Agosto 2027</a>` : nav}</nav></div></div>`;
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
  return `<footer class="foot"><div class="wrap foot-in"><span>Agosto 2027 da Milano · prezzi Google Flights al ${esc(META.date || "")}</span>
    <span><a href="#/crediti">Crediti delle foto</a> · <a href="https://t.me/${BOT_USERNAME}" target="_blank" rel="noopener">Bot Telegram</a></span></div></footer>`;
}
function homeHTML(){
  const picks = S.hero = heroPicks(), p0 = picks[0];
  const bg = p0 ? img(p0.k, {eager:true, cls:"on", alt:""}) : "";
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
    <section class="sec wrap"><details class="xlists"><summary><span class="eyebrow">Mete escluse</span><span class="xl-t">Scartate per scali o clima, voli non ancora in vendita</span><span class="xl-i" aria-hidden="true">+</span></summary><div class="lists" id="lists"></div></details></section>
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
  const stops = tabD.filter(d => d.g !== "sconsigliato" && !valid.has(d.code) && cov(d.code)[1] > 0);
  const nodata = tabD.filter(d => d.g !== "sconsigliato" && cov(d.code)[1] === 0);
  const clima = tabD.filter(d => d.g === "sconsigliato");
  const box = (t, items, sub) => `<div class="lbox"><h3>${t}</h3><p class="note">${sub}</p><ul>${items.length ? items.join("") : "<li><span>nessuna</span></li>"}</ul></div>`;
  const a = d => `<a href="#/d/${esc(d.code)}">${esc(d.city)}</a>`;
  return box("Scartate per troppi scali", stops.map(d => `<li>${a(d)} <span>${esc(d.code)} · solo con 2 scali${cov(d.code)[2] ? ", da " + eur(cov(d.code)[2]) + " pp" : ""}</span></li>`), "Nessuna opzione con al massimo 1 scalo per tratta nelle date richieste.") +
    box("Voli non ancora disponibili", nodata.map(d => `<li>${a(d)} <span>${esc(d.code)} · ${esc(d.country)}</span></li>`), `Al ${esc(META.date || "")} Google Flights non aveva tariffe per agosto 2027 su queste rotte: da ricontrollare più avanti.`) +
    box("Scartate per clima", clima.map(d => `<li>${a(d)} <span>· ${esc(d.temp)}, ${esc(d.rain)}. ${esc(d.why)}</span></li>`).concat((RAW.excluded || []).map(e => `<li><span>${esc(e)}</span></li>`)), "Troppo caldo o in piena stagione di piogge, monsoni, uragani; in coda le esclusioni a monte.");
}
function notesD(){
  return `<p><b>Prezzi.</b> Google Flights al ${esc(META.date || "")}, A/R per persona in economy (tariffa base, 1 adulto); il prezzo coppia è il doppio. A nove mesi dalla partenza molte compagnie non hanno ancora caricato agosto 2027: i prezzi sono indicativi e l'offerta crescerà.</p>
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
    <div class="gal n${keys.length}">${keys.map((k, i) => `<button data-act="lb" data-i="${i}" aria-label="Ingrandisci: ${esc(PHO[k].cap)}">${img(k)}<span class="cap"><b>${esc(PHO[k].cap)}</b><small>${esc(PHO[k].by)} · ${esc(PHO[k].lic)}</small></span></button>`).join("")}</div></section>`;
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
    const tl = t.t.map((x, i) => { const k = stageKey(x[0]); return `<li><span class="ph${k ? "" : " none"}" data-i="${i + 1}">${k ? img(k, {alt:PHO[k].cap}) : ""}</span><span class="rail"></span><span class="n">${esc(x[0])}</span><span class="d">${x[1]} ${x[1] === 1 ? "notte" : "notti"}</span></li>`; }).join("");
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
    const msg = any ? "Nessun volo con questi filtri: prova un altro aeroporto o più scali." : cov[1] > 0 ? `Per ora solo voli con 2 scali per tratta${cov[2] ? ", da " + eur(cov[2]) + " pp" : ""}.` : `Al ${esc(META.date || "")} Google Flights non ha ancora tariffe per agosto 2027 su questa rotta.`;
    return head + (any ? ctl : "") + `<p class="empty" style="margin-top:20px">${msg}</p>`;
  }
  if(!S.cell || !a.cellBest[S.cell]) S.cell = a.cheap.c.dep + "|" + a.cheap.c.n;
  const [dep, n] = S.cell.split("|"), ret = addD(dep, +n);
  const mx = mxHTML(a.cellBest, S.cell, x => x.o.f[0], x => oName(x.c.o) + (x.o.two ? " · 2 scali" : ""));
  let fl = "";
  const cs = (BYD[code] || []).filter(c => c.dep === dep && c.n === +n && oMatch(c.o, S.f.origin)).sort((x, y) => oRank(x.o) - oRank(y.o));
  for(const c of cs) for(const o of options(c, S.f.stops)){
    const f = o.f;
    fl += `<div class="fl"><div class="fl-l">
      <div class="fl-t"><span class="apt${c.o === "LIN" ? " lin" : ""}">${esc(f[8])}</span>${esc(f[4])} → ${esc(f[5])}${f[6] ? `<sup>+${f[6]}</sup>` : ""} ${esc(f[9])}</div>
      <div class="fl-m">${esc(f[1])} · ${stopsTxt(f)} · ${hm(f[2])} all'andata · punteggio ${scoreOf(f, d)}/100</div>
      ${o.two || c.o === "LIN" ? `<div class="bs">${c.o === "LIN" ? `<span class="b ok">da Linate</span>` : ""}${twoBadge(o)}</div>` : ""}
    </div><div class="fl-r"><div class="pp num">${eur(f[0])} <small>PP</small></div><div class="cp num">coppia ${eur(f[0] * 2)}</div><a href="${gfD(c.o, code, dep, ret)}" target="_blank" rel="noopener">Google Flights ↗</a></div></div>`;
  }
  return head + ctl + `<div class="v-cols"><div><h3 class="h3">Andata × durata</h3>${mx}<p class="note" style="margin-top:10px">Prezzo A/R per persona più basso della combinazione, con l'aeroporto sotto. Più intenso = più economico, il punto giallo segna il minimo. Tocca una cella per i voli.</p></div>
    <div><h3 class="h3">${fmtD(dep)} → ${fmtD(ret)} · ${n} giorni</h3>${fl}
    <p class="note">Orari, scali e durata si riferiscono all'andata; il prezzo è il totale A/R per persona con il ritorno più economico entro lo stesso limite di scali (il ritorno si sceglie su Google Flights).</p>
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
    <div class="hero-bg">${k ? img(k, {eager:true, cls:"on", alt:PHO[k].cap + ", " + d.country}) : noPhoto(d.code)}</div>
    ${k ? `<p class="credit">${esc(PHO[k].cap)} · ${creditTxt(k)}</p>` : ""}
    <div class="wrap hero-in">
      <p class="kicker rise">${esc(d.country)}<span class="dot"></span>${esc(d.area)}<span class="dot"></span><span class="iata">${esc(d.code)}</span></p>
      <h1 class="title rise${d.city.length > 14 ? " long" : ""}" style="--i:1">${esc(d.city)}</h1>
      <div class="hero-row rise" style="--i:2">
        <div class="d-cta">
          ${b ? `<div class="tag"><span class="pp num">${eur(a.min)}</span><span class="u">a persona · A/R<small class="num">coppia ${eur(a.min * 2)}</small></span></div>` : `<div class="tag"><span class="pp">n.d.</span><span class="u">voli<small>non ancora in vendita</small></span></div>`}
          <div class="d-when">${b ? `<b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b><span>${b.c.n} giorni · da ${esc(oName(b.c.o))} · ${stopsTxt(b.o.f)}</span>` : `<span>Date da ricontrollare più avanti</span>`}</div>
        </div>
        <div class="d-cta">${b ? `<button class="btn sun" data-act="scroll" data-to="voli">Vedi i voli</button>` : ""}<a class="btn ghost" href="${favUrl("d_" + code)}" target="_blank" rel="noopener">${star} Salva tra i preferiti</a></div>
      </div>
      <div class="d-facts rise" style="--i:3"><span class="b glass">clima ${esc(d.g)}</span><span class="b glass">${esc(d.temp)}</span>${a ? `<span class="b glass">punteggio ${a.bestS}/100</span>` : ""}${a ? oBadge(b.c.o, a.origins, true) : ""}${d.flag ? `<span class="b glass">${esc(d.flag)}</span>` : ""}</div>
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
    <section class="voli sec" id="voli"><div class="wrap" id="voli-in">${voliD(code)}</div></section>
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
  const stages = t.stages.map((s, i) => { const sk = stageKey(s[0]); return `<li><span class="ph${sk ? "" : " none"}" data-i="${i + 1}">${sk ? img(sk, {alt:PHO[sk].cap}) : ""}</span><div class="tx"><span class="d">${s[1]} ${s[1] === 1 ? "notte" : "notti"}</span><h3 class="n">${esc(s[0])}</h3><p class="s">${esc(s[2])}</p></div></li>`; }).join("");
  return topHTML("photo") + `
  <header class="hero d">
    <div class="hero-bg">${k ? img(k, {eager:true, cls:"on", alt:PHO[k].cap + ", " + t.name}) : noPhoto(t.arr)}</div>
    ${k ? `<p class="credit">${esc(PHO[k].cap)} · ${creditTxt(k)}</p>` : ""}
    <div class="wrap hero-in">
      <p class="kicker rise">Popular trip<span class="dot"></span>${esc(t.countries.join(" + "))}<span class="dot"></span>${t.nights} notti</p>
      <h1 class="title long rise" style="--i:1">${esc(t.name)}</h1>
      <p class="route rise" style="--i:1">${routeTxt(t)}</p>
      <div class="hero-row rise" style="--i:2">
        <div class="d-cta">
          ${b ? `<div class="tag"><span class="pp num">${eur(b.o.voli)}</span><span class="u">a persona · voli<small class="num">totale stimato ~${eur(a.min)} pp</small></span></div>` : `<div class="tag"><span class="pp num">${eur(t.land[0])}+</span><span class="u">a persona · a terra<small>voli non ancora disponibili</small></span></div>`}
          <div class="d-when">${b ? `<b>${fmtD(b.c.dep)} → ${fmtD(ret)}</b><span>${b.c.n} giorni · da ${esc(oName(b.c.o))} · coppia ${eur(a.min * 2)} tutto compreso</span>` : `<span>Date da ricontrollare più avanti</span>`}</div>
        </div>
        <div class="d-cta"><button class="btn sun" data-act="scroll" data-to="voli">Costi e voli</button><a class="btn ghost" href="${favUrl("t_" + id)}" target="_blank" rel="noopener">${star} Salva tra i preferiti</a></div>
      </div>
      <div class="d-facts rise" style="--i:3"><span class="b glass">${t.type === "oj" ? "open-jaw" : "A/R"}</span><span class="b glass">clima ${esc(t.g)}</span><span class="b glass">${esc(t.temp)}</span><span class="b glass">ritmo ${esc(t.pace)}</span>${a ? `<span class="b glass">punteggio ${a.bestS}/100</span>` : ""}${a ? oBadge(b.c.o, a.origins, true) : ""}</div>
    </div>
  </header>
  <main>
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
    <section class="voli sec" id="voli"><div class="wrap" id="voli-in">${voliT(id)}</div></section>
  </main>` + footHTML();
}
function creditsHTML(){
  const items = Object.entries(PHO).sort((a, b) => a[1].cap.localeCompare(b[1].cap, "it")).map(([k, p]) =>
    `<li>${img(k)}<span><b>${esc(p.cap)}</b>${esc(p.by)} · ${esc(p.lic)} · <a href="${esc(safeUrl(p.src))}" target="_blank" rel="noopener">${/flickr\.com/.test(p.src) ? "Flickr" : "Wikimedia Commons"} ↗</a></span></li>`).join("");
  return topHTML("plain") + `<main class="wrap cr-head sec"><p class="eyebrow">Crediti</p><h1 class="h2" style="margin:8px 0 14px">Le foto <i>e chi le ha fatte</i></h1>
    <p class="sub">${Object.keys(PHO).length} fotografie da Wikimedia Commons e Flickr (trovate con Openverse), con licenze libere (CC0, CC BY, CC BY-SA, pubblico dominio). Sono state ridimensionate e convertite in WebP; ogni voce rimanda alla pagina originale con autore e licenza.</p>
    <ul class="cr">${items}</ul></main>` + footHTML();
}

/* ------------------------------------------------------------------ router */
function parse(hash){
  const h = String(hash || "").replace(/^#\/?/, "").split("?")[0], parts = h.split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch(e){ return x; } });
  if(parts[0] === "d" && parts[1]) return {page:"dest", id:parts[1].toUpperCase()};
  if(parts[0] === "t" && parts[1]) return {page:"trip", id:parts[1]};
  if(parts[0] === "crediti") return {page:"credits"};
  return {page:"home", tab:parts[0] === "visitati" ? "vis" : parts[0] === "trips" ? "pop" : "new"};
}
function pageHTML(r){
  return r.page === "dest" ? destHTML(r.id) : r.page === "trip" ? tripHTML(r.id) : r.page === "credits" ? creditsHTML() : homeHTML();
}
function go(){
  const r = parse(location.hash), prev = S.route, app = $("app");
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
    const name = r.page === "dest" ? (DEST[r.id] || {}).city : r.page === "trip" ? (PT[r.id] || {}).name : "Crediti foto";
    document.title = (name ? name + " · " : "") + "Agosto 2027 da Milano";
    window.scrollTo(0, 0);
  }
  onScroll();
}
function startHero(){
  if(!S.hero || S.hero.length < 2) return;
  if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  S.heroT = setInterval(() => {
    const bg = $("hero-bg"); if(!bg || document.hidden) return;
    i = (i + 1) % S.hero.length;
    const h = S.hero[i], p = PHO[h.k], im = new Image();
    im.onload = () => {
      const el = document.createElement("img");
      el.src = p.f; el.width = p.w; el.height = p.h; el.alt = "";
      bg.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bg.querySelectorAll("img.on").forEach(x => { x.classList.remove("on"); setTimeout(() => x.remove(), 1600); });
        el.classList.add("on");
        $("hero-city").textContent = h.city; $("hero-pp").textContent = heroPP(h); $("hero-cap").textContent = p.cap;
        $("hero-note").setAttribute("href", "#/d/" + h.code); $("hero-credit").innerHTML = esc(p.cap) + " · " + creditTxt(h.k);
      }));
    };
    im.src = p.f;
  }, 7000);
}
function onScroll(){
  const top = $("top"); if(!top || !top.classList) return;
  if(S.page === "credits") return;
  top.classList.toggle("solid", (window.scrollY || 0) > 80);
}
function openLb(i){
  const lb = $("lb"), k = S.lb[i]; if(!k) return;
  S.lbi = i;
  const p = PHO[k];
  $("lb-fig").innerHTML = `${img(k, {eager:true})}<figcaption><b>${esc(p.cap)}</b>${creditTxt(k)}</figcaption>`;
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
    if(act){
      const a = act.dataset.act;
      if(a === "back"){ if(S.prev && S.prev.page === "home"){ e.preventDefault(); history.back(); } return; }
      if(a === "panel"){ setPanel(!S.panel); return; }
      if(a === "panel-close"){ setPanel(false); return; }
      if(a === "reset"){ if(S.tab === "pop") S.p = Object.assign({}, P0, {sort:S.p.sort}); else S.f = Object.assign({}, F0, {sort:S.f.sort}); updateHome(); return; }
      if(a === "rm"){ const st = S.tab === "pop" ? S.p : S.f; st[act.dataset.k] = (S.tab === "pop" ? P0 : F0)[act.dataset.k]; updateHome(); return; }
      if(a === "scroll"){ const el = $(act.dataset.to); if(el) el.scrollIntoView({behavior:"smooth", block:"start"}); return; }
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
  document.addEventListener("change", e => { const s = e.target.closest("select[data-k]"); if(s) setF(s.dataset.k, s.value); });
  document.addEventListener("input", e => { if(e.target.id === "q"){ (S.tab === "pop" ? S.p : S.f).q = e.target.value.trim(); updateHome(); } });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && S.panel) setPanel(false);
    if($("lb").open){ if(e.key === "ArrowLeft") openLb((S.lbi - 1 + S.lb.length) % S.lb.length); if(e.key === "ArrowRight") openLb((S.lbi + 1) % S.lb.length); }
  });
  window.addEventListener("hashchange", go);
  window.addEventListener("scroll", onScroll, {passive:true});
  go();
}
const App = {S, parse, pageHTML, homeParts, aggD, aggT, viewD, viewT, go, favUrl, BOT_USERNAME};
if(typeof window !== "undefined") window.App = App;
if(typeof document !== "undefined") init();
