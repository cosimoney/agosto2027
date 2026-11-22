// Confronta il Worker con bot/commands.py sugli stessi dati: stessi testi e stessi bottoni per ogni comando.
// Gira solo se ci sono Python e bot/snapshot.json (i dati non stanno su main): altrimenti il test viene saltato.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import CONFIG from "../../bot/config.json" with { type: "json" };
import { Bot, loadConfig, normPrefs } from "../src/bot.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const snapPath = path.join(here, "..", "..", "bot", "snapshot.json");
const CMDS = [
  ["text", "/start"], ["text", "/help"], ["text", "/top"], ["text", "/top weekend"], ["text", "/meta TBS"], ["text", "/meta georgia"], ["text", "/meta xyzzy"],
  ["text", "/meta"], ["text", "/meta ma"], ["text", "/aggiungi TBS"], ["text", "/aggiungi TBS"], ["text", "/aggiungi marocco"], ["text", "/aggiungi giappone"],
  ["text", "/aggiungi w_BCN"], ["text", "/aggiungi d_ZZZ"], ["text", "/preferiti"], ["text", "/soglia"], ["text", "/soglia 900"], ["text", "/soglia TBS 300"],
  ["text", "/soglia"], ["text", "/soglia TBS off"], ["text", "/soglia georgia 250"], ["text", "/soglia 5"], ["text", "/soglia boh"], ["text", "/soglia off"],
  ["text", "/soglia EVN 1.200€"], ["text", "/silenzia TBS"], ["text", "/silenzia"], ["text", "/silenzia TBS off"], ["text", "/silenzia georgia 14"],
  ["text", "/silenzia TBS 999"], ["text", "/digest"], ["text", "/digest settimanale"], ["text", "/digest"], ["text", "/rimuovi"], ["text", "/rimuovi xyz"],
  ["text", "/rimuovi EVN"], ["text", "/pausa"], ["text", "/riprendi"], ["text", "/start fav_t_georgia-armenia"], ["text", "/start fav_d_qqq"],
  ["text", "/start fav_!!"], ["text", "/boh"], ["text", "/fav"], ["text", "ciao"], ["text", "/top@Trip2027_bot"], ["text", "/soglia 1000"],
  ["cb", "top"], ["cb", "favs"], ["cb", "add:d_EVN"], ["cb", "thr:d_EVN:200"], ["cb", "thr:d_EVN:off"], ["cb", "mute:d_EVN:7"], ["cb", "unmute:d_EVN"],
  ["cb", "dg:giorno"], ["cb", "meta:w_BCN"], ["cb", "meta:d_EVN"], ["cb", "rm:d_EVN"], ["cb", "rm:d_EVN"], ["cb", "resume"], ["cb", "boh"], ["cb", "thr:xx"],
  ["cb", "thr:d_ALA:700"], ["text", "/preferiti"], ["text", "/rimuovi"],
];

test("stessi testi e bottoni di bot/commands.py", { skip: !existsSync(snapPath) && "bot/snapshot.json assente" }, () => {
  const py = spawnSync("python", [path.join(here, "parity.py"), snapPath], { input: JSON.stringify(CMDS), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (py.error || py.status !== 0) return test.skip ? console.log("python non disponibile: confronto saltato", py.stderr) : undefined;
  const ref = JSON.parse(py.stdout);
  const cfg = loadConfig(CONFIG, { SITE_URL: "https://cosimoney.github.io/agosto2027/" });
  // snapshot completo e, se c'e', quello ridotto che il Worker usa dal vivo: le risposte devono essere le stesse
  for (const file of [snapPath, snapPath.replace(".json", "_lite.json")].filter((f) => existsSync(f))) {
    const snap = JSON.parse(readFileSync(file, "utf8"));
    const prefs = normPrefs({}, cfg);
    CMDS.forEach(([kind, data], i) => {
      const bot = new Bot(cfg, snap, prefs, { today: ref.today, chatHash: "h" });
      const r = kind === "cb" ? bot.onCallback(data) : bot.onText(data);
      assert.deepEqual(r, ref.out[i], `${path.basename(file)}: ${kind} ${data}`);
    });
  }
});
