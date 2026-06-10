#!/usr/bin/env python3
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API = "https://api.tcgdex.net/v2/en"
CONCURRENCY = 20
OUT = Path(__file__).resolve().parent.parent / "data" / "cards.json"


def fetch_json(url: str):
    with urllib.request.urlopen(url) as res:
        return json.load(res)


def extract_modifier(card: dict) -> str:
    name = card.get("name", "")
    if re.search(r"mega\s+.+\s+ex", name, re.I):
        return "Mega ex"
    if card.get("suffix") == "EX" or re.search(r"\s+ex$", name, re.I):
        return "ex"
    return ""


def extract_damage(card: dict) -> str:
    attacks = card.get("attacks") or []
    values = [str(a["damage"]) for a in attacks if a.get("damage") is not None]
    return " / ".join(values)


def extract_card_type(card: dict) -> str:
    if card.get("types"):
        return "/".join(card["types"])
    if card.get("trainerType"):
        return card["trainerType"]
    return card.get("category", "")


def normalize_card(raw: dict) -> dict:
    dex_id = (raw.get("dexId") or [None])[0]
    return {
        "id": raw.get("id", ""),
        "expansionNumber": (raw.get("set") or {}).get("id", ""),
        "cardName": raw.get("name", ""),
        "expansionName": (raw.get("set") or {}).get("name", ""),
        "cardType": extract_card_type(raw),
        "hp": raw.get("hp", ""),
        "damage": extract_damage(raw),
        "stage": raw.get("stage", ""),
        "specialModifier": extract_modifier(raw),
        "rarity": raw.get("rarity", ""),
        "dexId": dex_id,
        "category": raw.get("category", ""),
    }


def main():
    print("Fetching TCG Pocket series...")
    series = fetch_json(f"{API}/series/tcgp")
    sets = series.get("sets", [])
    print(f"Found {len(sets)} sets")

    card_ids = []
    for s in sets:
        print(f"  Listing cards in {s['id']} ({s['name']})...")
        set_data = fetch_json(f"{API}/sets/{s['id']}")
        card_ids.extend(c["id"] for c in set_data.get("cards", []))

    print(f"Fetching details for {len(card_ids)} cards...")

    cards = [None] * len(card_ids)
    done = 0

    def fetch_one(index_id):
        index, card_id = index_id
        raw = fetch_json(f"{API}/cards/{card_id}")
        return index, normalize_card(raw)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = [pool.submit(fetch_one, (i, cid)) for i, cid in enumerate(card_ids)]
        for future in as_completed(futures):
            index, card = future.result()
            cards[index] = card
            done += 1
            if done % 100 == 0 or done == len(card_ids):
                print(f"  {done}/{len(card_ids)}")

    cards.sort(
        key=lambda c: (
            c["dexId"] if c["dexId"] is not None else 99999,
            c["expansionNumber"],
            c["id"],
        )
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cards, indent=2), encoding="utf-8")
    print(f"Wrote {len(cards)} cards to {OUT}")


if __name__ == "__main__":
    main()
