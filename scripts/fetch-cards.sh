#!/usr/bin/env bash
set -euo pipefail

API="https://api.tcgdex.net/v2/en"
OUT="$(cd "$(dirname "$0")/.." && pwd)/data/cards.json"
TMP="$(mktemp -d)"
PARALLEL="${PARALLEL:-20}"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$(dirname "$OUT")"

echo "Fetching TCG Pocket series..."
curl -sf "$API/series/tcgp" -o "$TMP/series.json"
jq -r '.sets[].id' "$TMP/series.json" > "$TMP/set-ids.txt"
SET_COUNT=$(wc -l < "$TMP/set-ids.txt" | tr -d ' ')
echo "Found $SET_COUNT sets"

> "$TMP/card-ids.txt"
while IFS= read -r set_id; do
  echo "  Listing cards in $set_id..."
  curl -sf "$API/sets/$set_id" -o "$TMP/set.json"
  jq -r '.cards[].id' "$TMP/set.json" >> "$TMP/card-ids.txt"
done < "$TMP/set-ids.txt"

TOTAL=$(wc -l < "$TMP/card-ids.txt" | tr -d ' ')
echo "Fetching details for $TOTAL cards ($PARALLEL parallel)..."

mkdir -p "$TMP/raw"

export API TMP
cat "$TMP/card-ids.txt" | xargs -P "$PARALLEL" -I {} sh -c '
  card_id="$1"
  curl -sf "$API/cards/$card_id" -o "$TMP/raw/${card_id}.json" || echo "failed: $card_id" >&2
' _ {}

DOWNLOADED=$(ls "$TMP/raw" | wc -l | tr -d ' ')
echo "Downloaded $DOWNLOADED / $TOTAL card files"

echo "Normalizing and sorting..."
jq -s '
  map({
    id,
    expansionNumber: .set.id,
    cardName: .name,
    expansionName: .set.name,
    cardType: (
      if .types then (.types | join("/"))
      elif .trainerType then .trainerType
      else .category // ""
      end
    ),
    hp: (.hp // ""),
    damage: (
      if (.attacks // []) | length == 0 then ""
      else [(.attacks[] | select(.damage != null) | .damage | tostring)] | join(" / ")
      end
    ),
    stage: (.stage // ""),
    specialModifier: (
      if (.name | test("mega .+ ex"; "i")) then "Mega ex"
      elif .suffix == "EX" or (.name | test(" ex$"; "i")) then "ex"
      else ""
      end
    ),
    rarity: (.rarity // ""),
    dexId: (if .dexId then .dexId[0] else null end),
    category: (.category // ""),
    evolveFrom: (.evolveFrom // ""),
    fullArt: ((.rarity // "") | test("Star|Crown|Shiny"))
  })
  | sort_by(
      (if .dexId == null then 99999 else .dexId end),
      .expansionNumber,
      .id
    )
' "$TMP/raw"/*.json > "$OUT"

COUNT=$(jq 'length' "$OUT")
echo "Wrote $COUNT cards to $OUT"
