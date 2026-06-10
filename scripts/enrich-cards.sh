#!/usr/bin/env bash
set -euo pipefail

API="https://api.tcgdex.net/v2/en"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARDS="$ROOT/data/cards.json"
TMP="$(mktemp -d)"
PARALLEL="${PARALLEL:-20}"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading full-art reference data..."
curl -sf "https://raw.githubusercontent.com/chase-manning/pokemon-tcg-pocket-cards/refs/heads/main/v4.json" \
  -o "$TMP/v4.json"
jq -r '.[] | "\(.id | ascii_upcase)\t\(.fullart)"' "$TMP/v4.json" > "$TMP/fullart.tsv"

echo "Fetching evolveFrom for $(jq 'length' "$CARDS") cards..."
jq -r '.[].id' "$CARDS" > "$TMP/card-ids.txt"
mkdir -p "$TMP/evolve"

export API TMP
cat "$TMP/card-ids.txt" | xargs -P "$PARALLEL" -I {} sh -c '
  card_id="$1"
  evolve_from=$(curl -sf "$API/cards/$card_id" | jq -r ".evolveFrom // empty")
  printf "%s\t%s\n" "$card_id" "$evolve_from"
' _ {} > "$TMP/evolve.tsv"

jq --slurpfile evolve <(jq -R -s '
  split("\n")
  | map(select(length > 0))
  | map(split("\t"))
  | map({(.[0]): (.[1] // "")})
  | add
' "$TMP/evolve.tsv") --rawfile fullart "$TMP/fullart.tsv" '
  ($fullart | split("\n") | map(select(length > 0) | split("\t")) | map({(.[0]): .[1]}) | add) as $fa |
  map(
    . + {
      evolveFrom: ($evolve[0][.id] // ""),
      fullArt: (
        if ($fa[.id] == "Yes") then true
        elif ($fa[.id] == "No") then false
        elif (.rarity | test("Star|Crown|Shiny")) then true
        else false
        end
      )
    }
  )
' "$CARDS" > "$TMP/enriched.json"

mv "$TMP/enriched.json" "$CARDS"
echo "Enriched $(jq 'length' "$CARDS") cards in $CARDS"
