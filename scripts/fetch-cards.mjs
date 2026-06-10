import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = "https://api.tcgdex.net/v2/en";
const CONCURRENCY = 20;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function extractModifier(card) {
  const name = card.name ?? "";
  if (/mega\s+.+\s+ex/i.test(name)) return "Mega ex";
  if (card.suffix === "EX" || /\s+ex$/i.test(name)) return "ex";
  return "";
}

function extractDamage(card) {
  if (!card.attacks?.length) return "";
  const values = card.attacks
    .map((a) => {
      if (a.damage == null) return null;
      return String(a.damage);
    })
    .filter(Boolean);
  return values.join(" / ");
}

function extractCardType(card) {
  if (card.types?.length) return card.types.join("/");
  if (card.trainerType) return card.trainerType;
  return card.category ?? "";
}

function normalizeCard(raw) {
  const dexId = raw.dexId?.[0] ?? null;
  return {
    id: raw.id,
    expansionNumber: raw.set?.id ?? "",
    cardName: raw.name ?? "",
    expansionName: raw.set?.name ?? "",
    cardType: extractCardType(raw),
    hp: raw.hp ?? "",
    damage: extractDamage(raw),
    stage: raw.stage ?? "",
    specialModifier: extractModifier(raw),
    rarity: raw.rarity ?? "",
    dexId,
    category: raw.category ?? "",
  };
}

async function fetchCardDetails(cardId) {
  const raw = await fetchJson(`${API}/cards/${cardId}`);
  return normalizeCard(raw);
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
  console.log("Fetching TCG Pocket series...");
  const series = await fetchJson(`${API}/series/tcgp`);
  const sets = series.sets ?? [];
  console.log(`Found ${sets.length} sets`);

  const cardIds = [];
  for (const set of sets) {
    console.log(`  Listing cards in ${set.id} (${set.name})...`);
    const setData = await fetchJson(`${API}/sets/${set.id}`);
    for (const card of setData.cards ?? []) {
      cardIds.push(card.id);
    }
  }

  console.log(`Fetching details for ${cardIds.length} cards...`);
  let done = 0;
  const cards = await mapPool(
    cardIds,
    async (id) => {
      const card = await fetchCardDetails(id);
      done++;
      if (done % 100 === 0 || done === cardIds.length) {
        console.log(`  ${done}/${cardIds.length}`);
      }
      return card;
    },
    CONCURRENCY
  );

  cards.sort((a, b) => {
    const dexA = a.dexId ?? 99999;
    const dexB = b.dexId ?? 99999;
    if (dexA !== dexB) return dexA - dexB;
    if (a.expansionNumber !== b.expansionNumber) {
      return a.expansionNumber.localeCompare(b.expansionNumber);
    }
    return a.id.localeCompare(b.id);
  });

  const outPath = join(__dirname, "..", "data", "cards.json");
  writeFileSync(outPath, JSON.stringify(cards, null, 2));
  console.log(`Wrote ${cards.length} cards to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
