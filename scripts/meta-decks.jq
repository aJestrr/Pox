def norm_id($id):
  ($id | ascii_downcase) as $l
  | if ($l | startswith("pa-")) then "P-A-" + ($l[3:])
    elif ($l | startswith("pb-")) then "P-B-" + ($l[3:])
    else ($l | split("-") | (.[0] | if test("^[a-z][0-9]+[a-z]$") then (.[0:1]|ascii_upcase) + .[1:] else ascii_upcase end) + "-" + .[1])
    end;

def parse_cards($arr):
  [$arr[] | split(":") | {count: (.[0] | tonumber), id: norm_id(.[1])}]
  | map(.id as $id | range(.count) | $id)
  | . + [range(20 - length) | null]
  | .[0:20];

def format_slug_part($part):
  ($part | sub("-[a-z][0-9]+[a-z]?-[0-9]+$"; ""))
  | split("-")
  | map(if . == "ex" then "ex" elif . == "mega" then "Mega" else (.[0:1] | ascii_upcase) + .[1:] end)
  | join(" ");

def slug_name($slug):
  ($slug | split("&") | map(format_slug_part(.)) | join(" / "));

def primary_exp($slug; $cards):
  if ($slug | test("-[a-z][0-9]+[a-z]?-[0-9]+$"; "i")) then
    ($slug | capture("-(?<e>[a-z][0-9]+[a-z]?)-[0-9]+$").e
      | if test("^[a-z][0-9]+[a-z]$") then (.[0:1]|ascii_upcase) + .[1:] else ascii_upcase end)
  else
    ([$cards[] | select(. != null and (startswith("P-") | not)) | split("-")[0]]
     | group_by(.) | map({exp: .[0], n: length}) | max_by(.n) | .exp // "")
  end;

def exp_names:
  {
    "A1": "Genetic Apex", "A1a": "Mythical Island", "A2": "Space-Time Smackdown",
    "A2a": "Triumphant Light", "A2b": "Shining Revelry", "A3": "Celestial Guardians",
    "A3a": "Extradimensional Crisis", "A3b": "Eevee Grove", "A4": "Wisdom of Sea and Sky",
    "A4a": "Secluded Springs", "A4b": "Deluxe Pack: ex", "B1": "Mega Rising",
    "B1a": "Crimson Blaze", "B2": "Fantastical Parade", "B2a": "Paldean Wonders",
    "B2b": "Mega Shine", "B3": "Pulsing Aura", "B3a": "Paradox Drive"
  };

def energy_types($cards; $index):
  if ($index | length) == 0 then []
  else
    [$cards[] | select(. != null) | $index[.].cardType // empty | select(. != "Trainer")]
    | unique
  end;

($cards[0] // [] | map({key: .id, value: .}) | from_entries) as $cindex |
exp_names as $enames |

[.[] |
  (.lists | max_by(.strength)) as $best |
  (parse_cards($best.cards)) as $cardIds |
  (primary_exp(.name; $cardIds)) as $exp |
  {
    id: .name,
    name: slug_name(.name),
    expansion: $exp,
    expansionName: ($enames[$exp] // $exp),
    winRate: ($best.strength * 100 | round),
    metaShare: ((.popularity * 1000) | round / 10),
    strength: $best.strength,
    cards: $cardIds,
    energyTypes: energy_types($cardIds; $cindex)
  }
]
| sort_by(-.winRate) as $decks |
{
  updatedAt: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
  source: "pocketdecks.top / Limitless TCG",
  decks: $decks,
  topPerExpansion: (
    $decks | group_by(.expansion) | map({key: .[0].expansion, value: max_by(.winRate)}) | from_entries
  )
}
