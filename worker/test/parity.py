# -*- coding: utf-8 -*-
"""Esegue una sequenza di comandi con bot/commands.py (senza rete) e stampa le risposte in JSON.
Serve a worker/test/parity.test.mjs per confrontare il Worker con l'implementazione Python.
Uso: python parity.py <snapshot.json> < comandi.json   (comandi: [["text", "/top"], ["cb", "add:d_TBS"], ...])"""
import json, os, sys, tempfile
from pathlib import Path

os.environ["BOT_STATE_DIR"] = tempfile.mkdtemp(prefix="bot-parity-")
os.environ["TELEGRAM_BOT_TOKEN"] = "000000:PARITY"
os.environ.pop("DASHBOARD_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bot"))
import common as C, commands as K

cfg = C.load_config()
cfg["dashboard_url"] = "https://cosimoney.github.io/agosto2027/"
bot = K.Bot(C.Telegram(None, dry_run=True, quiet=True), cfg, C.load_snapshot(sys.argv[1]), C.load_prefs(cfg))
out = []
for kind, data in json.loads(sys.stdin.buffer.read().decode("utf-8")):
    r = bot.on_callback(data, 1) if kind == "cb" else bot.on_text(data, 1)
    out.append(None if r is None else [r[0], r[1]])
sys.stdout.buffer.write(json.dumps({"today": __import__("datetime").date.today().isoformat(), "out": out}, ensure_ascii=True).encode())
