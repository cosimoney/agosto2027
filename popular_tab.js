/* Tab "Popular trips" — modulo autonomo. Dati: RAW.trips_popular (trips_data.json, vedi build_trips.py).
   Uso:  PopularTrips.mount(document.getElementById("pop-root"), RAW.trips_popular, {countEl: document.getElementById("tn-pop")});
   Non tocca lo stato del template: ascolta solo i click dentro il proprio root (e ferma la propagazione). */
(function(root){
"use strict";
const MESI = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const GIORNI = ["dom","lun","mar","mer","gio","ven","sab"];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const eur = n => Math.round(n).toLocaleString("it-IT") + " €";
const dt = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); };
const fmtD = iso => { const x = dt(iso); return `${GIORNI[x.getDay()]} ${x.getDate()} ${MESI[x.getMonth()]}`; };
const addD = (iso, n) => { const x = dt(iso); x.setDate(x.getDate()+n); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
const hm = m => `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m`;
const clamp = x => Math.max(0, Math.min(1, x));
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch(e){ return u; } };

/* ---- link Google Flights: stesso tfs (protobuf) che genera fast-flights, trip 1=A/R 2=solo andata 3=multi-city ---- */
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

function create(D){
  const L = D.legs, CITY = D.city, CL = D.clima;
  const state = { origin:"all", area:"all", kind:"all", style:"all", budget:0, stops:1, sort:"tot", open:null, cell:null };
  const mid = t => (t.land[0] + t.land[1]) / 2;
  const city = c => CITY[c] || c;

  /* opzione = [indice air, prezzo voli Google pp, extra stimato pp, leg andata, leg ritorno|-1] */
  function view(t, op, two, ref){
    const a = t.air[op[0]], fl = op[1], extra = op[2], out = L[op[3]], back = op[4] >= 0 ? L[op[4]] : null;
    const interni = t.itot + extra;
    const v = {op, a, two:!!two, voli:fl, extra, interni, out, back,
      lo: fl + interni + t.land[0], hi: fl + interni + t.land[1], tot: Math.round(fl + interni + mid(t))};
    if(two && ref){ v.save = (ref.voli + ref.extra) - (fl + extra); v.pct = Math.round(100 * v.save / (ref.voli + ref.extra)); }
    return v;
  }
  /* opzioni di una cella con i filtri correnti, dalla più economica (voli + extra) */
  function options(t, c){
    const out = c.a.map(op => view(t, op, false));
    if(state.stops >= 2 && c.b && out.length) out.push(view(t, c.b, true, out[0]));
    return out.sort((x, y) => (x.voli + x.extra) - (y.voli + y.extra));
  }
  function scoreOf(t, v){
    const price = clamp((5500 - v.tot) / 4000);
    const worst = Math.max(v.out[3], v.back ? v.back[3] : v.out[3]);
    const comfort = 0.5 * [1, 0.7, 0.3][Math.min(worst, 2)] + 0.5 * clamp((32*60 - v.out[2]) / (25*60));
    return Math.round(100 * (0.5 * price + 0.25 * comfort + 0.25 * (CL[t.g] || 0)));
  }
  function matchTrip(t, skip){
    if(skip !== "area" && state.area !== "all" && t.area !== state.area) return false;
    if(skip !== "kind" && state.kind !== "all" && t.type !== state.kind) return false;
    if(skip !== "style" && state.style !== "all" && !t.style.includes(state.style)) return false;
    return true;
  }
  function agg(skipBudget){
    const list = [];
    for(const t of D.trips){
      if(!matchTrip(t, null)) continue;
      const a = {t, min:Infinity, max:0, n:0, cheap:null, best:null, bestS:-1, origins:new Set()};
      for(const c of t.cells){
        if(state.origin !== "all" && c.o !== state.origin) continue;
        const o = options(t, c)[0];
        if(!o) continue;
        const s = scoreOf(t, o);
        a.n++; a.origins.add(c.o);
        if(o.tot < a.min || (o.tot === a.min && c.o === "LIN")){ a.min = o.tot; a.cheap = {c, o}; }
        a.max = Math.max(a.max, o.tot);
        if(s > a.bestS){ a.bestS = s; a.best = {c, o}; }
      }
      if(!a.n) continue;
      if(!skipBudget && state.budget && a.min > state.budget) continue;
      list.push(a);
    }
    const by = {
      tot: (x, y) => x.min - y.min || y.bestS - x.bestS,
      voli: (x, y) => (x.cheap.o.voli + x.cheap.o.extra) - (y.cheap.o.voli + y.cheap.o.extra) || x.min - y.min,
      score: (x, y) => y.bestS - x.bestS || x.min - y.min,
    };
    return list.sort(by[state.sort]);
  }
  const chips = (items, cur, key) => items.map(([v, l]) => `<button class="chip" data-pk="${key}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join("");
  const climaBadge = t => `<span class="badge ${t.g === "ottimo" ? "ok" : t.g === "buono" ? "info" : "warn"}">clima ${esc(t.g)}</span>`;
  const kindBadge = t => t.type === "oj" ? `<span class="badge info">open-jaw</span>` : `<span class="badge plain">A/R</span>`;
  const routeHTML = t => t.type === "oj"
    ? `Milano → <b>${esc(city(t.arr))}</b> ${t.arr} ⋯ <b>${esc(city(t.dep))}</b> ${t.dep} → Milano`
    : `Milano ⇄ <b>${esc(city(t.arr))}</b> ${t.arr}`;
  const stopsTxt = f => f[3] === 0 ? "diretto" : `${f[3]} ${f[3] === 1 ? "scalo" : "scali"} · ${esc(f[7])}`;
  /* come si vola in questa opzione, in chiaro */
  function howTxt(t, v){
    if(v.a.k === "ow") return `2 solo-andata: ${v.out[8]}→${v.a.a} + ${v.a.b}→${v.back[9]}`;
    return `A/R su ${esc(city(v.a.a))} ${v.a.a}` + (v.extra ? ` + ${v.a.add.map(e => esc(e[0])).join(", ")}` : "");
  }
  const srcBadge = v => v.a.k === "ow"
    ? `<span class="badge warn wrap">somma di 2 solo-andata (stima)</span>`
    : `<span class="badge ok wrap">A/R: prezzo reale Google</span>`;
  const twoBadge = v => v.two ? `<span class="badge warn wrap">2 scali — risparmi ${eur(v.save)} pp (${v.pct}%)</span>` : "";

  function cardHTML(a){
    const t = a.t, o = a.cheap.o, c = a.cheap.c, lin = a.origins.has("LIN");
    return `<button class="card" data-trip="${esc(t.id)}" aria-expanded="${state.open === t.id}">
      <span class="c-top"><span class="c-name">${esc(t.name)}</span><span class="score" title="Punteggio 0-100: totale stimato pp 50%, comodità voli 25%, clima 25%">${a.bestS}/100</span></span>
      <span class="pt-route">${routeHTML(t)}</span>
      <span class="c-price"><span class="pp">${eur(o.voli)} <small>pp voli</small></span><span class="cp">coppia ${eur(o.voli * 2)}</span></span>
      <span class="pt-tot"><span class="pp">${eur(a.min)} <small>pp totale stimato</small></span><span class="cp">coppia ${eur(a.min * 2)} · ${t.nights} notti</span></span>
      <span class="badges">${kindBadge(t)}${climaBadge(t)}${lin ? `<span class="badge ok">da Linate</span>` : `<span class="badge plain">solo ${[...a.origins].join(" · ")}</span>`}${t.visited ? `<span class="badge plain">giro nuovo</span>` : ""}${t.flag ? `<span class="badge plain wrap">${esc(t.flag)}</span>` : ""}${twoBadge(o)}</span>
      <span class="c-clima">${esc(t.temp)} · ritmo ${esc(t.pace)} · ${esc(t.style.join(", "))}</span>
      <span class="c-sub">Più economico: ${fmtD(c.dep)} · ${c.n} giorni · ${c.o} · ${howTxt(t, o)}</span>
    </button>`;
  }
  function legHTML(f, lbl, lin){
    return `<span class="pt-leg"><span class="fl-t"><span class="apt ${lin ? "lin" : ""}">${f[8]}</span>${f[4]} → ${f[5]}${f[6] ? `<sup>+${f[6]}</sup>` : ""} ${esc(f[9])}</span>
      <span class="fl-m" style="display:block">${lbl} ${fmtD(f[10])} · ${esc(f[1])} · ${stopsTxt(f)} · ${hm(f[2])}</span></span>`;
  }
  function optHTML(t, c, v){
    const ret = addD(c.dep, c.n);
    let legs, link, lt, price;
    if(v.a.k === "ow"){
      legs = legHTML(v.out, `andata · ${eur(v.out[0])}`, v.out[8] === "LIN") + legHTML(v.back, `ritorno · ${eur(v.back[0])}`, v.back[9] === "LIN");
      link = gfUrl([[c.dep, v.out[8], v.a.a], [ret, v.a.b, v.back[9]]], 3); lt = "Google Flights multi-city ↗";
    } else {
      legs = legHTML(v.out, "andata", v.out[8] === "LIN") + `<span class="fl-m" style="display:block">ritorno ${fmtD(ret)} da ${esc(city(v.a.a))}: il più economico entro lo stesso limite di scali, da scegliere su Google Flights</span>`;
      link = gfUrl([[c.dep, c.o, v.a.a], [ret, v.a.a, c.o]], 1); lt = "Google Flights A/R ↗";
    }
    const add = v.extra ? `<div class="fl-m"><span class="pt-est">stima</span> + ${v.a.add.map(e => `${esc(e[0])} ~${eur(e[1])}`).join(" + ")} pp${v.a.note ? " · " + esc(v.a.note) : ""}</div>` : (v.a.note ? `<div class="fl-m">${esc(v.a.note)}</div>` : "");
    return `<div class="fl"><div class="fl-l">${legs}${add}
        <div class="badges" style="margin-top:5px">${srcBadge(v)}${twoBadge(v)}</div>
      </div><div class="fl-r"><div class="pp">${eur(v.voli)} <small>pp voli</small></div><div class="cp">coppia ${eur(v.voli * 2)}</div>
        <div class="cp">totale stimato ${eur(v.tot)} pp</div><a class="cp" href="${link}" target="_blank" rel="noopener">${lt}</a></div></div>`;
  }
  function detailHTML(a){
    const t = a.t;
    const cs = t.cells.filter(c => (state.origin === "all" || c.o === state.origin) && options(t, c).length);
    const deps = [...new Set(D.trips.flatMap(x => x.cells.map(c => c.dep)))].sort();
    const cellBest = {};
    for(const c of cs){
      const o = options(t, c)[0], k = c.dep + "|" + c.n;
      if(!cellBest[k] || o.tot < cellBest[k].o.tot || (o.tot === cellBest[k].o.tot && c.o === "LIN")) cellBest[k] = {c, o};
    }
    if(!state.cell || !cellBest[state.cell]) state.cell = a.cheap.c.dep + "|" + a.cheap.c.n;
    const ps = Object.values(cellBest).map(x => x.o.voli + x.o.extra), lo = Math.min(...ps), hi = Math.max(...ps);
    let mx = `<table class="mx"><thead><tr><th class="r">Andata</th><th>10 giorni</th><th>11 giorni</th><th>12 giorni</th></tr></thead><tbody>`;
    for(const dep of deps){
      mx += `<tr><th class="r">${fmtD(dep)}</th>`;
      for(const n of [10, 11, 12]){
        const k = dep + "|" + n, x = cellBest[k];
        if(!x){ mx += `<td><span class="cell na">–</span></td>`; continue; }
        const p = x.o.voli + x.o.extra, h = hi > lo ? (hi - p) / (hi - lo) : 1;
        const tag = x.c.o + (x.o.a.k === "ow" ? " · 2×OW" : " · A/R " + x.o.a.a) + (x.o.extra ? " +" + x.o.extra : "") + (x.o.two ? " · 2 sc." : "");
        mx += `<td><button class="cell" data-cell="${k}" aria-pressed="${k === state.cell}" style="background:color-mix(in srgb, var(--heat) ${Math.round(5 + 30 * h)}%, var(--paper))" title="Rientro ${fmtD(addD(dep, n))} · ${esc(tag)}">${eur(x.o.voli)}<small>${esc(tag)}</small></button></td>`;
      }
      mx += `</tr>`;
    }
    mx += `</tbody></table><p class="note">Voli internazionali per persona nella combinazione più economica (sotto: aeroporto e modo di volare; «+N» = tratta extra stimata per chiudere il giro, in euro). Verde più intenso = più economico. Clicca una cella per i voli.</p>`;
    const [dep, n] = state.cell.split("|"), ret = addD(dep, +n);
    let fl = "";
    for(const c of cs.filter(c => c.dep === dep && c.n === +n).sort((x, y) => (x.o === "LIN" ? 0 : 1) - (y.o === "LIN" ? 0 : 1)))
      for(const v of options(t, c)) fl += optHTML(t, c, v);
    const v = cellBest[state.cell].o;
    const interni = t.internal.concat(v.extra ? v.a.add : []);
    const cost = `<table class="pt-cost"><tbody>
      <tr><td>Voli internazionali <span class="${v.a.k === "ow" ? "pt-est" : "pt-real"}">${v.a.k === "ow" ? "somma di 2 solo-andata (stima)" : "prezzo reale Google"}</span><small>${howTxt(t, v)} · ${fmtD(dep)} → ${fmtD(ret)}</small></td><td>${eur(v.voli)}</td></tr>
      <tr><td>Voli interni <span class="pt-est">stima</span><small>${interni.length ? interni.map(e => `${esc(e[0])} ~${eur(e[1])}`).join(" · ") : "nessuno"}</small></td><td>${interni.length ? eur(v.interni) : "0 €"}</td></tr>
      <tr><td>A terra, mid-range <span class="pt-est">stima</span><small>${t.nights} notti in doppia, pasti, mezzi, ingressi e attività</small></td><td>${eur(t.land[0])} – ${eur(t.land[1])}</td></tr>
      <tr class="t"><td>Totale stimato per persona<small>coppia ${eur(v.lo * 2)} – ${eur(v.hi * 2)}</small></td><td>${eur(v.lo)} – ${eur(v.hi)}</td></tr>
    </tbody></table>`;
    const stages = `<ol class="pt-stages">${t.stages.map(s => `<li><span class="pt-n">${s[1]} ${s[1] === 1 ? "notte" : "notti"}</span><b>${esc(s[0])}</b><span class="s">${esc(s[2])}</span></li>`).join("")}</ol>`;
    return `<div class="detail" id="pt-detail">
      <div class="d-head"><div><h2 class="d-title">${esc(t.name)}</h2>
        <div class="pt-route" style="margin-top:4px">${routeHTML(t)}</div>
        <div class="badges" style="margin-top:6px">${kindBadge(t)}${climaBadge(t)}<span class="badge plain">${esc(t.temp)}</span><span class="badge plain">ritmo ${esc(t.pace)}</span>${t.flag ? `<span class="badge plain wrap">${esc(t.flag)}</span>` : ""}${t.visited ? `<span class="badge plain wrap">già visto: ${esc(t.seen)}</span>` : ""}</div></div>
        <div style="text-align:right"><div class="pp">${eur(a.cheap.o.voli)} <small>pp voli</small></div><div class="cp">totale stimato da ${eur(a.min)} pp · coppia ${eur(a.min * 2)}</div></div></div>
      <ul class="pt-hi">${t.hi.map(h => `<li>${esc(h)}</li>`).join("")}</ul>
      <p class="d-why"><b>Ad agosto.</b> ${esc(t.aug)}</p>
      <div class="d-cols"><div>
        <p class="d-h">Tappe · ${t.nights} notti · ${esc(t.countries.join(" + "))}</p>${stages}
        <p class="note"><b>Mezzi a terra.</b> ${esc(t.ground)}</p>
        ${(t.src || []).length ? `<p class="note"><b>Fonti.</b> ${t.src.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host(u))} ↗</a>`).join(" · ")}</p>` : ""}
        <p class="d-h">Costo stimato pp · ${fmtD(dep)}, ${n} giorni</p>${cost}
      </div><div>
        <p class="d-h">Data di andata × durata · voli € pp</p>${mx}
        <p class="d-h">Voli · ${fmtD(dep)} → ${fmtD(ret)} (${n} giorni)</p>${fl}
        <p class="note">Negli open-jaw il prezzo è la somma di due biglietti solo-andata letti su Google Flights: è una stima prudente, il biglietto multi-city unico (link sopra) di solito costa meno sul lungo raggio. Negli A/R orari e scali sono quelli dell'andata.</p>
      </div></div>
    </div>`;
  }
  function kpisHTML(list){
    const k = (l, v, s) => `<div class="kpi"><div class="k-l">${l}</div><div class="k-v">${v}</div><div class="k-s">${s}</div></div>`;
    const cheap = [...list].sort((x, y) => x.min - y.min)[0], top = [...list].sort((x, y) => y.bestS - x.bestS)[0];
    const fl = [...list].sort((x, y) => x.cheap.o.voli - y.cheap.o.voli)[0];
    return k("Trip con voli validi", `${list.length}<span class="k-s"> / ${D.trips.length}</span>`, `con i filtri attivi · ${list.filter(a => a.t.type === "oj").length} open-jaw`) +
      k("Totale stimato pp più basso", cheap ? eur(cheap.min) : "–", cheap ? `${esc(cheap.t.name)} · coppia ${eur(cheap.min * 2)}` : "nessun trip") +
      k("Voli pp più bassi", fl ? eur(fl.cheap.o.voli) : "–", fl ? `${esc(fl.t.name)} · ${fmtD(fl.cheap.c.dep)}` : "") +
      k("Miglior punteggio", top ? `${top.bestS}/100` : "–", top ? `${esc(top.t.name)} · ${eur(top.best.o.tot)} pp` : "");
  }
  function listsHTML(){
    const box = (t, items, sub) => `<div class="lbox"><h2>${t}</h2>${sub ? `<p class="note" style="margin:0 0 6px">${sub}</p>` : ""}<ul>${items.length ? items.join("") : "<li><span>nessuno</span></li>"}</ul></div>`;
    const no = D.trips.filter(t => !t.best);
    return box("Trip senza voli validi", no.map(t => `<li><b>${esc(t.name)}</b> ${t.arr}${t.dep !== t.arr ? "→" + t.dep : ""} <span>· ${esc(t.why)} · a terra ${eur(t.land[0])}–${eur(t.land[1])} pp</span></li>`),
        `Al ${esc(D.meta.date)} nessuna combinazione con al massimo 1 scalo per tratta nelle date richieste: da ricontrollare più avanti.`) +
      box("Classici d'agosto lasciati fuori", D.skipped.map(s => `<li><span>${esc(s)}</span></li>`), "Scartati a monte per clima, distanza o perché esclusi.");
  }
  function html(){
    const list = agg(false);
    if(state.open && !list.some(a => a.t.id === state.open)){ state.open = null; state.cell = null; }
    const areas = [...new Set(D.trips.filter(t => matchTrip(t, "area")).map(t => t.area))].sort((a, b) => a.localeCompare(b, "it"));
    const styles = D.styles.filter(s => D.trips.some(t => matchTrip(t, "style") && t.style.includes(s)));
    const sel = (id, lbl, opts, cur) => `<select class="chip" data-ps="${id}" aria-label="${lbl}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const g = (lbl, inner) => `<span class="grp"><span class="lbl">${lbl}</span><span class="grp">${inner}</span></span>`;
    return `<div class="kpis">${kpisHTML(list)}</div>
      <div class="controls">
        ${g("Da", chips([["all","Tutti"],["LIN","Linate"],["MXP","Malpensa"],["FCO","Roma"],["PSA","Pisa"]], state.origin, "origin"))}
        ${g("Tipo", chips([["all","Tutti"],["oj","Open-jaw"],["rt","A/R"]], state.kind, "kind"))}
        ${g("Area", chips([["all","Tutte"], ...areas.map(a => [a, a])], state.area, "area"))}
        ${g("Stile", sel("style", "Stile di viaggio", [["all","Tutti"], ...styles.map(s => [s, s])], state.style))}
        ${g("Budget totale pp", sel("budget", "Budget totale massimo per persona", [0,2000,2500,3000,3500,4000,5000].map(b => [b, b ? "≤ " + eur(b) : "Nessun limite"]), state.budget))}
        ${g("Max scali", chips([[1,"1"],[2,"2 (se conviene)"]], state.stops, "stops"))}
        ${g("Ordina", sel("sort", "Ordinamento", [["tot","Totale pp"],["voli","Voli pp"],["score","Punteggio"]], state.sort))}
      </div>
      <p class="count"><b>${list.length}</b> trip · <b>voli per persona</b> in evidenza, sotto il totale stimato (voli + interni + a terra) · clicca un trip per tappe, costi e matrice date</p>
      <div class="grid">${list.map(a => cardHTML(a) + (state.open === a.t.id ? detailHTML(a) : "")).join("")}</div>
      ${list.length ? "" : `<p class="empty">Nessun trip con questi filtri.</p>`}
      <div class="lists">${listsHTML()}</div>
      <div class="footnotes">
        <p><b>Cosa è reale e cosa è stima.</b> Reali: i prezzi dei singoli voli letti su Google Flights il ${esc(D.meta.date)} (economy, 1 adulto, tariffa base). Stime: la somma di due solo-andata usata per gli open-jaw, i voli interni e il costo a terra (fascia mid-range in camera doppia, alta stagione). Il totale coppia è il doppio del totale per persona.</p>
        <p><b>Open-jaw.</b> La ricerca multi-city di Google Flights non è leggibile senza browser, quindi ogni open-jaw è confrontato con l'alternativa «A/R su un solo aeroporto + tratta interna stimata» e vince la combinazione più economica. Il link multi-city apre la ricerca vera su Google Flights.</p>
        <p><b>Scali.</b> Al massimo 1 scalo per tratta; un'opzione con 2 scali compare solo con «Max scali: 2» e solo se fa risparmiare almeno il ${Math.round(D.meta.minPct * 100)}% e ${D.meta.minEur} € a persona.</p>
        <p><b>Punteggio (0-100).</b> 50% totale stimato pp (100 a 1.500 €, 0 a 5.500 €), 25% comodità dei voli (scali e durata dell'andata), 25% clima di agosto.</p>
        <p><b>Scansione.</b> ${D.trips.length} trip × LIN, MXP, FCO e PSA × 9 date di andata × 10/11/12 giorni: ${D.meta.q.toLocaleString("it-IT")} ricerche nuove (${D.meta.ok.toLocaleString("it-IT")} con voli) più ${D.meta.reused.toLocaleString("it-IT")} A/R riusati dalla scansione principale.</p>
      </div>`;
  }
  return { state, agg, options, view, scoreOf, html, validCount: () => agg(true).length };
}

function mount(el, data, opts){
  opts = opts || {};
  const m = create(data);
  const render = () => {
    el.innerHTML = m.html();
    if(opts.countEl) opts.countEl.textContent = m.validCount();
  };
  el.addEventListener("click", e => {
    if(e.target.closest("a")) { e.stopPropagation(); return; }
    e.stopPropagation();
    const chip = e.target.closest(".chip[data-pk]");
    if(chip){ const k = chip.dataset.pk, v = chip.dataset.v; m.state[k] = k === "stops" ? +v : v; render(); return; }
    const cell = e.target.closest(".cell[data-cell]");
    if(cell){ m.state.cell = cell.dataset.cell; render(); return; }
    const card = e.target.closest(".card[data-trip]");
    if(card){
      const id = card.dataset.trip;
      m.state.open = m.state.open === id ? null : id; m.state.cell = null; render();
      if(m.state.open){ const c = el.querySelector(`.card[data-trip="${id}"]`); if(c && c.scrollIntoView) c.scrollIntoView({block:"nearest", behavior:"smooth"}); }
    }
  });
  el.addEventListener("change", e => {
    const s = e.target.closest("select[data-ps]");
    if(!s) return;
    e.stopPropagation();
    m.state[s.dataset.ps] = s.dataset.ps === "budget" ? +s.value : s.value; render();
  });
  render();
  return Object.assign(m, { render });
}

const api = { mount, create, tfs, gfUrl };
if(typeof module !== "undefined" && module.exports) module.exports = api;
root.PopularTrips = api;
})(typeof window !== "undefined" ? window : globalThis);
