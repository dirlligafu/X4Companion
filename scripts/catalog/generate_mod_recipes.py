#!/usr/bin/env python
"""
generate_mod_recipes.py — Build catalog/mod_recipes.json from X4 game XML extractions.

Scans ALL numbered layer directories under --xml root for libraries/wares.xml.
Extracts every ware whose id starts with "mod_" (equipment mods) and collects:
  - crafting ingredients  (<primary> block)
  - research prerequisite (<research> block)

Also collects all modpart_xxx and research_mod_xxx ware names so the UI can
display human-readable labels without a separate lookup.

Usage:
  python scripts/catalog/generate_mod_recipes.py
  python scripts/catalog/generate_mod_recipes.py --xml C:/path/to/X4-Extractions --db path/to/x4_data.db --out path/to/out/

Extraction layout expected at --xml root:
  00_VANILLA/   01_SPLIT_VENDETTA/   02_CRADLE_OF_HUMANITY/  ...
DLC folders use Egosoft's <diff> format; only <add sel="..."> entries containing
<ware> elements are merged.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path


# ---------------------------------------------------------------------------
# Configuration — default paths
# ---------------------------------------------------------------------------

DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions")
DEFAULT_DB_PATH  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\x4_data.db")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")


def _layer_dirs(root: Path) -> list[Path]:
    """Returns numbered extraction subdirs (00_VANILLA, 01_SPLIT_VENDETTA, …) in order."""
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


# ---------------------------------------------------------------------------
# String resolution (copy of pattern used in generate_equipment.py)
# ---------------------------------------------------------------------------

def load_strings(db_path: Path) -> dict[tuple[int, int], str]:
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute("SELECT page, string_id, text FROM strings")
    result = {(row[0], row[1]): row[2] for row in cur.fetchall()}
    conn.close()
    return result


def _finalize(text: str | None) -> str | None:
    if text is None:
        return None
    return text.replace(r"\(", "(").replace(r"\)", ")")


def resolve(ref: str | None, strings: dict, _depth: int = 0) -> str | None:
    if not ref or _depth > 4:
        return None
    if not ref.startswith("{") and not ref.startswith("("):
        return _finalize(ref)

    text = ref
    hint = None
    if text.startswith("("):
        close = text.find("){")
        if close != -1:
            hint = text[1:close]
            text = text[close + 1:]
    if "{" not in text:
        return _finalize(hint or text)

    parts_out: list[str] = []
    remaining = text
    while remaining:
        start = remaining.find("{")
        if start == -1:
            parts_out.append(remaining)
            break
        if start > 0:
            parts_out.append(remaining[:start])
        end = remaining.find("}", start)
        if end == -1:
            break
        inner     = remaining[start + 1:end]
        remaining = remaining[end + 1:]
        p = inner.split(",")
        if len(p) == 2:
            try:
                page, sid = int(p[0].strip()), int(p[1].strip())
                raw = strings.get((page, sid))
                if raw:
                    resolved = resolve(raw, strings, _depth + 1)
                    parts_out.append(resolved or raw)
                elif hint:
                    return _finalize(hint)
            except ValueError:
                pass

    joined = " ".join(p.strip() for p in parts_out if p.strip())
    return _finalize(joined if joined else hint)


# ---------------------------------------------------------------------------
# Parse wares.xml across all layers
# ---------------------------------------------------------------------------

def _quality_from_id(ware_id: str) -> int:
    """Derive quality tier (1/2/3) from the ware id suffix _mk1/_mk2/_mk3."""
    m = re.search(r"_mk(\d)$", ware_id)
    if m:
        return int(m.group(1))
    return 0  # special/scenario mods without mk suffix


def _category_from_id(ware_id: str) -> str:
    """Derive category from ware id prefix: mod_{category}_..."""
    parts = ware_id.split("_")
    return parts[1] if len(parts) > 1 else "unknown"


def parse_wares(layer_dirs: list[Path]) -> tuple[dict[str, dict], dict[str, str]]:
    """
    Returns:
      mods     — dict keyed by ware id, containing mod recipe data
      name_refs — dict keyed by any ware id (modpart/research/mod) → raw name ref
    """
    mods: dict[str, dict] = {}
    name_refs: dict[str, str] = {}  # ware_id -> raw {page,id} name ref

    def _process_ware(el: ET.Element) -> None:
        ware_id = el.get("id", "")
        name_ref = el.get("name")
        if name_ref:
            name_refs[ware_id] = name_ref

        if ware_id.startswith("mod_"):
            tags = el.get("tags", "")
            ingredients: list[dict] = []
            research: str | None = None

            prod = el.find("production")
            if prod is not None:
                primary = prod.find("primary")
                if primary is not None:
                    for w in primary.findall("ware"):
                        ingredients.append({
                            "ware":   w.get("ware", ""),
                            "amount": int(w.get("amount", "1")),
                        })
                research_el = prod.find("research")
                if research_el is not None:
                    r_ware = research_el.find("ware")
                    if r_ware is not None:
                        research = r_ware.get("ware")

            mods[ware_id] = {
                "ware":               ware_id,
                "name_ref":           name_ref,
                "category":           _category_from_id(ware_id),
                "quality":            _quality_from_id(ware_id),
                "noplayerblueprint":  "noplayerblueprint" in tags,
                "ingredients":        ingredients,
                "research":           research,
            }

    for layer in layer_dirs:
        wares_xml = layer / "libraries" / "wares.xml"
        if not wares_xml.exists():
            continue

        tree = ET.parse(wares_xml)
        root = tree.getroot()

        if root.tag == "wares":
            # Vanilla / base layer — full file
            for ware in root.findall("ware"):
                _process_ware(ware)
        elif root.tag == "diff":
            # DLC patch — only process <add> blocks containing <ware> children
            for add in root.findall("add"):
                for ware in add.findall("ware"):
                    _process_ware(ware)

    return mods, name_refs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate mod_recipes.json")
    parser.add_argument("--xml", type=Path, default=DEFAULT_XML_ROOT)
    parser.add_argument("--db",  type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    layers = _layer_dirs(args.xml)
    print(f"Layers found: {[d.name for d in layers]}")

    print("Loading strings from DB…")
    strings = load_strings(args.db)

    print("Parsing wares.xml across all layers…")
    mods, name_refs = parse_wares(layers)
    print(f"  {len(mods)} mods found")

    # Collect all unique ingredient/research ware ids to expose their names
    ingredient_ids: set[str] = set()
    for m in mods.values():
        for ing in m["ingredients"]:
            ingredient_ids.add(ing["ware"])
        if m["research"]:
            ingredient_ids.add(m["research"])

    # Build ingredient name lookup
    ingredient_names: dict[str, str | None] = {
        wid: resolve(name_refs.get(wid), strings)
        for wid in sorted(ingredient_ids)
    }

    # Resolve mod names and assemble final output
    output_mods = []
    for ware_id, m in sorted(mods.items()):
        output_mods.append({
            "ware":              ware_id,
            "name":              resolve(m["name_ref"], strings),
            "category":          m["category"],
            "quality":           m["quality"],
            "noplayerblueprint": m["noplayerblueprint"],
            "ingredients": [
                {
                    "ware":   ing["ware"],
                    "amount": ing["amount"],
                    "name":   ingredient_names.get(ing["ware"]),
                }
                for ing in m["ingredients"]
            ],
            "research": m["research"],
        })

    output = {
        "mods": output_mods,
        "ingredient_names": ingredient_names,
    }

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "mod_recipes.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written: {out_path}  ({len(output_mods)} mods, {len(ingredient_names)} ingredient types)")


if __name__ == "__main__":
    main()
