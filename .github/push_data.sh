#!/usr/bin/env bash
# Scrive i dati dell'ultimo giro sul branch "data" come UNICO commit senza genitori (push forzato):
# il branch non accumula storia, quindi il repo non cresce con le scansioni giornaliere.
set -euo pipefail
MSG="${1:-Dati ultimo giro}"
FILES="raw_v2.jsonl trips_raw_v2.jsonl trips_data.json scan_meta.json bot/snapshot.json"
export GIT_INDEX_FILE="$(pwd)/.git/index.data.$$"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
for f in $FILES; do
  if [ -f "$f" ]; then git add -f "$f"; fi
done
tree=$(git write-tree)
commit=$(git -c user.name="voli-bot" -c user.email="actions@users.noreply.github.com" commit-tree "$tree" -m "$MSG")
git push -q --force origin "$commit:refs/heads/data"
echo "branch data aggiornato: $(git ls-tree -r --name-only "$commit" | tr '\n' ' ')"
