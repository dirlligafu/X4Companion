#!/usr/bin/env python
"""
generate_gates.py — Build catalog/gates.json from X4 game XML extractions.

Output structure:
  { "gates": [ { name, sector_macro, pos_x, pos_z, active, destination_sector_macro } ] }

Strategy (two passes):
  1. *sectors.xml  → zone index : { zone_macro → (sector_macro, offset_x, offset_z) }
  2. *zones.xml    → gates      : connection ref="gates", position = zone_offset + gate_offset
  3. Destination   → second pass matching ClusterGateXXXToYYY ↔ ClusterGateYYYToXXX

Usage:
  python scripts/catalog/generate_gates.py
  python scripts/catalog/generate_gates.py --xml C:/path/to/X4-Extractions --out path/to/out/
"""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\\OUTPUT")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")


def _layer_dirs(root: Path) -> list[Path]:
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


# ---------------------------------------------------------------------------
# Pass 1 — Zone index from *sectors.xml
# ---------------------------------------------------------------------------

def build_zone_index(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Returns { zone_macro: { sector_macro, offset_x, offset_z } }.
    Unions all layers — DLC sectors.xml add new zones.
    """
    index: dict[str, dict] = {}
    for layer_dir in layer_dirs:
        universe_dir = layer_dir / "maps" / "xu_ep2_universe"
        if not universe_dir.exists():
            continue
        for sectors_file in sorted(universe_dir.glob("*sectors.xml")):
            tree = ET.parse(sectors_file)
            for macro_el in tree.findall("macro"):
                if macro_el.get("class") != "sector":
                    continue
                sector_macro = macro_el.get("name")
                for conn in macro_el.findall("connections/connection"):
                    if conn.get("ref") != "zones":
                        continue
                    child = conn.find("macro")
                    if child is None:
                        continue
                    zone_macro = child.get("ref")
                    if not zone_macro:
                        continue
                    pos = conn.find("offset/position")
                    x = float(pos.get("x", 0)) if pos is not None else 0.0
                    z = float(pos.get("z", 0)) if pos is not None else 0.0
                    index[zone_macro] = {"sector_macro": sector_macro, "offset_x": x, "offset_z": z}
    return index


# ---------------------------------------------------------------------------
# Pass 2 — Gate extraction from *zones.xml
# ---------------------------------------------------------------------------

def extract_gates(layer_dirs: list[Path], zone_index: dict[str, dict]) -> list[dict]:
    """
    Returns list of gate dicts with absolute sector-relative positions.
    Deduplicates by connection name (vanilla defines all gates; DLCs add new ones).
    """
    gates: list[dict] = []
    seen: set[str] = set()

    for layer_dir in layer_dirs:
        universe_dir = layer_dir / "maps" / "xu_ep2_universe"
        if not universe_dir.exists():
            continue
        for zones_file in sorted(universe_dir.glob("*zones.xml")):
            tree = ET.parse(zones_file)
            for zone_el in tree.findall("macro"):
                if zone_el.get("class") != "zone":
                    continue
                zone_macro = zone_el.get("name")
                zone_info  = zone_index.get(zone_macro)
                if zone_info is None:
                    continue

                for conn in zone_el.findall("connections/connection"):
                    if conn.get("ref") != "gates":
                        continue
                    name = conn.get("name", "")
                    if not name or name in seen:
                        continue
                    seen.add(name)

                    pos   = conn.find("offset/position")
                    gate_x = float(pos.get("x", 0)) if pos is not None else 0.0
                    gate_z = float(pos.get("z", 0)) if pos is not None else 0.0

                    state      = conn.find(".//state")
                    active     = state is None or state.get("active", "true").lower() != "false"

                    gates.append({
                        "name":         name,
                        "sector_macro": zone_info["sector_macro"],
                        "pos_x":        round(zone_info["offset_x"] + gate_x, 4),
                        "pos_z":        round(zone_info["offset_z"] + gate_z, 4),
                        "active":       active,
                    })

    return gates


# ---------------------------------------------------------------------------
# Pass 3 — Destination resolution
# ---------------------------------------------------------------------------

_GATE_NAME_RE = re.compile(r"ClusterGate(\w+)To(\w+)", re.IGNORECASE)
_STRIP_SUFFIX  = re.compile(r"[a-z]+$", re.IGNORECASE)


def _norm(token: str) -> str:
    """Strip trailing letter suffix so '601b' and '601' match each other."""
    return _STRIP_SUFFIX.sub("", token).lower()


def resolve_destinations(gates: list[dict]) -> list[dict]:
    """
    Matches ClusterGateXXXToYYY ↔ ClusterGateYYYToXXX to set destination_sector_macro.
    Normalizes optional letter suffixes (e.g. '031To601b' ↔ '601To031').
    """
    key_to_sector: dict[str, str] = {}
    for g in gates:
        m = _GATE_NAME_RE.search(g["name"])
        if m:
            key = f"{_norm(m.group(1))}to{_norm(m.group(2))}"
            key_to_sector[key] = g["sector_macro"]

    for g in gates:
        m = _GATE_NAME_RE.search(g["name"])
        if m:
            reverse = f"{_norm(m.group(2))}to{_norm(m.group(1))}"
            g["destination_sector_macro"] = key_to_sector.get(reverse)
        else:
            g["destination_sector_macro"] = None

    return gates


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def generate(xml_root: Path, out_dir: Path) -> None:
    layer_dirs = _layer_dirs(xml_root)
    print(f"XML root : {xml_root}")
    print(f"Layers   : {[d.name for d in layer_dirs]}")
    print()

    print("[1/3] Building zone index from *sectors.xml...")
    zone_index = build_zone_index(layer_dirs)
    print(f"      {len(zone_index)} zones indexed.")

    print("[2/3] Extracting gates from *zones.xml...")
    gates = extract_gates(layer_dirs, zone_index)
    print(f"      {len(gates)} gates found.")

    print("[3/3] Resolving destinations...")
    gates = resolve_destinations(gates)
    resolved   = sum(1 for g in gates if g["destination_sector_macro"])
    inactive   = sum(1 for g in gates if not g["active"])
    unresolved = len(gates) - resolved
    print(f"      {resolved} resolved, {unresolved} unresolved, {inactive} inactive.")

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "gates.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"gates": gates}, f, ensure_ascii=False, indent=2)

    size_kb = out_path.stat().st_size / 1024
    print(f"\nWritten: {out_path}  ({size_kb:.1f} KB)")

    if unresolved:
        print(f"\nGates sans destination ({unresolved}) :")
        for g in gates:
            if g["destination_sector_macro"] is None:
                print(f"  {g['name']:<55}  secteur: {g['sector_macro']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate catalog/gates.json from X4 XML extractions.")
    parser.add_argument("--xml", default=str(DEFAULT_XML_ROOT), help="Path to extraction root")
    parser.add_argument("--out", default=str(DEFAULT_OUT_DIR),  help="Output directory")
    args = parser.parse_args()
    generate(Path(args.xml), Path(args.out))


if __name__ == "__main__":
    main()
