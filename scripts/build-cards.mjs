import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "cards.json");
const V4_URL =
  "https://raw.githubusercontent.com/chase-manning/pokemon-tcg-pocket-cards/refs/heads/main/v4.json";
const EXPANSIONS_URL =
  "https://raw.githubusercontent.com/chase-manning/pokemon-tcg-pocket-cards/refs/heads/main/expansions.json";
const API = "https://api.tcgdex.net/v2/en";
const CONCURRENCY = 25;

const RARITY_MAP = {
  "◊": "One Diamond",
  "◊◊": "Two Diamond",
  "◊◊◊": "Three Diamond",
  "◊◊◊◊": "Four Diamond",
  "☆": "One Star",
  "☆☆": "Two Star",
  "☆☆☆": "Three Star",
  "♕": "Crown",
  Promo: "Promo",
};

const POKEMON_TYPES = new Set([
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
]);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function normalizeCardId(raw) {
  const id = String(raw).trim().toLowerCase();
  if (id.startsWith("pa-")) return `P-A-${id.slice(3)}`;
  if (id.startsWith("pb-")) return `P-B-${id.slice(3)}`;
  const match = id.match(/^([a-z]\d+[a-z]?)-(\d+)$/i);
  if (!match) return id.toUpperCase();
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function expansionFromId(cardId) {
  if (cardId.startsWith("P-A-")) return "P-A";
  if (cardId.startsWith("P-B-")) return "P-B";
  const dash = cardId.lastIndexOf("-");
  return cardId.slice(0, dash);
}

function buildExpansionNameMap(expansions) {
  const map = new Map();
  for (const exp of expansions) {
    map.set(exp.id.toLowerCase(), exp.name);
  }
  map.set("pa", "Promos-A");
  map.set("pb", "Promos-B");
  map.set("p-a", "Promos-A");
  map.set("p-b", "Promos-B");
  return map;
}

function extractModifier(name) {
  if (/mega\s+.+\s+ex/i.test(name)) return "Mega ex";
  if (/\s+ex$/i.test(name)) return "ex";
  return "";
}

function extractDamage(card) {
  if (!card.attacks?.length) return "";
  return card.attacks
    .map((a) => (a.damage != null ? String(a.damage) : null))
    .filter(Boolean)
    .join(" / ");
}

function extractCardType(raw, tcg) {
  if (tcg?.types?.length) return tcg.types.join("/");
  if (tcg?.trainerType) return tcg.trainerType;
  if (raw.type === "Trainer") return tcg?.category === "Trainer" ? "Trainer" : "Trainer";
  return raw.type ?? "";
}

function inferStage(name, tcgStage) {
  if (tcgStage) return tcgStage;
  if (/\s+ex$/i.test(name)) return "Basic";
  return "";
}

async function mapPool(items, fn, concurrency) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  console.log("Downloading card database (v4)...");
  const [v4Cards, expansions] = await Promise.all([
    fetchJson(V4_URL),
    fetchJson(EXPANSIONS_URL),
  ]);
  const expansionNames = buildExpansionNameMap(expansions);
  console.log(`  ${v4Cards.length} cards from v4.json`);

  console.log("Fetching TCGdex enrichment...");
  const series = await fetchJson(`${API}/series/tcgp`);
  const tcgIds = [];
  for (const set of series.sets ?? []) {
    const setData = await fetchJson(`${API}/sets/${set.id}`);
    for (const card of setData.cards ?? []) {
      tcgIds.push(card.id);
    }
  }
  console.log(`  ${tcgIds.length} cards from TCGdex`);

  const tcgById = new Map();
  let done = 0;
  await mapPool(
    tcgIds,
    async (id) => {
      try {
        const raw = await fetchJson(`${API}/cards/${id}`);
        tcgById.set(normalizeCardId(id), raw);
      } catch {
        /* skip */
      }
      done++;
      if (done % 200 === 0 || done === tcgIds.length) {
        console.log(`  enriched ${done}/${tcgIds.length}`);
      }
    },
    CONCURRENCY
  );

  const cards = v4Cards.map((raw) => {
    const id = normalizeCardId(raw.id);
    const expansionNumber = expansionFromId(id);
    const expKey = expansionNumber.toLowerCase().replace("p-a", "pa").replace("p-b", "pb");
    const tcg = tcgById.get(id);
    const cardName = raw.name ?? tcg?.name ?? "";
    const category =
      tcg?.category ?? (POKEMON_TYPES.has(raw.type) ? "Pokemon" : "Trainer");

    return {
      id,
      expansionNumber,
      cardName,
      expansionName:
        expansionNames.get(expKey) ??
        tcg?.set?.name ??
        expansionNumber,
      cardType: extractCardType(raw, tcg),
      hp: tcg?.hp ?? (raw.health ? Number(raw.health) : ""),
      damage: tcg ? extractDamage(tcg) : "",
      stage: inferStage(cardName, tcg?.stage ?? ""),
      specialModifier:
        raw.ex === "Yes"
          ? extractModifier(cardName) || "ex"
          : extractModifier(cardName),
      rarity: tcg?.rarity ?? RARITY_MAP[raw.rarity] ?? raw.rarity ?? "",
      dexId: tcg?.dexId?.[0] ?? null,
      category,
      evolveFrom: tcg?.evolveFrom ?? "",
      fullArt:
        raw.fullart === "Yes" ||
        (tcg?.rarity ?? "").match(/Star|Crown|Shiny/) != null,
      image:
        raw.image ??
        (tcg?.image ? `${tcg.image}/high.png` : ""),
    };
  });

  cards.sort((a, b) => {
    const dexA = a.dexId ?? 99999;
    const dexB = b.dexId ?? 99999;
    if (dexA !== dexB) return dexA - dexB;
    if (a.expansionNumber !== b.expansionNumber) {
      return a.expansionNumber.localeCompare(b.expansionNumber);
    }
    return a.id.localeCompare(b.id);
  });

  writeFileSync(OUT, JSON.stringify(cards, null, 2));
  console.log(`Wrote ${cards.length} cards to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
