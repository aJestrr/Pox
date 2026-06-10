/** @typedef {{ id: string, expansionNumber: string, cardName: string, expansionName: string, cardType: string, hp: number|string, damage: string, stage: string, specialModifier: string, rarity: string, dexId: number|null, image: string, category?: string }} Card */

/** @typedef {{ id: string, name: string, expansion: string, expansionName: string, winRate: number, metaShare: number, strength: number, cards: string[], energyTypes: string[] }} MetaDeck */

const INDEX_COLUMNS = [
  { key: "dexId", label: "Pokédex #" },
  { key: "image", label: "Image", sortable: false },
  { key: "expansionNumber", label: "Expansion #" },
  { key: "cardName", label: "Card Name" },
  { key: "expansionName", label: "Expansion Name" },
  { key: "cardType", label: "Card Type" },
  { key: "hp", label: "HP" },
  { key: "damage", label: "Damage" },
  { key: "stage", label: "Stage" },
  { key: "specialModifier", label: "Special Modifier" },
  { key: "rarity", label: "Stars/Diamonds/Crowns" },
];

const ENERGY_TYPES = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Colorless",
];

/** @type {Card[]} */
let cards = [];
/** @type {Map<string, Card>} */
let cardById = new Map();
/** @type {MetaDeck[]} */
let metaDecks = [];
/** @type {Record<string, MetaDeck>} */
let topPerExpansion = {};

let indexSortKey = "dexId";
let indexSortDir = "asc";
let indexSearch = "";
let indexExpansionFilter = "";
let indexTypeFilter = "";

/** @type {(string|null)[]} */
let deckSlots = Array(20).fill(null);

let metaSort = "winRate";
let metaExpansionFilter = "";
let metaTopOnly = false;

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizeId(raw) {
  const id = String(raw).trim().toLowerCase();
  if (id.startsWith("pa-")) return `P-A-${id.slice(3)}`;
  if (id.startsWith("pb-")) return `P-B-${id.slice(3)}`;
  const m = id.match(/^([a-z]\d+[a-z]?)-(\d+)$/i);
  if (!m) return id.toUpperCase();
  return `${m[1].toUpperCase()}-${m[2]}`;
}

function deckFingerprint(ids) {
  const counts = new Map();
  for (const id of ids.filter(Boolean)) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, n]) => `${n}:${id}`)
    .join("|");
}

function compareValues(a, b, key) {
  const va = a[key] ?? "";
  const vb = b[key] ?? "";
  if (key === "dexId" || key === "hp") {
    const na = va === "" ? Infinity : Number(va);
    const nb = vb === "" ? Infinity : Number(vb);
    return na - nb;
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

function filteredIndexCards() {
  const q = indexSearch.toLowerCase();
  return cards.filter((c) => {
    if (indexExpansionFilter && c.expansionNumber !== indexExpansionFilter) return false;
    if (indexTypeFilter && !c.cardType.includes(indexTypeFilter)) return false;
    if (!q) return true;
    const hay = [
      c.cardName,
      c.expansionName,
      c.expansionNumber,
      c.cardType,
      c.rarity,
      c.specialModifier,
      String(c.dexId ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function sortedIndexCards() {
  const list = [...filteredIndexCards()];
  list.sort((a, b) => {
    const cmp = compareValues(a, b, indexSortKey);
    return indexSortDir === "asc" ? cmp : -cmp;
  });
  return list;
}

function deckCardIds() {
  return deckSlots.filter(Boolean);
}

function deckCount() {
  return deckCardIds().length;
}

function addToDeck(cardId) {
  if (deckCount() >= 20) return false;
  const norm = normalizeId(cardId);
  const empty = deckSlots.findIndex((s) => s === null);
  if (empty === -1) return false;
  deckSlots[empty] = norm;
  renderDeckBuilder();
  return true;
}

function removeFromDeck(index) {
  deckSlots[index] = null;
  renderDeckBuilder();
}

function clearDeck() {
  deckSlots = Array(20).fill(null);
  renderDeckBuilder();
}

function setDeckFromCards(cardIds) {
  deckSlots = Array(20).fill(null);
  cardIds.slice(0, 20).forEach((id, i) => {
    deckSlots[i] = normalizeId(id);
  });
  renderDeckBuilder();
}

// ─── Synergy scoring ─────────────────────────────────────────────────────────

function computeSynergyScore() {
  const ids = deckCardIds();
  if (ids.length === 0) return { score: 0, label: "Add cards to your deck to calculate synergy." };
  if (ids.length < 20) {
    return {
      score: Math.round((ids.length / 20) * 30),
      label: `${20 - ids.length} more card(s) needed for a full deck.`,
    };
  }

  const fp = deckFingerprint(ids);
  let bestMatch = null;
  let bestOverlap = 0;

  for (const deck of metaDecks) {
    const deckIds = deck.cards.filter(Boolean);
    const overlap = jaccardOverlap(ids, deckIds);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = deck;
    }
    if (deckFingerprint(deckIds) === fp) {
      return {
        score: Math.min(100, Math.round(deck.winRate * 1.1 + deck.metaShare * 0.3)),
        label: `Matches meta deck "${deck.name}" (${deck.winRate}% tournament win rate).`,
      };
    }
  }

  if (!bestMatch) {
    return { score: 35, label: "Unique build — limited meta comparison data." };
  }

  const typeScore = typeSynergy(ids, bestMatch);
  const overlapScore = bestOverlap * 55;
  const metaScore = bestMatch.winRate * 0.35;
  const raw = overlapScore + typeScore + metaScore;
  const score = Math.round(Math.min(100, Math.max(15, raw)));

  return {
    score,
    label: `Closest to "${bestMatch.name}" (${Math.round(bestOverlap * 100)}% card overlap, ${bestMatch.winRate}% meta win rate).`,
  };
}

function jaccardOverlap(a, b) {
  const setA = new Map();
  const setB = new Map();
  for (const id of a) setA.set(id, (setA.get(id) ?? 0) + 1);
  for (const id of b) setB.set(id, (setB.get(id) ?? 0) + 1);
  let intersection = 0;
  let union = 0;
  const all = new Set([...setA.keys(), ...setB.keys()]);
  for (const id of all) {
    const ca = setA.get(id) ?? 0;
    const cb = setB.get(id) ?? 0;
    intersection += Math.min(ca, cb);
    union += Math.max(ca, cb);
  }
  return union === 0 ? 0 : intersection / union;
}

function typeSynergy(userIds, metaDeck) {
  const userTypes = new Set();
  for (const id of userIds) {
    const c = cardById.get(id);
    if (c?.cardType && c.cardType !== "Trainer") userTypes.add(c.cardType);
  }
  const metaTypes = new Set(metaDeck.energyTypes ?? []);
  if (metaTypes.size === 0) return 10;
  let shared = 0;
  for (const t of userTypes) if (metaTypes.has(t)) shared++;
  return (shared / Math.max(userTypes.size, 1)) * 20;
}

// ─── Auto-build ──────────────────────────────────────────────────────────────

function autoBuildDeck() {
  const highlight = document.getElementById("autobuild-card").value;
  const energyType = document.getElementById("autobuild-type").value;
  if (!highlight) {
    alert("Select a highlight card to auto-build around.");
    return;
  }

  const normHighlight = normalizeId(highlight);
  let candidates = metaDecks.filter((d) =>
    d.cards.some((id) => id && normalizeId(id) === normHighlight)
  );

  if (energyType) {
    const typed = candidates.filter(
      (d) =>
        d.energyTypes?.includes(energyType) ||
        d.cards.some((id) => cardById.get(id)?.cardType === energyType)
    );
    if (typed.length) candidates = typed;
  }

  candidates.sort((a, b) => b.winRate - a.winRate || b.strength - a.strength);

  if (candidates.length === 0) {
    buildHeuristicDeck(normHighlight, energyType);
    return;
  }

  setDeckFromCards(candidates[0].cards);
}

function buildHeuristicDeck(highlightId, energyType) {
  const highlight = cardById.get(highlightId);
  if (!highlight) return;

  const type = energyType || highlight.cardType;
  const picked = [highlightId];
  const nameBase = highlight.cardName.replace(/\s+ex$/i, "").trim();

  const evoLine = cards.filter(
    (c) =>
      c.cardName.includes(nameBase) &&
      c.expansionNumber === highlight.expansionNumber &&
      !picked.includes(c.id)
  );
  for (const c of evoLine.slice(0, 4)) {
    if (picked.length >= 8) break;
    picked.push(c.id);
  }

  const trainers = cards.filter(
    (c) =>
      c.category === "Trainer" &&
      /Professor|Research|Ball|Communication|Pokédex|Leaf|Bait/i.test(c.cardName)
  );
  for (const t of trainers) {
    if (picked.length >= 14) break;
    if (!picked.includes(t.id)) picked.push(t.id);
  }

  const typeMons = cards
    .filter(
      (c) =>
        c.cardType === type &&
        c.category === "Pokemon" &&
        !picked.includes(c.id) &&
        (c.specialModifier === "ex" || c.specialModifier === "Mega ex")
    )
    .sort((a, b) => Number(b.hp || 0) - Number(a.hp || 0));

  for (const c of typeMons) {
    if (picked.length >= 20) break;
    picked.push(c.id);
  }

  while (picked.length < 20) {
    const filler = cards.find(
      (c) => c.cardType === type && !picked.includes(c.id)
    );
    if (!filler) break;
    picked.push(filler.id);
  }

  setDeckFromCards(picked);
}

// ─── Rendering: Index ────────────────────────────────────────────────────────

function renderIndex() {
  const thead = document.getElementById("index-thead");
  const tbody = document.getElementById("index-tbody");
  thead.innerHTML = "";
  const headRow = document.createElement("tr");
  for (const col of INDEX_COLUMNS) {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.sortable !== false) {
      if (col.key === indexSortKey) {
        th.classList.add(indexSortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
      th.addEventListener("click", () => {
        if (indexSortKey === col.key) {
          indexSortDir = indexSortDir === "asc" ? "desc" : "asc";
        } else {
          indexSortKey = col.key;
          indexSortDir = "asc";
        }
        renderIndex();
      });
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  tbody.innerHTML = "";
  for (const card of sortedIndexCards()) {
    const tr = document.createElement("tr");
    tr.id = `card-${card.id}`;

    for (const col of INDEX_COLUMNS) {
      const td = document.createElement("td");
      if (col.key === "image") {
        if (card.image) {
          const img = document.createElement("img");
          img.src = card.image;
          img.alt = card.cardName;
          img.className = "card-thumb";
          img.loading = "lazy";
          td.appendChild(img);
        } else {
          td.textContent = "—";
        }
      } else if (col.key === "dexId") {
        td.textContent = card.dexId ?? "—";
      } else if (col.key === "hp") {
        td.textContent = card.hp === "" ? "—" : String(card.hp);
      } else {
        const val = card[col.key] || "—";
        td.textContent = val;
        td.title = val;
        if (col.key === "cardType") {
          td.className = `type-${String(card.cardType).toLowerCase()}`;
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function populateFilters() {
  const expansions = [...new Set(cards.map((c) => c.expansionNumber))].sort();
  const expSelect = document.getElementById("index-expansion-filter");
  const metaExpSelect = document.getElementById("meta-expansion-filter");
  for (const sel of [expSelect, metaExpSelect]) {
    const current = sel.value;
    sel.innerHTML = '<option value="">All expansions</option>';
    for (const exp of expansions) {
      const opt = document.createElement("option");
      opt.value = exp;
      const name = cards.find((c) => c.expansionNumber === exp)?.expansionName ?? exp;
      opt.textContent = `${exp} — ${name}`;
      sel.appendChild(opt);
    }
    sel.value = current;
  }

  const typeSelect = document.getElementById("index-type-filter");
  const types = [...new Set(cards.map((c) => c.cardType).filter(Boolean))].sort();
  typeSelect.innerHTML = '<option value="">All types</option>';
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  }

  const abType = document.getElementById("autobuild-type");
  abType.innerHTML = '<option value="">Any type</option>';
  for (const t of ENERGY_TYPES) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    abType.appendChild(opt);
  }

  const abCard = document.getElementById("autobuild-card");
  const exCards = cards
    .filter((c) => c.specialModifier === "ex" || c.specialModifier === "Mega ex")
    .sort((a, b) => a.cardName.localeCompare(b.cardName));
  abCard.innerHTML = '<option value="">Select a card…</option>';
  for (const c of exCards) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.cardName} [${c.expansionNumber}]`;
    abCard.appendChild(opt);
  }
}

// ─── Rendering: Deck Builder ─────────────────────────────────────────────────

function renderDeckBuilder() {
  const container = document.getElementById("deck-slots");
  container.innerHTML = "";

  deckSlots.forEach((cardId, i) => {
    const slot = document.createElement("div");
    slot.className = `deck-slot${cardId ? " filled" : ""}`;

    if (cardId) {
      const card = cardById.get(cardId);
      const img = document.createElement("img");
      img.src = card?.image ?? "";
      img.alt = card?.cardName ?? cardId;
      slot.appendChild(img);

      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.textContent = "×";
      btn.type = "button";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFromDeck(i);
      });
      slot.appendChild(btn);
    } else {
      const span = document.createElement("span");
      span.className = "slot-empty";
      span.textContent = "+";
      slot.appendChild(span);
    }
    container.appendChild(slot);
  });

  document.getElementById("deck-count").textContent = String(deckCount());

  const { score, label } = computeSynergyScore();
  document.getElementById("synergy-score").textContent = deckCount() > 0 ? String(score) : "—";
  document.getElementById("synergy-bar").style.width = `${score}%`;
  document.getElementById("synergy-label").textContent = label;
}

function renderBuilderSearch(query = "") {
  const container = document.getElementById("builder-results");
  const q = query.toLowerCase();
  const inDeck = new Set(deckCardIds());

  const results = cards
    .filter((c) => {
      if (inDeck.has(c.id) && deckCount() >= 20) return false;
      if (!q) return true;
      return (
        c.cardName.toLowerCase().includes(q) ||
        c.expansionNumber.toLowerCase().includes(q) ||
        c.cardType.toLowerCase().includes(q)
      );
    })
    .slice(0, 60);

  container.innerHTML = "";
  for (const card of results) {
    const el = document.createElement("div");
    el.className = "picker-card";
    el.title = `${card.cardName} — ${card.expansionName}`;

    const img = document.createElement("img");
    img.src = card.image;
    img.alt = card.cardName;
    img.loading = "lazy";
    el.appendChild(img);

    const label = document.createElement("div");
    label.className = "picker-label";
    label.textContent = card.cardName;
    el.appendChild(label);

    el.addEventListener("click", () => addToDeck(card.id));
    container.appendChild(el);
  }
}

// ─── Rendering: Meta Decks ───────────────────────────────────────────────────

function sortedMetaDecks() {
  let list = [...metaDecks];
  if (metaTopOnly) {
    list = Object.values(topPerExpansion);
  }
  if (metaExpansionFilter) {
    list = list.filter((d) => d.expansion === metaExpansionFilter);
  }
  list.sort((a, b) => {
    if (metaSort === "expansion") {
      return a.expansionName.localeCompare(b.expansionName) || b.winRate - a.winRate;
    }
    if (metaSort === "metaShare") return b.metaShare - a.metaShare;
    return b.winRate - a.winRate;
  });
  return list;
}

function renderMetaDecks() {
  const container = document.getElementById("meta-decks-list");
  container.innerHTML = "";

  if (metaDecks.length === 0) {
    container.innerHTML =
      '<p class="loading-panel">No meta deck data. Run <code>npm run meta</code> to fetch tournament decks.</p>';
    return;
  }

  for (const deck of sortedMetaDecks()) {
    const card = document.createElement("article");
    card.className = "meta-deck-card";

    const isTop = topPerExpansion[deck.expansion]?.id === deck.id;

    card.innerHTML = `
      <div class="meta-deck-header">
        <h3>${deck.name} ${isTop ? '<span class="badge top">Top ' + deck.expansion + '</span>' : ""}</h3>
        <div class="meta-deck-stats">
          <span class="badge">${deck.expansion} — ${deck.expansionName}</span>
          <span class="win-rate">${deck.winRate}% win rate</span>
          <span>${deck.metaShare}% meta share</span>
        </div>
      </div>
      <div class="meta-deck-cards"></div>
    `;

    const cardsEl = card.querySelector(".meta-deck-cards");
    for (const id of deck.cards) {
      if (!id) continue;
      const c = cardById.get(id);
      const img = document.createElement("img");
      img.src = c?.image ?? "";
      img.alt = c?.cardName ?? id;
      img.title = c ? `${c.cardName} [${c.expansionNumber}]` : id;
      img.loading = "lazy";
      img.addEventListener("click", () => {
        switchTab("builder");
        setDeckFromCards(deck.cards);
      });
      cardsEl.appendChild(img);
    }

    const loadBtn = document.createElement("button");
    loadBtn.className = "btn";
    loadBtn.style.marginTop = "10px";
    loadBtn.textContent = "Load into Deck Builder";
    loadBtn.addEventListener("click", () => {
      switchTab("builder");
      setDeckFromCards(deck.cards);
    });
    card.appendChild(loadBtn);

    container.appendChild(card);
  }
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".panel").forEach((p) => {
    const id = p.id.replace("panel-", "");
    const active = id === name;
    p.classList.toggle("active", active);
    p.hidden = !active;
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

function updateStatusLine() {
  const el = document.getElementById("status-line");
  el.textContent = `${cards.length} cards · ${metaDecks.length} meta decks · sorted by Pokédex #`;
}

async function init() {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");

  try {
    const [cardsRes, metaRes] = await Promise.all([
      fetch("./data/cards.json"),
      fetch("./data/meta-decks.json").catch(() => null),
    ]);

    if (!cardsRes.ok) throw new Error(`Failed to load cards.json (${cardsRes.status})`);
    cards = await cardsRes.json();
    cardById = new Map(cards.map((c) => [c.id, c]));

    if (metaRes?.ok) {
      const metaData = await metaRes.json();
      metaDecks = metaData.decks ?? [];
      topPerExpansion = metaData.topPerExpansion ?? {};
    }

    loading.hidden = true;
    updateStatusLine();
    populateFilters();
    renderIndex();
    renderDeckBuilder();
    renderBuilderSearch();
    renderMetaDecks();
  } catch (err) {
    loading.hidden = true;
    error.hidden = false;
    error.textContent = `${err.message}. Run "npm run build:data" to download card and meta deck data.`;
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

document.getElementById("index-search").addEventListener("input", (e) => {
  indexSearch = e.target.value;
  renderIndex();
});

document.getElementById("index-expansion-filter").addEventListener("change", (e) => {
  indexExpansionFilter = e.target.value;
  renderIndex();
});

document.getElementById("index-type-filter").addEventListener("change", (e) => {
  indexTypeFilter = e.target.value;
  renderIndex();
});

document.getElementById("builder-search").addEventListener("input", (e) => {
  renderBuilderSearch(e.target.value);
});

document.getElementById("autobuild-btn").addEventListener("click", autoBuildDeck);
document.getElementById("clear-deck-btn").addEventListener("click", clearDeck);

document.getElementById("meta-sort").addEventListener("change", (e) => {
  metaSort = e.target.value;
  renderMetaDecks();
});

document.getElementById("meta-expansion-filter").addEventListener("change", (e) => {
  metaExpansionFilter = e.target.value;
  renderMetaDecks();
});

document.getElementById("meta-top-only").addEventListener("change", (e) => {
  metaTopOnly = e.target.checked;
  renderMetaDecks();
});

init();
