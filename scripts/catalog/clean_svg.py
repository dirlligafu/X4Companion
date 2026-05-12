#!/usr/bin/env python
"""
clean_svg.py — Supprime les hexagones sans cluster correspondant du SVG de base.

Lit sectors.json pour construire l'ensemble des IDs valides (X_{gx}_Z_{gz*2}),
puis supprime du SVG tous les <path> dont l'ID ne figure pas dans cet ensemble.
Les layers (<g>) qui deviennent vides sont aussi supprimés.

Usage:
  python scripts/catalog/clean_svg.py
"""
from __future__ import annotations

import json
from pathlib import Path

from lxml import etree

SVG_IN  = Path(r"C:\DEVS\REACT\X4\_BASE_DOCS\LOGOS_AND_MAPS\x4_full_base_map.svg")
SVG_OUT = Path(r"C:\DEVS\REACT\X4\_BASE_DOCS\LOGOS_AND_MAPS\x4_full_base_map_clean.svg")
JSON_IN = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog\sectors.json")


def build_valid_ids(json_path: Path) -> set[str]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    ids: set[str] = set()
    for cluster in data["clusters"]:
        gx = int(cluster["grid_x"])
        gz = int(cluster["grid_z"] * 2)
        ids.add(f"X_{gx}_Z_{gz}")
    return ids


def clean(svg_in: Path, svg_out: Path, valid_ids: set[str]) -> None:
    tree   = etree.parse(svg_in)
    root   = tree.getroot()

    removed_hexes  = 0
    removed_layers = 0

    for layer in list(root):
        tag = etree.QName(layer.tag).localname
        if tag != "g":
            continue
        for path in list(layer):
            path_id = path.get("id", "")
            if path_id.startswith("X_") and path_id not in valid_ids:
                layer.remove(path)
                removed_hexes += 1
        if len(layer) == 0:
            root.remove(layer)
            removed_layers += 1

    tree.write(svg_out, pretty_print=True, xml_declaration=True, encoding="UTF-8")

    size_in  = svg_in.stat().st_size  / 1024
    size_out = svg_out.stat().st_size / 1024
    print(f"Input  : {svg_in.name}  ({size_in:.0f} KB)")
    print(f"Output : {svg_out.name}  ({size_out:.0f} KB)  (-{size_in - size_out:.0f} KB)")
    print(f"Hexagones supprimés : {removed_hexes}")
    print(f"Layers vides supprimés : {removed_layers}")
    print(f"Hexagones conservés : {len(valid_ids)}")


if __name__ == "__main__":
    valid_ids = build_valid_ids(JSON_IN)
    print(f"IDs valides depuis sectors.json : {len(valid_ids)}")
    clean(SVG_IN, SVG_OUT, valid_ids)
