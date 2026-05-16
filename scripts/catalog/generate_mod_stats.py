#!/usr/bin/env python
"""
generate_mod_stats.py — Build catalog/mod_stats.json from X4 game XML extractions.

Reads libraries/equipmentmods.xml across all numbered layer directories and
extracts equipment mod stat definitions (category, stat, min/max, bonuses).
Ware names are resolved via libraries/wares.xml + the SQLite strings table.

Usage:
  python scripts/catalog/generate_mod_stats.py
  python scripts/catalog/generate_mod_stats.py --xml C:/path/to/X4-Extractions/OUTPUT --db path/to/x4_data.db --out path/to/out/

Extraction layout expected at --xml root:
  00_VANILLA/   01_SPLIT_VENDETTA/   02_CRADLE_OF_HUMANITY/  ...
DLC folders use Egosoft's <diff> format; only <add sel="..."> entries are merged.
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

REPO_ROOT        = Path(__file__).resolve().parents[2]
DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\OUTPUT")
DEFAULT_DB_PATH  = REPO_ROOT / "src-tauri" / "resources" / "x4_data.db"
DEFAULT_OUT_DIR  = REPO_ROOT / "src-tauri" / "resources" / "catalog"


def _layer_dirs(root: Path) -> list[Path]:
    """Returns numbered extraction subdirs (00_VANILLA, 01_SPLIT_VENDETTA, …) in order."""
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


# ---------------------------------------------------------------------------
# String resolution (same pattern as generate_equipment.py / generate_mod_recipes.py)
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
# Load ware name refs from wares.xml
# ---------------------------------------------------------------------------

def load_name_refs(layer_dirs: list[Path]) -> dict[str, str]:
    """Returns ware_id -> raw name ref string for all mod_* wares across all layers."""
    name_refs: dict[str, str] = {}

    def _collect(el: ET.Element) -> None:
        ware_id = el.get("id", "")
        if ware_id.startswith("mod_"):
            name_ref = el.get("name")
            if name_ref:
                name_refs[ware_id] = name_ref

    for layer in layer_dirs:
        wares_xml = layer / "libraries" / "wares.xml"
        if not wares_xml.exists():
            continue
        tree = ET.parse(wares_xml)
        root = tree.getroot()
        if root.tag == "wares":
            for ware in root.findall("ware"):
                _collect(ware)
        elif root.tag == "diff":
            for add in root.findall("add"):
                for ware in add.findall("ware"):
                    _collect(ware)

    return name_refs


# ---------------------------------------------------------------------------
# Parse equipmentmods.xml across all layers
# ---------------------------------------------------------------------------

def _parse_stat_el(stat_el: ET.Element, category: str) -> dict | None:
    """Parse one stat element into a raw mod entry dict (name not yet resolved)."""
    ware = stat_el.get("ware")
    if not ware:
        return None
    quality_str = stat_el.get("quality")
    min_str     = stat_el.get("min")
    max_str     = stat_el.get("max")
    if quality_str is None or min_str is None or max_str is None:
        return None

    bonuses: list[dict] = []
    for bonus_el in stat_el.findall("bonus"):
        chance    = float(bonus_el.get("chance", "1.0"))
        max_count = int(bonus_el.get("max", "1"))
        for child in bonus_el:
            if child.get("min") is None:
                continue
            bonuses.append({
                "stat":      child.tag,
                "min":       float(child.get("min", "0")),
                "max":       float(child.get("max", "0")),
                "chance":    chance,
                "max_count": max_count,
            })

    return {
        "ware":     ware,
        "category": category,
        "stat":     stat_el.tag,
        "quality":  int(quality_str),
        "min":      float(min_str),
        "max":      float(max_str),
        "bonuses":  bonuses if bonuses else None,
    }


def parse_equipmentmods(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Parse equipmentmods.xml across all layers.
    Returns dict keyed by ware id; later layers overwrite earlier entries.
    """
    entries: dict[str, dict] = {}

    for layer in layer_dirs:
        xml_path = layer / "libraries" / "equipmentmods.xml"
        if not xml_path.exists():
            continue

        tree = ET.parse(xml_path)
        root = tree.getroot()

        if root.tag == "equipmentmods":
            for category_el in root:
                category = category_el.tag
                for stat_el in category_el:
                    entry = _parse_stat_el(stat_el, category)
                    if entry:
                        entries[entry["ware"]] = entry

        elif root.tag == "diff":
            for add_el in root.findall("add"):
                sel = add_el.get("sel", "")
                m = re.match(r"/equipmentmods/(\w+)", sel)
                if not m:
                    continue
                category = m.group(1)
                for stat_el in add_el:
                    entry = _parse_stat_el(stat_el, category)
                    if entry:
                        entries[entry["ware"]] = entry

    return entries


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate mod_stats.json from X4 XML extractions")
    parser.add_argument("--xml", type=Path, default=DEFAULT_XML_ROOT)
    parser.add_argument("--db",  type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    layers = _layer_dirs(args.xml)
    print(f"Layers found: {[d.name for d in layers]}")

    print("Loading strings from DB...")
    strings = load_strings(args.db)

    print("Loading ware name refs from wares.xml...")
    name_refs = load_name_refs(layers)
    print(f"  {len(name_refs)} mod ware name refs found")

    print("Parsing equipmentmods.xml across all layers...")
    raw_entries = parse_equipmentmods(layers)
    print(f"  {len(raw_entries)} mod stat entries found")

    output = []
    for entry in sorted(raw_entries.values(), key=lambda e: (e["category"], e["stat"], e["quality"], e["ware"])):
        output.append({
            "ware":     entry["ware"],
            "name":     resolve(name_refs.get(entry["ware"]), strings),
            "category": entry["category"],
            "stat":     entry["stat"],
            "quality":  entry["quality"],
            "min":      entry["min"],
            "max":      entry["max"],
            "bonuses":  entry["bonuses"],
        })

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "mod_stats.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK {len(output)} entries written to {out_path}")


if __name__ == "__main__":
    main()
