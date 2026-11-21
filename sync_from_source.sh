#!/usr/bin/env bash
# Copia in un solo passo i sorgenti del progetto nella cartella del repo (Git Bash).
#
#   bash sync_from_source.sh            copia e mostra cosa e' cambiato
#   bash sync_from_source.sh --push     copia, commit + push su main (pull --rebase) e lancia il workflow che
#                                       ripubblica il sito con i dati dell'ultimo giro
#   bash sync_from_source.sh --push --data   in piu' carica sul branch "data" i dati locali (raw_v2.jsonl ecc.):
#                                       sovrascrive quelli dell'ultimo giro, serve solo al primo caricamento
#
# SRC=/altro/percorso per una sorgente diversa. CHECK_PATTERNS="regex" aggiunge un controllo sui dati sensibili
# (es. i chat_id: non vanno scritti in questo file, il repo e' pubblico).
# Non tocca mai bot/state/ (stato del bot scritto dai workflow) ne' i file propri del repo
# (pipeline.py, README.md, .github/, requirements.txt, questo script).
set -euo pipefail
SRC="${SRC:-$HOME/Viaggio-Agosto-2027}"
DST="$(cd "$(dirname "$0")" && pwd)"
PUSH=0; DATA=0
for a in "$@"; do case "$a" in --push) PUSH=1 ;; --data) DATA=1 ;; esac; done
cd "$DST"
[ -d "$SRC" ] || { echo "sorgente assente: $SRC"; exit 1; }

# 1) file della radice: tutto tranne temporanei, output generati, dati v1 e note interne
shopt -s nullglob
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  n="$(basename "$f")"
  case "$n" in
    probe*.py|*.bak|*.log|*.tmp|*.md|raw.jsonl|trips_raw.jsonl) continue ;;      # scarti e scansione v1
    agosto-2027*.html|popular-preview.html|index.html|origins.json) continue ;;    # output generati
    pipeline.py|sync_from_source.sh|requirements.txt|.gitignore|.gitattributes) continue ;;  # file del repo
  esac
  cp -p "$f" "$DST/$n"
done

# 2) img/: specchio (le foto tolte dalla sorgente spariscono anche qui)
mkdir -p "$DST/img"
for f in "$DST"/img/*; do [ -e "$SRC/img/$(basename "$f")" ] || rm -f "$f"; done
cp -p "$SRC"/img/* "$DST/img/"

# 3) bot/: codice e config, mai lo stato ne' lo snapshot (dati) ne' le bozze dei workflow
mkdir -p "$DST/bot/state"
for f in "$SRC"/bot/*; do
  [ -f "$f" ] || continue
  n="$(basename "$f")"
  case "$n" in snapshot.json|*.bak|*.log|*.tmp) continue ;; esac
  cp -p "$f" "$DST/bot/$n"
done
[ -f "$SRC/bot/.gitignore" ] && cp -p "$SRC/bot/.gitignore" "$DST/bot/.gitignore"
[ -e "$DST/bot/state/.gitkeep" ] || : > "$DST/bot/state/.gitkeep"
sed -i 's#https://cosimoney.github.io/REPO-DA-DEFINIRE/#https://cosimoney.github.io/agosto2027/#' "$DST/bot/config.json"

# 4) controllo dati sensibili su cio' che finirebbe nel repo
git add -A
PAT='[0-9]{8,10}:[A-Za-z0-9_-]{35}'
[ -n "${CHECK_PATTERNS:-}" ] && PAT="$PAT|$CHECK_PATTERNS"
if git grep --cached -nIE "$PAT" -- . ':!sync_from_source.sh' | cut -c1-80 | grep . ; then
  echo "STOP: possibile token o dato sensibile nei file qui sopra. Niente commit."; exit 1
fi
echo "--- modifiche rispetto all'ultimo commit"
git status --short | head -60
ls -la raw_v2.jsonl trips_raw_v2.jsonl trips_data.json 2>/dev/null || true

[ "$PUSH" = 1 ] || { echo "Solo copia. Per pubblicare: bash sync_from_source.sh --push"; exit 0; }

# 5) commit + push su main
if ! git diff --cached --quiet; then
  git commit -q -m "Sync sorgenti $(date +%F\ %H:%M)"
fi
for i in 1 2 3 4; do
  if git pull -q --rebase --autostash origin main 2>/dev/null || [ -z "$(git ls-remote --heads origin main)" ]; then
    git push -q -u origin main && break
  fi
  sleep 4
done

# 6) dati locali sul branch data (un solo commit, sovrascritto: nessuna storia che cresce)
# Solo con --data: i dati locali SOSTITUISCONO quelli dell'ultimo giro fatto su Actions (di norma piu' recenti).
if [ "$DATA" = 1 ]; then
python pipeline.py build
python bot/snapshot.py --raw raw_v2.jsonl --trips trips_data.json
python pipeline.py meta
bash .github/push_data.sh "Dati caricati a mano $(date +%F\ %H:%M)"
fi

# 7) ripubblica il sito (parte anche da solo se il push ha toccato i file del sito; il gruppo di concurrency li mette in fila)
gh workflow run deploy.yml --repo cosimoney/agosto2027 && echo "Deploy lanciato: gh run watch --repo cosimoney/agosto2027"
