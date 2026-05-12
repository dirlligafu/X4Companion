#!/usr/bin/env python
"""
analyze_sector_regions.py — Audit des régions de niveau secteur dans region_definitions.xml.

Extrait toutes les régions nommées "region_cluster_XX_sector_YYY" (sans suffixe _a, _b…)
à travers tous les layers DLC, et compare avec le nombre de secteurs dans sectors.xml.

Usage:
  python scripts/catalog/analyze_sector_regions.py
  python scripts/catalog/analyze_sector_regions.py --xml C:/path/to/X4-Extractions
"""
from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\\OUTPUT")

# region_cluster_09_sector_001  → OK
# region_cluster_09_sector_001_a / _nebula_1 / _asteroids_2  → ignoré
SECTOR_REGION_RE = re.compile(r"^region_cluster_(\d+)_sector_(\d+)$", re.IGNORECASE)


def _layer_dirs(root: Path) -> list[Path]:
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


def parse_boundary(region_el: ET.Element) -> tuple[str, float | None, float | None] | None:
    """Retourne (class, r, linear) ou None si pas de boundary."""
    b = region_el.find("boundary")
    if b is None:
        return None
    cls = b.get("class", "?")
    size = b.find("size")
    if size is None:
        return (cls, None, None)
    r      = size.get("r")
    linear = size.get("linear")
    return (cls, float(r) if r else None, float(linear) if linear else None)


def run(xml_root: Path) -> None:
    layer_dirs = _layer_dirs(xml_root)
    print(f"XML root : {xml_root}")
    print(f"Layers   : {[d.name for d in layer_dirs]}")
    print()

    # --- Collecte des régions secteur ---
    rows: list[dict] = []
    seen: set[str] = set()  # déduplique si un DLC redefinirait la même région

    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "region_definitions.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        for region in tree.findall("region"):
            name = region.get("name", "")
            if not SECTOR_REGION_RE.match(name):
                continue
            if name in seen:
                continue
            seen.add(name)
            boundary = parse_boundary(region)
            rows.append({"source": layer_dir.name, "name": name, "boundary": boundary})

    # --- Affichage ---
    col_src  = max(len(r["source"]) for r in rows) + 2 if rows else 20
    col_name = max(len(r["name"])   for r in rows) + 2 if rows else 45

    header = f"{'SOURCE':<{col_src}} {'NOM RÉGION':<{col_name}} {'TYPE':<12} {'r (m)':<12} {'linear (m)'}"
    print(header)
    print("-" * len(header))

    for r in sorted(rows, key=lambda x: x["name"]):
        b = r["boundary"]
        if b:
            cls, radius, linear = b
            print(f"{r['source']:<{col_src}} {r['name']:<{col_name}} {cls:<12} {str(int(radius)) if radius else '?':<12} {int(linear) if linear else ''}")
        else:
            print(f"{r['source']:<{col_src}} {r['name']:<{col_name}} (no boundary)")

    print()
    print(f"Régions secteur trouvées (toutes sources) : {len(rows)}")

    # --- Comparaison avec sectors.xml vanilla ---
    sectors_xml = xml_root / "00_VANILLA" / "maps" / "xu_ep2_universe" / "sectors.xml"
    if not sectors_xml.exists():
        print(f"sectors.xml introuvable : {sectors_xml}")
        return

    tree = ET.parse(sectors_xml)
    sector_macros = [m.get("name") for m in tree.findall("macro") if m.get("class") == "sector"]
    print(f"Secteurs dans sectors.xml vanilla          : {len(sector_macros)}")
    print()

    # Génère le nom de région attendu pour chaque macro vanilla
    region_names = {r["name"].lower() for r in rows}
    missing: list[tuple[str, str]] = []
    for macro in sector_macros:
        m = re.match(r"Cluster_(\d+)_Sector(\d+)_macro", macro, re.IGNORECASE)
        if m:
            expected = f"region_cluster_{int(m.group(1)):02d}_sector_{int(m.group(2)):03d}"
            if expected not in region_names:
                missing.append((macro, expected))

    if missing:
        print(f"Secteurs vanilla SANS région ({len(missing)}) :")
        for macro, expected in missing:
            print(f"  {macro:<45}  attendu : {expected}")
    else:
        print("Tous les secteurs vanilla ont une région définie. ✓")

    # --- Distribution des types et tailles ---
    print()
    print("Distribution des boundary :")
    from collections import Counter
    type_counts: Counter = Counter()
    radius_counts: Counter = Counter()
    for r in rows:
        b = r["boundary"]
        if b:
            cls, radius, _ = b
            type_counts[cls] += 1
            if radius:
                radius_counts[int(radius)] += 1
        else:
            type_counts["(none)"] += 1

    for cls, count in type_counts.most_common():
        print(f"  {cls:<12} : {count}")
    print()
    print("Distribution des rayons r :")
    for radius, count in sorted(radius_counts.items()):
        print(f"  r = {radius:>10} m  ({radius/1000:.0f} km)  : {count} secteur(s)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit des régions secteur dans region_definitions.xml")
    parser.add_argument("--xml", default=str(DEFAULT_XML_ROOT), help="Chemin vers le dossier d'extractions")
    args = parser.parse_args()
    run(Path(args.xml))


if __name__ == "__main__":
    main()
