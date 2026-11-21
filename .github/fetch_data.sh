#!/usr/bin/env bash
# Scarica i dati dell'ultimo giro dal branch "data" nella cartella indicata (default: la radice del repo).
# Se il branch non esiste ancora non fa nulla.
set -euo pipefail
DEST="${1:-.}"
mkdir -p "$DEST"
if git fetch -q --depth=1 origin data 2>/dev/null; then
  git archive FETCH_HEAD | tar -x -C "$DEST"
  echo "dati scaricati in $DEST: $(git ls-tree -r --name-only FETCH_HEAD | tr '\n' ' ')"
else
  echo "branch data assente: si parte senza dati precedenti"
fi
