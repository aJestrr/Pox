#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARDS="$ROOT/data/cards.json"
OUT="$ROOT/pokemon-tcg-pocket-index.html"

if [[ ! -f "$CARDS" ]]; then
  echo "Missing $CARDS — run npm run fetch first." >&2
  exit 1
fi

if ! jq -e '.[0] | has("evolveFrom") and has("fullArt")' "$CARDS" >/dev/null 2>&1; then
  echo "Cards missing evolveFrom/fullArt — running enrich..."
  bash "$ROOT/scripts/enrich-cards.sh"
fi

DATA=$(jq -c '.' "$CARDS")

cat > "$OUT" <<'HTML_HEAD'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pokémon TCG Pocket Card Index</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: #fff;
      color: #111;
    }
    header {
      padding: 12px 16px;
      border-bottom: 1px solid #ccc;
      background: #f5f5f5;
    }
    header h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
    header p { margin: 0; color: #555; }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 72px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 4px 8px;
      text-align: left;
      vertical-align: top;
    }
    thead th {
      position: sticky;
      top: 0;
      background: #e8e8e8;
      cursor: pointer;
      user-select: none;
      z-index: 1;
      white-space: nowrap;
    }
    thead th:hover { background: #dcdcdc; }
    thead th.sorted-asc::after { content: " ▲"; }
    thead th.sorted-desc::after { content: " ▼"; }
    tbody tr:nth-child(even) { background: #fafafa; }
    tbody tr:hover { background: #f0f7ff; }
    tbody tr.highlight {
      background: #fff3b0 !important;
      outline: 2px solid #e6b800;
    }
    .evo-link {
      color: #0645ad;
      cursor: pointer;
      text-decoration: underline;
      white-space: nowrap;
    }
    .evo-link:hover { color: #0b0080; }
    .evo-from::before { content: "↑ "; color: #666; }
    .evo-to::before { content: "↓ "; color: #666; }
    .evo-sep { color: #999; margin: 0 2px; }
    td.evo-cell { max-width: 220px; line-height: 1.5; }
    td.wrap { white-space: normal; }
  </style>
</head>
<body>
  <header>
    <h1>Pokémon TCG Pocket — Card Index</h1>
    <p id="count"></p>
  </header>
  <div class="table-wrap">
    <table>
      <thead id="thead"></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <script>
HTML_HEAD

printf 'const CARDS = %s;\n' "$DATA" >> "$OUT"

cat >> "$OUT" <<'HTML_TAIL'
const COLUMNS = [
  { key: "dexId", label: "Pokédex #", render: (c) => c.dexId ?? "—" },
  { key: "expansionNumber", label: "Expansion #", render: (c) => c.expansionNumber },
  { key: "cardName", label: "Card Name", render: (c) => c.cardName },
  { key: "expansionName", label: "Expansion Name", render: (c) => c.expansionName },
  { key: "cardType", label: "Card Type", render: (c) => c.cardType },
  { key: "hp", label: "HP", render: (c) => c.hp === "" ? "—" : c.hp },
  { key: "damage", label: "Damage", render: (c) => c.damage || "—" },
  { key: "stage", label: "Stage", render: (c) => c.stage || "—" },
  { key: "specialModifier", label: "Special Modifier", render: (c) => c.specialModifier || "—" },
  { key: "fullArt", label: "Full Art", render: (c) => c.fullArt ? "Yes" : "No" },
  { key: "rarity", label: "Stars/Diamonds/Crowns", render: (c) => c.rarity },
  { key: "evolutions", label: "Evolutions", sortable: false },
];

let sortKey = "dexId";
let sortDir = "asc";
let highlightId = null;

const bySetAndName = new Map();
const byId = new Map();
CARDS.forEach((card) => {
  byId.set(card.id, card);
  const key = card.expansionNumber + "|" + card.cardName;
  if (!bySetAndName.has(key)) bySetAndName.set(key, []);
  bySetAndName.get(key).push(card);
});

function getEvolutionPeers(card) {
  const from = [];
  const to = [];
  if (card.evolveFrom) {
    const key = card.expansionNumber + "|" + card.evolveFrom;
    (bySetAndName.get(key) || []).forEach((c) => from.push(c));
  }
  CARDS.forEach((c) => {
    if (c.expansionNumber === card.expansionNumber && c.evolveFrom === card.cardName) {
      to.push(c);
    }
  });
  return { from, to };
}

function compareValues(a, b, key) {
  if (key === "evolutions") return 0;
  const va = a[key] ?? "";
  const vb = b[key] ?? "";
  if (key === "dexId" || key === "hp") {
    const na = va === "" ? Infinity : Number(va);
    const nb = vb === "" ? Infinity : Number(vb);
    return na - nb;
  }
  if (key === "fullArt") {
    return Number(a.fullArt) - Number(b.fullArt);
  }
  if (key === "damage") {
    const maxD = (v) => {
      if (!v) return -1;
      const nums = String(v).match(/\d+/g);
      return nums ? Math.max(...nums.map(Number)) : -1;
    };
    return maxD(va) - maxD(vb);
  }
  return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
}

function sortedCards() {
  return [...CARDS].sort((a, b) => {
    const cmp = compareValues(a, b, sortKey);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function scrollToCard(id) {
  highlightId = id;
  const row = document.getElementById("card-" + id);
  if (row) {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    render();
    setTimeout(() => {
      highlightId = null;
      render();
    }, 2000);
  }
}

function renderEvoCell(card) {
  const { from, to } = getEvolutionPeers(card);
  if (!from.length && !to.length) return "—";
  const td = document.createElement("td");
  td.className = "evo-cell wrap";
  const parts = [];
  from.forEach((c, i) => {
    if (i) parts.push(document.createTextNode(", "));
    const a = document.createElement("span");
    a.className = "evo-link evo-from";
    a.textContent = c.cardName;
    a.title = "Evolves from " + c.cardName + " (" + c.id + ")";
    a.onclick = () => scrollToCard(c.id);
    parts.push(a);
  });
  if (from.length && to.length) {
    const sep = document.createElement("span");
    sep.className = "evo-sep";
    sep.textContent = " | ";
    parts.push(sep);
  }
  to.forEach((c, i) => {
    if (i) parts.push(document.createTextNode(", "));
    const a = document.createElement("span");
    a.className = "evo-link evo-to";
    a.textContent = c.cardName;
    a.title = "Evolves into " + c.cardName + " (" + c.id + ")";
    a.onclick = () => scrollToCard(c.id);
    parts.push(a);
  });
  parts.forEach((p) => td.appendChild(p));
  return td;
}

function render() {
  const thead = document.getElementById("thead");
  const tbody = document.getElementById("tbody");
  const count = document.getElementById("count");

  thead.innerHTML = "";
  const headRow = document.createElement("tr");
  COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.sortable !== false) {
      if (col.key === sortKey) {
        th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
      th.onclick = () => {
        if (sortKey === col.key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = col.key; sortDir = "asc"; }
        render();
      };
    } else {
      th.style.cursor = "default";
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  tbody.innerHTML = "";
  sortedCards().forEach((card) => {
    const tr = document.createElement("tr");
    tr.id = "card-" + card.id;
    if (card.id === highlightId) tr.classList.add("highlight");
    COLUMNS.forEach((col) => {
      if (col.key === "evolutions") {
        tr.appendChild(renderEvoCell(card));
        return;
      }
      const td = document.createElement("td");
      const val = col.render(card);
      td.textContent = val;
      td.title = String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  const colLabel = COLUMNS.find((c) => c.key === sortKey)?.label ?? sortKey;
  count.textContent = CARDS.length + " cards · sorted by " + colLabel + " (" + sortDir + ")";
}

render();
  </script>
</body>
</html>
HTML_TAIL

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "Wrote $OUT ($SIZE bytes)"
