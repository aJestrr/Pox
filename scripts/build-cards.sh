#!/usr/bin/env bash
# Build complete card database from chase-manning v4 + optional TCGdex enrichment
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/cards.json"
TMP="$(mktemp -d)"
API="https://api.tcgdex.net/v2/en"
PARALLEL="${PARALLEL:-20}"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading v4 card database..."
curl -sf "https://raw.githubusercontent.com/chase-manning/pokemon-tcg-pocket-cards/refs/heads/main/v4.json" \
  -o "$TMP/v4.json"
curl -sf "https://raw.githubusercontent.com/chase-manning/pokemon-tcg-pocket-cards/refs/heads/main/expansions.json" \
  -o "$TMP/expansions.json"

echo "Building base card list from v4..."
jq --slurpfile exp "$TMP/expansions.json" '
  def norm_id($id):
    ($id | ascii_downcase) as $l
    | if ($l | startswith("pa-")) then "P-A-" + ($l[3:])
      elif ($l | startswith("pb-")) then "P-B-" + ($l[3:])
      else ($l | split("-") | (.[0] | if test("^[a-z][0-9]+[a-z]$") then (.[0:1]|ascii_upcase) + .[1:] else ascii_upcase end) + "-" + .[1])
      end;

  def exp_from($id):
    if ($id | startswith("P-A-")) then "P-A"
    elif ($id | startswith("P-B-")) then "P-B"
    else ($id | split("-")[0] | if test("^[A-Z][0-9]+[a-z]$") then . else ascii_upcase end)
    end;

  def rarity_labels:
    {
      "◊": "One Diamond", "◊◊": "Two Diamond", "◊◊◊": "Three Diamond", "◊◊◊◊": "Four Diamond",
      "☆": "One Star", "☆☆": "Two Star", "☆☆☆": "Three Star", "♕": "Crown", "Promo": "Promo"
    };

  (($exp[0] | map({key: .id, value: .name}) | from_entries)
    + {"pa": "Promos-A", "pb": "Promos-B"}) as $enames |
  rarity_labels as $rmap |

  [.[] | . as $raw |
    norm_id($raw.id) as $nid |
    exp_from($nid) as $expnum |
    ($expnum | ascii_downcase) as $expkey |
    {
      id: $nid,
      expansionNumber: $expnum,
      cardName: ($raw.name // ""),
      expansionName: ($enames[$expkey] // $expnum),
      cardType: (if $raw.type == "Trainer" then "Trainer" else $raw.type end),
      hp: (if ($raw.health | length) > 0 then ($raw.health | tonumber) else "" end),
      damage: "",
      stage: (if ($raw.name | test(" ex$"; "i")) then "Basic" else "" end),
      specialModifier: (
        if $raw.ex == "Yes" then
          if ($raw.name | test("mega .+ ex"; "i")) then "Mega ex" else "ex" end
        else "" end
      ),
      rarity: ($rmap[$raw.rarity] // $raw.rarity // ""),
      dexId: null,
      category: (if $raw.type == "Trainer" then "Trainer" else "Pokemon" end),
      evolveFrom: "",
      fullArt: ($raw.fullart == "Yes"),
      image: ($raw.image // "")
    }
  ]
  | sort_by(.expansionNumber, .id)
' "$TMP/v4.json" > "$TMP/base.json"

BASE_COUNT=$(jq 'length' "$TMP/base.json")
echo "  $BASE_COUNT cards from v4"

echo "Fetching TCGdex enrichment (optional)..."
curl -sf "$API/series/tcgp" -o "$TMP/series.json"
jq -r '.sets[].id' "$TMP/series.json" > "$TMP/set-ids.txt"
> "$TMP/card-ids.txt"
while IFS= read -r set_id; do
  curl -sf "$API/sets/$set_id" -o "$TMP/set.json"
  jq -r '.cards[].id' "$TMP/set.json" >> "$TMP/card-ids.txt"
done < "$TMP/set-ids.txt"

mkdir -p "$TMP/raw"
export API TMP
cat "$TMP/card-ids.txt" | xargs -P "$PARALLEL" -I {} sh -c '
  curl -sf "$API/cards/{}" -o "$TMP/raw/{}.json" 2>/dev/null || true
' _

if ls "$TMP/raw"/*.json >/dev/null 2>&1; then
  jq -s 'map({key: (.id | ascii_downcase), value: .}) | from_entries' "$TMP/raw"/*.json > "$TMP/tcg-map.json"
  echo "Merging TCGdex fields..."
  jq --slurpfile tcg "$TMP/tcg-map.json" '
    def damage($c):
      if (($c.attacks // []) | length) == 0 then ""
      else [($c.attacks[] | select(.damage != null) | .damage | tostring)] | join(" / ")
      end;

    map(
      . as $base |
      ($tcg[0][($base.id | ascii_downcase)] // null) as $t |
      if $t == null then $base else
        $base
        | .cardName = ($t.name // .cardName)
        | .expansionName = ($t.set.name // .expansionName)
        | .cardType = (
            if (($t.types // []) | length) > 0 then ($t.types | join("/"))
            elif $t.trainerType then $t.trainerType
            else .cardType end
          )
        | .hp = ($t.hp // .hp)
        | .damage = damage($t)
        | .stage = ($t.stage // .stage)
        | .rarity = ($t.rarity // .rarity)
        | .dexId = (if $t.dexId then $t.dexId[0] else null end)
        | .category = ($t.category // .category)
        | .evolveFrom = ($t.evolveFrom // "")
        | .fullArt = (.fullArt or (($t.rarity // "") | test("Star|Crown|Shiny")))
        | .image = (if .image != "" then .image elif $t.image then $t.image + "/high.png" else "" end)
        | .specialModifier = (
            if ($t.name | test("mega .+ ex"; "i")) then "Mega ex"
            elif ($t.name | test(" ex$"; "i")) then "ex"
            else .specialModifier end
          )
      end
    )
    | sort_by(
        (if .dexId == null then 99999 else .dexId end),
        .expansionNumber,
        .id
      )
  ' "$TMP/base.json" > "$OUT"
else
  cp "$TMP/base.json" "$OUT"
fi

COUNT=$(jq 'length' "$OUT")
WITH_IMG=$(jq '[.[] | select(.image != "")] | length' "$OUT")
echo "Wrote $COUNT cards ($WITH_IMG with images) to $OUT"
