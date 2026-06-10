import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "meta-decks.json");
const DECKS_URL =
  "https://raw.githubusercontent.com/chase-9234/pokemon-tcg-pocket-tier-list/main/public/data/best-decks.json";
const MATCHUP_URL =
  "https://raw.githubusercontent.com/chase-9234/pokemon-tcg-pocket-tier-list/main/public/data/matchup-data.json";

const EXPANSION_NAMES = {
  a1: "Genetic Apex",
  a1a: "Mythical Island",
  a2: "Space-Time Smackdown",
  a2a: "Triumphant Light",
  a2b: "Shining Revelry",
  a3: "Celestial Guardians",
  a3a: "Extradimensional Crisis",
  a3b: "Eevee Grove",
  a4: "Wisdom of Sea and Sky",
  a4a: "Secluded Springs",
  a4b: "Deluxe Pack: ex",
  b1: "Mega Rising",
  b1a: "Crimson Blaze",
  b2: "Fantastical Parade",
  b2a: "Paldean Wonders",
  b2b: "Mega Shine",
  b3: "Pulsing Aura",
  b3a: "Paradox Drive",
};

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

function parseDeckCards(cardStrings) {
  const slots = [];
  for (const entry of cardStrings) {
    const [countStr, rawId] = entry.split(":");
    const count = Number(countStr) || 1;
    const cardId = normalizeCardId(rawId);
    for (let i = 0; i < count; i++) slots.push(cardId);
  }
  while (slots.length < 20) slots.push(null);
  return slots.slice(0, 20);
}

function slugToDisplayName(slug) {
  return slug
    .replace(/-([a-z]\d+[a-z]?)-\d+$/i, "")
    .split("-")
    .map((w) => {
      if (w === "ex") return "ex";
      if (w === "mega") return "Mega";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/\bEx\b/g, "ex")
    .replace(/\bMega\b/g, "Mega")
    .replace(/Mega ex/g, "Mega ex");
}

function primaryExpansion(slug, cards) {
  const fromSlug = slug.match(/-([a-z]\d+[a-z]?)-\d+$/i);
  if (fromSlug) return fromSlug[1].toUpperCase();

  const counts = new Map();
  for (const id of cards) {
    if (!id || id.startsWith("P-")) continue;
    const exp = id.slice(0, id.lastIndexOf("-"));
    counts.set(exp, (counts.get(exp) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [exp, count] of counts) {
    if (count > bestCount) {
      best = exp;
      bestCount = count;
    }
  }
  return best;
}

function deckEnergyTypes(cardIds, cardIndex) {
  const types = new Set();
  for (const id of cardIds) {
    if (!id) continue;
    const card = cardIndex.get(id);
    if (card?.cardType && card.cardType !== "Trainer") {
      card.cardType.split("/").forEach((t) => types.add(t));
    }
  }
  return [...types];
}

async function main() {
  console.log("Downloading meta deck data...");
  const [bestDecks, matchups] = await Promise.all([
    fetchJson(DECKS_URL),
    fetchJson(MATCHUP_URL).catch(() => ({})),
  ]);

  let cardIndex = new Map();
  const cardsPath = join(__dirname, "..", "data", "cards.json");
  if (existsSync(cardsPath)) {
    const cards = JSON.parse(readFileSync(cardsPath, "utf8"));
    cardIndex = new Map(cards.map((c) => [c.id, c]));
  } else {
    console.warn("  cards.json not found; energy types will be inferred later in app");
  }

  const decks = bestDecks.map((deck) => {
    const bestList =
      [...deck.lists].sort((a, b) => b.strength - a.strength)[0] ?? deck.lists[0];
    const cardIds = parseDeckCards(bestList.cards);
    const expansionKey = primaryExpansion(deck.name, cardIds).toLowerCase();
    const winRate = Math.round(bestList.strength * 100);
    const metaShare = Math.round(deck.popularity * 1000) / 10;

    return {
      id: deck.name,
      name: slugToDisplayName(deck.name),
      expansion: primaryExpansion(deck.name, cardIds),
      expansionName:
        EXPANSION_NAMES[expansionKey] ??
        expansionKey.toUpperCase(),
      winRate,
      metaShare,
      strength: bestList.strength,
      cards: cardIds,
      energyTypes: deckEnergyTypes(cardIds, cardIndex),
    };
  });

  decks.sort((a, b) => b.winRate - a.winRate);

  const topPerExpansion = new Map();
  for (const deck of decks) {
    const key = deck.expansion || "Unknown";
    const existing = topPerExpansion.get(key);
    if (!existing || deck.winRate > existing.winRate) {
      topPerExpansion.set(key, deck);
    }
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: "pocketdecks.top / Limitless TCG",
    decks,
    topPerExpansion: Object.fromEntries(topPerExpansion),
    matchups: matchups ?? {},
  };

  writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${decks.length} meta decks to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
