#!/usr/bin/env python
"""
extract_faction_colors.py — Extract faction RGBA colors from X4 colors.xml.

Reads faction_* mappings, resolves their color refs, and outputs a JSON with
RGBA values + computed HEX (R,G,B only — alpha ignored for web colors).

Usage:
  python scripts/catalog/extract_faction_colors.py
  python scripts/catalog/extract_faction_colors.py --xml C:/path/to/colors.xml --out faction_colors.json
"""
from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_XML = Path(r"C:\DEVS\REACT\X4-Extractions\00_VANILLA\libraries\colors.xml")
DEFAULT_OUT = Path(r"C:\DEVS\REACT\X4\scripts\catalog\faction_colors.json")


def run(xml_path: Path, out_path: Path) -> None:
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # Build color lookup: id -> {r, g, b, a, glow}
    colors: dict[str, dict] = {}
    for el in root.findall("colors/color"):
        cid = el.get("id")
        if cid:
            colors[cid] = {
                "r":    int(el.get("r", 0)),
                "g":    int(el.get("g", 0)),
                "b":    int(el.get("b", 0)),
                "a":    int(el.get("a", 255)),
                "glow": float(el.get("glow", 0.0)),
            }

    # Extract faction_* mappings
    result: dict[str, dict] = {}
    for el in root.findall("mappings/mapping"):
        mid = el.get("id", "")
        if not mid.startswith("faction_"):
            continue
        faction = mid[len("faction_"):]
        ref = el.get("ref", "")
        c = colors.get(ref)
        if c is None:
            print(f"  WARNING: color ref '{ref}' not found for {mid}")
            continue
        hex_rgb = f"#{c['r']:02X}{c['g']:02X}{c['b']:02X}"
        result[faction] = {
            "ref":  ref,
            "r":    c["r"],
            "g":    c["g"],
            "b":    c["b"],
            "a":    c["a"],
            "glow": c["glow"],
            "hex":  hex_rgb,
        }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Extracted {len(result)} factions -> {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xml", default=str(DEFAULT_XML))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    run(Path(args.xml), Path(args.out))


if __name__ == "__main__":
    main()
