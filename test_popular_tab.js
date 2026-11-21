// Verifica con Node: il modulo gira su un DOM minimale con i dati reali (trips_data.json).
const fs = require("fs"), path = require("path"), assert = require("assert");
class El {
  constructor(){ this.innerHTML = ""; this.textContent = ""; this.h = {}; }
  addEventListener(t, f){ (this.h[t] = this.h[t] || []).push(f); }
  querySelector(){ return null; }
  fire(t, target){ for(const f of this.h[t] || []) f({target, stopPropagation(){}}); }
}
// finto target: closest() risponde in base al selettore
const tgt = (sel, dataset, value) => ({ dataset, value, closest: s => s.split(",").some(x => x.trim().startsWith(sel)) ? {dataset, value} : null });
const PT = require(path.join(__dirname, "popular_tab.js"));
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "trips_data.json"), "utf8"));
const root = new El(), cnt = new El();
const m = PT.mount(root, D, {countEl: cnt});
const cards = h => (h.match(/class="card"/g) || []).length;
const n0 = cards(root.innerHTML);
assert(n0 > 0, "nessuna card"); assert.strictEqual(String(n0), String(cnt.textContent));
assert(!/undefined|NaN|\[object/.test(root.innerHTML), "undefined/NaN nell'HTML iniziale");
// link Google Flights: tfs identico a fast-flights (multi-city MXP>TBS 7/8, EVN>MXP 18/8, senza max_stops)
assert.strictEqual(PT.tfs([["2027-08-07","MXP","TBS"],["2027-08-18","EVN","MXP"]], 3), "GhoSCjIwMjctMDgtMDdqBRIDTVhQcgUSA1RCUxoaEgoyMDI3LTA4LTE4agUSA0VWTnIFEgNNWFBCAQFIAZgBAw==");
let opened = 0, links = 0;
for(const sort of ["tot", "voli", "score"]){
  root.fire("change", tgt("select[data-ps]", {ps:"sort"}, sort));
  const list = m.agg(false);
  for(let i = 1; i < list.length; i++){
    if(sort === "tot") assert(list[i-1].min <= list[i].min);
    if(sort === "score") assert(list[i-1].bestS >= list[i].bestS);
  }
}
for(const stops of [1, 2]) for(const origin of ["all", "LIN", "MXP", "FCO", "PSA"]){
  root.fire("click", tgt(".chip[data-pk]", {pk:"stops", v:String(stops)}));
  root.fire("click", tgt(".chip[data-pk]", {pk:"origin", v:origin}));
  for(const a of m.agg(false)){
    root.fire("click", tgt(".card[data-trip]", {trip:a.t.id}));
    const h = root.innerHTML;
    assert(h.includes('id="pt-detail"'), "dettaglio mancante " + a.t.id);
    assert(!/undefined|NaN|\[object/.test(h), "undefined/NaN nel dettaglio " + a.t.id + " " + origin);
    assert(/google\.com\/travel\/flights\/search\?tfs=/.test(h), "link GF mancante " + a.t.id);
    links += (h.match(/tfs=/g) || []).length; opened++;
    // ogni cella della matrice si apre
    for(const k of [...h.matchAll(/data-cell="([^"]+)"/g)].map(x => x[1]).slice(0, 4)){
      root.fire("click", tgt(".cell[data-cell]", {cell:k}));
      assert(!/undefined|NaN/.test(root.innerHTML), "cella " + k + " " + a.t.id);
    }
    root.fire("click", tgt(".card[data-trip]", {trip:a.t.id}));
    // regola prezzi: totale = voli + interni + terra medio
    const o = a.cheap.o; assert.strictEqual(o.tot, Math.round(o.voli + o.interni + (a.t.land[0] + a.t.land[1]) / 2));
    for(const c of a.t.cells) for(const v of m.options(a.t, c)) assert(v.two || Math.max(v.out[3], v.back ? v.back[3] : 0) <= 1, "più di 1 scalo senza badge");
  }
}
root.fire("click", tgt(".chip[data-pk]", {pk:"origin", v:"all"})); root.fire("click", tgt(".chip[data-pk]", {pk:"stops", v:"1"}));
for(const [k, v] of [["kind","oj"],["kind","rt"],["kind","all"],["area","Africa"],["area","all"]]){
  root.fire("click", tgt(".chip[data-pk]", {pk:k, v}));
  for(const a of m.agg(false)){ if(k === "kind" && v !== "all") assert.strictEqual(a.t.type, v); if(k === "area" && v !== "all") assert.strictEqual(a.t.area, v); }
}
for(const st of D.styles){ root.fire("change", tgt("select[data-ps]", {ps:"style"}, st)); for(const a of m.agg(false)) assert(a.t.style.includes(st)); }
root.fire("change", tgt("select[data-ps]", {ps:"style"}, "all"));
root.fire("change", tgt("select[data-ps]", {ps:"budget"}, "2500"));
for(const a of m.agg(false)) assert(a.min <= 2500);
const nb = cards(root.innerHTML);
root.fire("change", tgt("select[data-ps]", {ps:"budget"}, "0"));
console.log(`OK: ${n0} card, ${nb} con budget <= 2.500, ${opened} dettagli aperti, ${links} link Google Flights, ${D.trips.length - n0} trip senza voli, HTML ${root.innerHTML.length} caratteri`);
