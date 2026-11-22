#!/usr/bin/env bash
# Pubblica il Worker e lo collega a Telegram e a GitHub. Da Git Bash, dopo `npx wrangler login`:
#
#   cd worker
#   export TELEGRAM_BOT_TOKEN='...'                    # token del bot (BotFather)
#   export TELEGRAM_CHAT_IDS='111,222'                 # chat autorizzate, come nel secret del repo
#   export CHAT_NAMES='111:Cosimo,222:Lavi'            # facoltativo: nome mostrato accanto ai preferiti
#   export TEST_CHAT_ID='111'                          # facoltativo: chat che riceve l'unico messaggio di prova (/help)
#   bash deploy.sh
#
# Cosa fa, in ordine (si puo' rilanciare: ogni passo e' ripetibile):
#   1. crea il namespace KV "PREFS" e ne scrive l'id in wrangler.toml (solo la prima volta)
#   2. wrangler deploy
#   3. secret del Worker: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, CHAT_NAMES, PREFS_SECRET, WEBHOOK_SECRET (rigenerati a ogni
#      esecuzione) e HMAC_SECRET (solo se manca: cambiarlo annulla tutti i link personali; per farlo apposta ROTATE_HMAC=1)
#   4. GitHub: secret PREFS_SECRET e variabile WORKER_URL del repo
#   5. migrazione: bot/state/prefs.json -> KV, solo se nel KV non c'e' ancora nulla
#   6. Telegram: setWebhook verso il Worker, menu dei comandi con /sito
#   7. spegne il workflow dei comandi in polling (con il webhook attivo non riceverebbe nulla)
#   8. scrive l'indirizzo del Worker in bot/config.json ("worker_url"): e' quello che accende la stella sul sito
#   9. prove dal vivo (smoke.mjs)
# I valori dei secret passano solo da variabili e stdin: mai su file, mai a schermo.
# Restano da fare a mano il commit e il push di bot/config.json e wrangler.toml (vedi il riepilogo finale).
set -euo pipefail
cd "$(dirname "$0")"
REPO="${REPO:-cosimoney/agosto2027}"
SRC_DIR="${SRC_DIR:-$HOME/Viaggio-Agosto-2027}"
W="npx --yes wrangler"
say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERRORE: %s\n' "$*" >&2; exit 1; }
rnd() { node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))'; }

[ -n "${TELEGRAM_BOT_TOKEN:-}" ] || die "manca TELEGRAM_BOT_TOKEN nell'ambiente"
[ -n "${TELEGRAM_CHAT_IDS:-}" ] || die "manca TELEGRAM_CHAT_IDS nell'ambiente"
if $W whoami 2>&1 | grep -qi "not authenticated"; then die "wrangler non e' collegato a Cloudflare: lancia prima  npx wrangler login"; fi

say "1. KV"
if grep -q "KV_ID_DA_CREARE" wrangler.toml; then
  out="$($W kv namespace create PREFS < /dev/null 2>&1 || true)"
  id="$(printf '%s' "$out" | grep -oE '\b[0-9a-f]{32}\b' | head -1 || true)"
  if [ -z "$id" ]; then  # esiste gia' (esecuzione precedente interrotta): lo si cerca per nome
    id="$($W kv namespace list 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const n=a.find(x=>/(^|-)PREFS$/.test(x.title));process.stdout.write(n?n.id:"")}catch(e){}})')"
  fi
  [ -n "$id" ] || die "namespace KV non creato: $(printf '%s' "$out" | tail -3)"
  sed -i "s/KV_ID_DA_CREARE/$id/" wrangler.toml
  echo "namespace creato, id scritto in wrangler.toml"
else
  echo "gia' configurato in wrangler.toml"
fi

say "2. deploy"
out="$($W deploy 2>&1)" || { printf '%s\n' "$out" | tail -20; die "deploy fallito (se l'account e' nuovo va scelto il sottodominio workers.dev: dashboard Cloudflare > Workers & Pages)"; }
URL="$(printf '%s' "$out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)"
[ -n "$URL" ] || { printf '%s\n' "$out" | tail -20; die "indirizzo workers.dev non trovato nell'output del deploy"; }
echo "online: $URL"

say "3. secret del Worker"
put() { printf '%s' "$2" | $W secret put "$1" > /dev/null 2>&1 || die "secret $1 non impostato"; echo "  $1 ok"; }
have="$($W secret list 2>/dev/null || true)"
PREFS_SECRET="$(rnd)"; WEBHOOK_SECRET="$(rnd)"
put TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
put TELEGRAM_CHAT_IDS "$TELEGRAM_CHAT_IDS"
[ -n "${CHAT_NAMES:-}" ] && put CHAT_NAMES "$CHAT_NAMES"
put PREFS_SECRET "$PREFS_SECRET"
put WEBHOOK_SECRET "$WEBHOOK_SECRET"
HMAC_SECRET=""
if [ "${ROTATE_HMAC:-0}" = 1 ] || ! printf '%s' "$have" | grep -q '"HMAC_SECRET"'; then
  HMAC_SECRET="$(rnd)"
  put HMAC_SECRET "$HMAC_SECRET"
else
  echo "  HMAC_SECRET gia' presente: lasciato com'e' (i link personali restano validi)"
fi

say "4. GitHub: secret PREFS_SECRET e variabile WORKER_URL"
printf '%s' "$PREFS_SECRET" | gh secret set PREFS_SECRET --repo "$REPO" > /dev/null && echo "  secret PREFS_SECRET ok"
gh variable set WORKER_URL --repo "$REPO" --body "$URL" > /dev/null && echo "  variabile WORKER_URL ok"

say "5. migrazione dei preferiti nel KV"
if $W kv key get prefs --binding PREFS --remote 2>/dev/null | grep -q '"favorites"'; then
  echo "il KV ha gia' le preferenze: non le tocco"
elif [ -f ../bot/state/prefs.json ]; then
  $W kv key put prefs --path ../bot/state/prefs.json --binding PREFS --remote > /dev/null 2>&1 || die "scrittura nel KV fallita"
  echo "importato bot/state/prefs.json ($(node -e 'const p=require("../bot/state/prefs.json");console.log(Object.keys(p.favorites||{}).length+" preferiti, soglia "+p.threshold)'))"
else
  echo "nessun prefs.json: il Worker parte dai valori di default"
fi

say "6. Telegram: webhook e menu"
res="$(curl -sS -m 30 -K - <<EOF
url = "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
data-urlencode = "url=${URL}/tg/${WEBHOOK_SECRET}"
data-urlencode = "secret_token=${WEBHOOK_SECRET}"
data-urlencode = "allowed_updates=[\"message\",\"callback_query\"]"
EOF
)"
printf '%s' "$res" | grep -q '"ok":true' || die "setWebhook: $(printf '%s' "$res" | cut -c1-200)"
echo "  webhook impostato"
python ../bot/commands.py --register || echo "  (menu non registrato: si puo' rifare con  python bot/commands.py --register)"

say "7. workflow dei comandi in polling"
gh workflow disable bot-commands.yml --repo "$REPO" 2>/dev/null && echo "  disattivato" || echo "  gia' disattivato o assente"

say "8. worker_url in bot/config.json"
for f in ../bot/config.json "$SRC_DIR/bot/config.json"; do
  [ -f "$f" ] || continue
  if grep -q '"worker_url"' "$f"; then sed -i "s#\"worker_url\": *\"[^\"]*\"#\"worker_url\": \"$URL\"#" "$f"
  else sed -i "s#^\(\s*\)\"bot_username\"#\1\"worker_url\": \"$URL\",\n\1\"bot_username\"#" "$f"; fi
  echo "  $f"
done

say "9. prove dal vivo"
WORKER_URL="$URL" PREFS_SECRET="$PREFS_SECRET" WEBHOOK_SECRET="$WEBHOOK_SECRET" HMAC_SECRET="$HMAC_SECRET" node smoke.mjs || die "prove dal vivo fallite"

cat <<EOF

== FATTO. Worker: $URL
Restano due cose:
  a) commit + push di worker/wrangler.toml e bot/config.json (prima: git pull --rebase, e non mentre uno scan sta finendo).
     Il push ripubblica il sito con la stella collegata al Worker.
  b) su ogni dispositivo: scrivere /sito a @Trip2027_bot e aprire il link che manda.
EOF
