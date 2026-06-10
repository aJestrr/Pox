#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/meta-decks.json"
TMP="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
trap 'rm -rf "$TMP"' EXIT

DECKS_URL="https://raw.githubusercontent.com/chase-9234/pokemon-tcg-pocket-tier-list/main/public/data/best-decks.json"

echo "Downloading meta deck data..."
curl -sf "$DECKS_URL" -o "$TMP/decks.json"

if [[ -f "$ROOT/data/cards.json" ]]; then
  jq --slurpfile cards "$ROOT/data/cards.json" -f "$SCRIPT_DIR/meta-decks.jq" "$TMP/decks.json" > "$OUT"
else
  jq -f "$SCRIPT_DIR/meta-decks.jq" "$TMP/decks.json" > "$OUT"
fi

COUNT=$(jq '.decks | length' "$OUT")
echo "Wrote $COUNT meta decks to $OUT"
