// Verifica con Node: lo script di agosto-2027.html gira su un DOM minimale con i dati reali, per ogni origine (LIN, MXP, FCO, PSA).
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const html = fs.readFileSync(path.join(__dirname, process.argv[2] || "agosto-2027.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const src = scripts[scripts.length - 1];
class El {
  constructor(id){ this.id = id; this.innerHTML = ""; this.textContent = ""; this.hidden = false; this.value = ""; this.h = {}; this.dataset = {}; }
  addEventListener(t, f){ (this.h[t] = this.h[t] || []).push(f); }
  setAttribute(){} scrollIntoView(){}
}
const els = {}, docH = {};
const document = {
  getElementById: id => els[id] || (els[id] = new El(id)),
  querySelectorAll: () => [], querySelector: () => null,
  addEventListener: (t, f) => { (docH[t] = docH[t] || []).push(f); },
};
const ctx = vm.createContext({document, console, window: {}, location: {hash: ""}, history: {replaceState(){}}, localStorage: {getItem: () => null, setItem(){}}, setTimeout, Intl, Math, Date, JSON, Set, Map});
vm.runInContext(src + "\n;globalThis.__t = {RAW, state, agg, options, render};", ctx);
const T = ctx.__t, $ = id => els[id];
const tgt = (sel, dataset) => ({ dataset, closest: s => s.startsWith(sel) ? {dataset} : null });
const click = (sel, dataset) => { for(const f of docH.click) f({target: tgt(sel, dataset)}); };
const bad = /undefined|NaN|\[object/;
const page = () => $("grid").innerHTML + $("kpis").innerHTML + $("lists").innerHTML + $("f-origin").innerHTML + $("count").innerHTML;
assert(!bad.test(page() + $("foot").innerHTML), "undefined/NaN nella pagina iniziale");
for(const [v, l] of [["LIN","Linate"],["MXP","Malpensa"],["FCO","Roma"],["PSA","Pisa"]])
  assert($("f-origin").innerHTML.includes(`data-v="${v}"`) && $("f-origin").innerHTML.includes(">" + l + "<"), "chip origine mancante: " + l);
const origins = new Set(T.RAW.combos.map(c => c.o));
for(const o of origins) assert(["LIN","MXP","FCO","PSA"].includes(o), "origine inattesa " + o);
const seen = {}; let opened = 0, cells = 0;
for(const tab of ["new", "vis"]){
  click(".tab", {tab});
  for(const stops of [0, 1, 2]) for(const origin of ["all", "LIN", "MXP", "FCO", "PSA"]){
    click(".chip[data-k]", {k: "stops", v: String(stops)}); click(".chip[data-k]", {k: "origin", v: origin});
    const list = T.agg();
    assert(!bad.test(page()), `undefined/NaN in lista ${tab} ${origin} ${stops}`);
    assert.strictEqual(($("grid").innerHTML.match(/class="card"/g) || []).length, list.length);
    if(stops === 1) seen[origin] = (seen[origin] || 0) + list.length;
    for(const a of list){
      for(const o of a.origins) assert(origin === "all" || o === origin, "filtro origine non rispettato");
      assert(a.cheap.o.two || a.cheap.o.f[3] <= stops, "troppi scali");
      if(stops !== 1) continue;
      click(".card", {code: a.d.code});
      const h = $("grid").innerHTML;
      assert(!bad.test(h), `undefined/NaN nel dettaglio ${a.d.code} ${origin}`);
      assert(/google\.com\/travel\/flights/.test(h), "link Google Flights mancante " + a.d.code);
      if(origin !== "all") assert(h.includes(`Flights from ${origin} to ${a.d.code}`.replace(/ /g, "%20")), "voli dell'origine sbagliata " + a.d.code);
      for(const k of [...h.matchAll(/data-cell="([^"]+)"/g)].map(x => x[1]).slice(0, 3)){
        click(".cell[data-cell]", {cell: k}); cells++;
        assert(!bad.test($("grid").innerHTML), "cella " + k + " " + a.d.code);
      }
      click(".card", {code: a.d.code}); opened++;
    }
  }
}
assert(seen.all >= Math.max(seen.LIN, seen.MXP, seen.FCO, seen.PSA));
for(const o of origins) assert(seen[o] > 0, "nessuna meta da " + o);
console.log(`OK: mete con <=1 scalo  tutti ${seen.all} · LIN ${seen.LIN} · MXP ${seen.MXP} · Roma ${seen.FCO} · Pisa ${seen.PSA}; ${opened} dettagli e ${cells} celle aperti; origini nei dati: ${[...origins].join(", ")}`);
