#!/usr/bin/env python
"""
generate_stations.py — Build catalog/stations.json from X4 god.xml files.

Output structure:
  { "stations": [ { id, owner, type, sector_macro, pos_x, pos_z, dlc } ] }

Strategy:
  1. *sectors.xml  → zone index : { zone_macro → (sector_macro, offset_x, offset_z) }
  2. libraries/god.xml (per layer) → stations with type from inner <station><select tags>
     - location class="zone"   : pos = zone_offset + station_pos
     - location class="sector" : pos = station_pos (already sector-local)

Usage:
  python scripts/catalog/generate_stations.py
  python scripts/catalog/generate_stations.py --xml C:/path/to/X4-Extractions --out path/to/out/
"""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\\OUTPUT")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")

LAYER_DLC: dict[str, str] = {
    "00_VANILLA":            "base",
    "01_SPLIT_VENDETTA":     "split",
    "02_CRADLE_OF_HUMANITY": "terran",
    "03_TIDES_OF_AVARICE":   "pirate",
    "04_KINGDOM_END":        "boron",
    "05_TIMELINES":          "timelines",
    "06_HYPERION_PACK":      "mini01",
    "07_ENVOY_PACK":         "mini02",
}

_TAGS_RE    = re.compile(r"\[([^\]]+)\]")
_ZONE_RE    = re.compile(r"^zone\d+_(.+)$")  # zone001_cluster_14_sector001_macro → cluster_14_sector001_macro

TYPE_ICON: dict[str, str] = {
    "shipyard":     "mapob_shipyard.png",
    "wharf":        "mapob_wharf.png",
    "equipmentdock":"mapob_equipmentdock.png",
    "tradestation": "mapob_tradestation.png",
    "defence":      "mapob_defensestation.png",
    "piratebase":   "mapob_piratestation.png",
}


def _layer_dirs(root: Path) -> list[Path]:
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


def _dlc_for_layer(layer_dir: Path) -> str:
    return LAYER_DLC.get(layer_dir.name, layer_dir.name.lower())


# ---------------------------------------------------------------------------
# Pass 1 — Zone index (reused pattern from generate_gates.py)
# ---------------------------------------------------------------------------

def build_zone_index(layer_dirs: list[Path]) -> dict[str, dict]:
    """{ zone_macro → { sector_macro, offset_x, offset_z } }"""
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
                    index[zone_macro.lower()] = {"sector_macro": sector_macro, "offset_x": x, "offset_z": z}
    return index


# ---------------------------------------------------------------------------
# Pass 2 — Station extraction from god.xml files
# ---------------------------------------------------------------------------

def _parse_type(station_el: ET.Element) -> str | None:
    """Extract station type from inner <station><select tags="[type]">."""
    select = station_el.find("station/select")
    if select is None:
        return None
    tags_raw = select.get("tags", "")
    m = _TAGS_RE.search(tags_raw)
    if not m:
        return None
    # tags can be "[shipyard]" or "[shipyard headquarter]" — take first token
    return m.group(1).split()[0]


def extract_stations(layer_dirs: list[Path], zone_index: dict[str, dict]) -> list[dict]:
    stations: list[dict] = []
    seen: set[str] = set()

    for layer_dir in layer_dirs:
        god_file = layer_dir / "libraries" / "god.xml"
        if not god_file.exists():
            continue
        dlc = _dlc_for_layer(layer_dir)

        tree = ET.parse(god_file)
        root = tree.getroot()
        # Vanilla: <god><stations> — DLC: <diff><add sel="/god/stations">
        stations_el = root.find("stations")
        if stations_el is None:
            for add_el in root.findall("add"):
                if add_el.get("sel") == "/god/stations":
                    stations_el = add_el
                    break
        if stations_el is None:
            continue

        for st in stations_el.findall("station"):
            station_id = st.get("id")
            if not station_id or station_id in seen:
                continue
            seen.add(station_id)

            owner = st.get("owner")
            if not owner:
                continue

            st_type = _parse_type(st)
            if not st_type or st_type not in TYPE_ICON:
                continue

            loc = st.find("location")
            if loc is None:
                continue
            loc_class = loc.get("class", "")
            loc_macro = loc.get("macro", "")

            pos_el = st.find("position")
            local_x = float(pos_el.get("x", 0)) if pos_el is not None else 0.0
            local_z = float(pos_el.get("z", 0)) if pos_el is not None else 0.0

            if loc_class == "zone":
                zone_info = zone_index.get(loc_macro.lower())
                if zone_info is not None:
                    sector_macro = zone_info["sector_macro"]
                    pos_x = round(zone_info["offset_x"] + local_x, 3)
                    pos_z = round(zone_info["offset_z"] + local_z, 3)
                else:
                    # Implicit zones (e.g. zone001_cluster_14_sector001_macro) are not listed in
                    # sectors.xml — derive the sector macro from the zone name directly.
                    m = _ZONE_RE.match(loc_macro)
                    if not m:
                        continue
                    sector_macro = m.group(1)
                    pos_x = round(local_x, 3)
                    pos_z = round(local_z, 3)
            elif loc_class == "sector":
                sector_macro = loc_macro
                pos_x = round(local_x, 3)
                pos_z = round(local_z, 3)
            else:
                continue  # cluster-level or unknown — skip

            stations.append({
                "id":           station_id,
                "owner":        owner,
                "type":         st_type,
                "icon":         TYPE_ICON[st_type],
                "sector_macro": sector_macro,
                "pos_x":        pos_x,
                "pos_z":        pos_z,
                "dlc":          dlc,
            })

    return stations


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def generate(xml_root: Path, out_dir: Path) -> None:
    layer_dirs = _layer_dirs(xml_root)
    print(f"XML root : {xml_root}")
    print(f"Layers   : {[d.name for d in layer_dirs]}")
    print()

    print("[1/2] Building zone index from *sectors.xml...")
    zone_index = build_zone_index(layer_dirs)
    print(f"      {len(zone_index)} zones indexed.")

    print("[2/2] Extracting stations from god.xml files...")
    stations = extract_stations(layer_dirs, zone_index)

    by_type: dict[str, int] = {}
    for s in stations:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1
    print(f"      {len(stations)} stations extracted.")
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"        {t:<25} {n}")

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "stations.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"stations": stations}, f, ensure_ascii=False, indent=2)

    size_kb = out_path.stat().st_size / 1024
    print(f"\nWritten: {out_path}  ({size_kb:.1f} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate catalog/stations.json from X4 god.xml files.")
    parser.add_argument("--xml", default=str(DEFAULT_XML_ROOT), help="Path to extraction root")
    parser.add_argument("--out", default=str(DEFAULT_OUT_DIR),  help="Output directory")
    args = parser.parse_args()
    generate(Path(args.xml), Path(args.out))


if __name__ == "__main__":
    main()
