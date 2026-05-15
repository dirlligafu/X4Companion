#!/usr/bin/env python
"""
generate_research.py — Build catalog/research.json from X4 game XML extractions.

Scans ALL numbered layer directories under --xml root for libraries/wares.xml.
Extracts every ware whose id starts with "research_" and collects:
  - resolved name and description
  - research time (seconds)
  - tags (hidden, missiononly, nocustomgamestart)
  - prerequisites  (<research><research> block — other research wares required)
  - materials      (<research><primary> block — wares consumed to conduct research)
  - source DLC     (derived from the layer directory name)

DLC folders use Egosoft's <diff> format; only <add sel="..."> entries are merged.
Layers with no research_ entries are silently skipped.

Usage:
  python scripts/catalog/generate_research.py
  python scripts/catalog/generate_research.py --xml C:/path/to/X4-Extractions --db path/to/x4_data.db --out path/to/out/
"""
from __future__ import annotations

import argparse
import json
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


def _dlc_name(layer: Path) -> str:
    """Derive a short DLC key from the directory name, e.g. '03_TIDES_OF_AVARICE' → 'tides_of_avarice'."""
    parts = layer.name.split("_", 1)
    return parts[1].lower() if len(parts) > 1 else layer.name.lower()


# ---------------------------------------------------------------------------
# String resolution (same pattern as generate_mod_recipes.py)
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

def parse_research(layer_dirs: list[Path], strings: dict) -> list[dict]:
    """
    Returns a list of research entry dicts, in layer order (vanilla first, then DLCs).
    Entries from later layers that share an id override earlier ones.
    """
    entries: dict[str, dict] = {}  # id → entry, preserves last-seen wins (DLC overrides vanilla)

    for layer in layer_dirs:
        wares_xml = layer / "libraries" / "wares.xml"
        if not wares_xml.exists():
            continue

        tree = ET.parse(wares_xml)
        root = tree.getroot()
        dlc  = _dlc_name(layer)

        def _process_ware(el: ET.Element) -> None:
            ware_id = el.get("id", "")
            if not ware_id.startswith("research_"):
                return

            tags_str  = el.get("tags", "")
            tags      = set(tags_str.split())
            name_ref  = el.get("name")
            desc_ref  = el.get("description")
            sortorder = el.get("sortorder")

            research_el   = el.find("research")
            time          = int(research_el.get("time", "0")) if research_el is not None else 0
            prerequisites: list[str] = []
            materials: list[dict]    = []

            if research_el is not None:
                prereq_block = research_el.find("research")
                if prereq_block is not None:
                    for w in prereq_block.findall("ware"):
                        wref = w.get("ware")
                        if wref:
                            prerequisites.append(wref)

                primary_block = research_el.find("primary")
                if primary_block is not None:
                    for w in primary_block.findall("ware"):
                        wref   = w.get("ware", "")
                        amount = int(w.get("amount", "1"))
                        materials.append({"ware": wref, "amount": amount})

            entries[ware_id] = {
                "id":            ware_id,
                "name":          resolve(name_ref, strings),
                "description":   resolve(desc_ref, strings),
                "time":          time,
                "sortorder":     int(sortorder) if sortorder else None,
                "hidden":        "hidden" in tags,
                "missiononly":   "missiononly" in tags,
                "nocustomgamestart": "nocustomgamestart" in tags,
                "dlc":           dlc,
                "prerequisites": prerequisites,
                "materials":     materials,
            }

        if root.tag == "wares":
            for ware in root.findall("ware"):
                _process_ware(ware)
        elif root.tag == "diff":
            for add in root.findall("add"):
                for ware in add.findall("ware"):
                    _process_ware(ware)

        layer_count = sum(1 for e in entries.values() if e["dlc"] == dlc)
        if layer_count:
            print(f"  {layer.name}: {layer_count} research entries")

    return list(entries.values())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate research.json")
    parser.add_argument("--xml", type=Path, default=DEFAULT_XML_ROOT)
    parser.add_argument("--db",  type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    layers = _layer_dirs(args.xml)
    print(f"Layers found: {[d.name for d in layers]}")

    print("Loading strings from DB…")
    strings = load_strings(args.db)

    print("Parsing research wares across all layers…")
    research = parse_research(layers, strings)
    print(f"  {len(research)} research entries total")

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "research.json"
    out_path.write_text(json.dumps(research, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
