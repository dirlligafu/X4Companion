#!/usr/bin/env python
"""
generate_sectors.py — Build catalog/sectors.json from X4 game XML extractions.

Output structure:
  { "clusters": [ { macro, name, dlc, grid_x, grid_z, faction, sectors: [...] } ] }

Each cluster entry contains:
  - Resolved name, DLC tag, grid position (hex grid coordinates)
  - faction: dominant faction derived from god.xml station ownership
  - sectors: list of { macro, name, dlc, description, pos_x, pos_z,
                       sunlight, economy, security, faction, resources }

Sources (all layers 00_VANILLA → 07_ENVOY_PACK):
  maps/xu_ep2_universe/galaxy.xml          → cluster positions (vanilla full + DLC diffs)
  maps/xu_ep2_universe/*_clusters.xml      → cluster→sector links + region refs
  libraries/mapdefaults.xml                → names, descriptions, sunlight, economy, security
  libraries/region_definitions.xml         → region name → {ware: yield_name}
  libraries/god.xml                        → station ownership → sector/cluster faction

Usage:
  python scripts/catalog/generate_sectors.py
  python scripts/catalog/generate_sectors.py --xml C:/path/to/X4-Extractions --db path/to/x4_data.db --out path/to/out/
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\\OUTPUT")
DEFAULT_DB_PATH  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\x4_data.db")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")

GRID_X_DIV = 15_000_000.0
GRID_Z_DIV = 17_320_000.0

RESOURCE_WARES = ["ore", "silicon", "ice", "hydrogen", "helium", "nividium", "methane", "rawscrap"]

# region_cluster_09_sector_001  → secteur entier
# region_cluster_09_sector_001_a / _nebula_1  → sous-région de contenu, ignorée
_SECTOR_REGION_RE = re.compile(r"^region_cluster_(\d+)_sector_(\d+)$", re.IGNORECASE)

# Ordered from lowest to highest (derived from regionyields.xml, same for all wares)
YIELD_ORDER = [
    "lowest", "verylow", "lowminus", "low", "lowplus", "lowextra",
    "medlow", "medium", "medplus", "medhigh", "highlow",
    "high", "highplus", "veryhigh", "highest",
]
YIELD_RANK = {name: i for i, name in enumerate(YIELD_ORDER)}


def _layer_dirs(root: Path) -> list[Path]:
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


def _macro_to_region_name(macro: str) -> str | None:
    """Cluster_09_Sector001_macro → region_cluster_09_sector_001"""
    m = re.match(r"Cluster_(\d+)_Sector(\d+)_macro", macro, re.IGNORECASE)
    if not m:
        return None
    return f"region_cluster_{int(m.group(1)):02d}_sector_{int(m.group(2)):03d}"


# Timelines clusters added to the base game in updates v7.0, v7.5, v8.0
_BASE_GAME_OVERRIDES = {
    "Cluster_709_macro", "Cluster_710_macro", "Cluster_711_macro",
    "Cluster_712_macro", "Cluster_713_macro", "Cluster_714_macro",
    "Cluster_715_macro", "Cluster_720_macro", "Cluster_721_macro",
    "Cluster_722_macro", "Cluster_723_macro", "Cluster_724_macro",
    "Cluster_725_macro",
}


def cluster_dlc(macro: str) -> str:
    """Derive DLC tag from cluster macro number."""
    if macro in _BASE_GAME_OVERRIDES:
        return "base"
    m = re.search(r"Cluster_(\d+)_", macro, re.I)
    if not m:
        return "base"
    n = int(m.group(1))
    if 1   <= n <= 99:  return "base"
    if 100 <= n <= 199: return "terran"
    if 400 <= n <= 499: return "split"
    if 500 <= n <= 599: return "pirate"
    if 600 <= n <= 699: return "boron"
    if n == 730:        return "mini01"
    if n == 740:        return "mini02"
    if 700 <= n <= 799: return "timelines"
    return "base"


# ---------------------------------------------------------------------------
# Step 1 — Strings
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
    s = text.replace(r"\(", "(").replace(r"\)", ")")
    s = re.sub(r"\((?:extra\s+large|xlarge)\)XL", "XL", s, flags=re.IGNORECASE)
    s = re.sub(r"\(large\)L",  "L",  s, flags=re.IGNORECASE)
    s = re.sub(r"\(medium\)M", "M",  s, flags=re.IGNORECASE)
    s = re.sub(r"\(small\)S",  "S",  s, flags=re.IGNORECASE)
    # Strip X4 fallback hint annotations: {ref}(hint) — the (hint) is never part of the display name
    s = re.sub(r"\s*\([^)]+\)", "", s).strip()
    return s if s else None


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

    result_parts = []
    remaining = text
    while remaining:
        start = remaining.find("{")
        if start == -1:
            result_parts.append(remaining)
            break
        if start > 0:
            result_parts.append(remaining[:start])
        end = remaining.find("}", start)
        if end == -1:
            break
        inner     = remaining[start + 1:end]
        remaining = remaining[end + 1:]
        parts = inner.split(",")
        if len(parts) == 2:
            try:
                page, sid  = int(parts[0].strip()), int(parts[1].strip())
                raw_string = strings.get((page, sid))
                if raw_string:
                    resolved = resolve(raw_string, strings, _depth + 1)
                    result_parts.append(resolved or raw_string)
                elif hint:
                    return _finalize(hint)
            except ValueError:
                pass

    joined = " ".join(p.strip() for p in result_parts if p.strip())
    return _finalize(joined if joined else hint)


# ---------------------------------------------------------------------------
# Step 2 — Region definitions index: region_name → {ware: yield_name}
# ---------------------------------------------------------------------------

def load_region_index(layer_dirs: list[Path]) -> dict[str, dict[str, str]]:
    """
    Returns { region_name: { ware: yield_name } }.
    Unions all layers (DLCs add new region_definitions.xml files).
    """
    index: dict[str, dict[str, str]] = {}
    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "region_definitions.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        for region in tree.findall("region"):
            name = region.get("name")
            if not name:
                continue
            resources: dict[str, str] = {}
            for res in region.findall(".//resource"):
                ware  = res.get("ware")
                yield_ = res.get("yield")
                if ware and yield_:
                    resources[ware] = yield_
            if resources:
                index[name] = resources
    return index


# ---------------------------------------------------------------------------
# Step 3 — Sector boundaries: region_cluster_XX_sector_YYY → shape + dimensions
# ---------------------------------------------------------------------------

def load_sector_boundaries(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Returns { region_name: { shape, r, linear } } for sector-wide regions only.
    Unions all layers; last definition wins (DLC can override vanilla).
    """
    index: dict[str, dict] = {}
    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "region_definitions.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        for region in tree.findall("region"):
            name = region.get("name", "")
            if not _SECTOR_REGION_RE.match(name):
                continue
            b = region.find("boundary")
            if b is None:
                index[name] = {"shape": None, "r": None, "linear": None}
                continue
            shape = b.get("class")
            size  = b.find("size")
            r      = float(size.get("r"))      if size is not None and size.get("r")      else None
            linear = float(size.get("linear")) if size is not None and size.get("linear") else None
            index[name] = {"shape": shape, "r": r, "linear": linear}
    return index


# ---------------------------------------------------------------------------
# Step 4 — Mapdefaults: cluster/sector names + area stats
# ---------------------------------------------------------------------------

def load_mapdefaults(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Returns { macro: { name_ref, sunlight, economy, security } }.
    Unions all layers — DLC mapdefaults.xml are full files (not diffs).
    """
    meta: dict[str, dict] = {}
    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "mapdefaults.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        for ds in tree.findall(".//dataset"):
            macro = ds.get("macro")
            if not macro:
                continue
            props = ds.find("properties")
            if props is None:
                continue
            entry: dict[str, Any] = {}
            ident = props.find("identification")
            if ident is not None:
                entry["name_ref"]        = ident.get("name")
                entry["description_ref"] = ident.get("description")
            area = props.find("area")
            if area is not None:
                for attr in ("sunlight", "economy", "security"):
                    v = area.get(attr)
                    if v is not None:
                        try:
                            entry[attr] = float(v)
                        except ValueError:
                            pass
            meta[macro.lower()] = entry
    return meta


# ---------------------------------------------------------------------------
# Step 5 — Galaxy: cluster positions from galaxy.xml (vanilla + DLC diffs)
# ---------------------------------------------------------------------------

def load_cluster_positions(layer_dirs: list[Path]) -> dict[str, tuple[float, float]]:
    """
    Returns { cluster_macro: (raw_x, raw_z) }.
    Cluster_01 has no <offset> in vanilla (it's the implicit origin → 0, 0).
    DLC galaxy.xml files use <diff><add> to append new clusters.
    """
    positions: dict[str, tuple[float, float]] = {}

    def _parse_connections(connections_el: ET.Element) -> None:
        for conn in connections_el:
            macro_el = conn.find("macro")
            if macro_el is None:
                continue
            ref = macro_el.get("ref", "")
            if "Cluster" not in ref:
                continue
            offset = conn.find("offset/position")
            x = float(offset.get("x", 0)) if offset is not None else 0.0
            z = float(offset.get("z", 0)) if offset is not None else 0.0
            positions[ref] = (x, z)

    for layer_dir in layer_dirs:
        p = layer_dir / "maps" / "xu_ep2_universe" / "galaxy.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        root_el = tree.getroot()

        if root_el.tag == "macros":
            # Vanilla full file
            conns = root_el.find(".//connections")
            if conns is not None:
                _parse_connections(conns)
        elif root_el.tag == "diff":
            # DLC patch — <add sel="...connections"> contains new cluster connections
            for add_el in root_el.findall("add"):
                _parse_connections(add_el)

    return positions


# ---------------------------------------------------------------------------
# Step 6 — Clusters files: sector lists + region refs per cluster
# ---------------------------------------------------------------------------

def parse_all_clusters(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Unions all *_clusters.xml files across all layers.
    Returns { cluster_macro: {
        sectors: [(macro, x, z), ...],
        regions: [(region_name, x, z), ...],
    } }.
    Positions are in cluster-local coordinates (metres).
    """
    clusters: dict[str, dict] = {}

    for layer_dir in layer_dirs:
        universe_dir = layer_dir / "maps" / "xu_ep2_universe"
        if not universe_dir.exists():
            continue
        for clusters_file in sorted(universe_dir.glob("*clusters.xml")):
            try:
                tree = ET.parse(clusters_file)
            except ET.ParseError:
                continue
            for macro_el in tree.findall("macro"):
                if macro_el.get("class") != "cluster":
                    continue
                macro_name = macro_el.get("name")
                if not macro_name:
                    continue

                sectors: list[tuple[str, float, float]] = []
                regions: list[tuple[str, float, float]] = []

                for conn in macro_el.findall("connections/connection"):
                    ref = conn.get("ref", "")
                    offset = conn.find("offset/position")
                    x = float(offset.get("x", 0)) if offset is not None else 0.0
                    z = float(offset.get("z", 0)) if offset is not None else 0.0

                    if ref == "sectors":
                        child = conn.find("macro")
                        if child is not None and child.get("ref"):
                            sectors.append((child.get("ref"), x, z))
                    elif ref == "regions":
                        region_el = conn.find(".//region")
                        if region_el is not None and region_el.get("ref"):
                            regions.append((region_el.get("ref"), x, z))

                clusters[macro_name] = {
                    "sectors": sectors,
                    "regions": regions,
                }

    return clusters


# ---------------------------------------------------------------------------
# Step 7 — Compute resource totals per sector (spatial proximity assignment)
# ---------------------------------------------------------------------------

def compute_resources_per_sector(
    sectors: list[tuple[str, float, float]],
    regions: list[tuple[str, float, float]],
    region_index: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    """
    Assigns each region to the nearest sector by (x, z) distance, then keeps
    the best (highest) yield name per ware per sector.
    Returns { sector_macro: { ware: best_yield_name } }.
    """
    best: dict[str, dict[str, str]] = {s[0]: {} for s in sectors}
    if not sectors:
        return best

    for region_name, rx, rz in regions:
        resources = region_index.get(region_name)
        if not resources:
            continue
        nearest_macro = min(sectors, key=lambda s: (rx - s[1]) ** 2 + (rz - s[2]) ** 2)[0]
        sector_best = best[nearest_macro]
        for ware, yield_name in resources.items():
            current = sector_best.get(ware)
            if current is None or YIELD_RANK.get(yield_name, 0) > YIELD_RANK.get(current, 0):
                sector_best[ware] = yield_name

    return best


# ---------------------------------------------------------------------------
# Step 8 — Faction index from god.xml station ownership
# ---------------------------------------------------------------------------

def load_faction_index(layer_dirs: list[Path]) -> dict[str, str]:
    """
    Returns { sector_macro_lower: dominant_faction }.
    Parses god.xml across all layers; counts station owners per sector;
    picks the majority faction. Ministry of Finance is folded into teladi.
    """
    NORMALIZE: dict[str, str] = {"ministry": "teladi"}
    SKIP = {"player", "none"}

    votes: dict[str, Counter] = defaultdict(Counter)

    for layer_dir in layer_dirs:
        god_xml = layer_dir / "libraries" / "god.xml"
        if not god_xml.exists():
            continue
        tree = ET.parse(god_xml)
        for st in tree.iter("station"):
            owner = st.get("owner", "")
            if owner in SKIP:
                continue
            owner = NORMALIZE.get(owner, owner)
            loc = st.find("location")
            if loc is None:
                continue
            loc_macro = loc.get("macro", "")
            m = re.search(r"(cluster_\d+_sector\d+_macro)", loc_macro, re.I)
            if m:
                votes[m.group(1).lower()][owner] += 1

    return {sec: ctr.most_common(1)[0][0] for sec, ctr in votes.items() if ctr}


# ---------------------------------------------------------------------------
# Step 9 — Superhighways from sechighways.xml
# ---------------------------------------------------------------------------

def parse_highways(layer_dirs: list[Path]) -> list[dict]:
    """
    Returns list of { name, cluster, entry, exit, spline }.
    Positions in metres, relative to cluster centre.
    Only vanilla has sechighways.xml (28 highways).
    """
    highways: list[dict] = []
    seen: set[str] = set()

    for layer_dir in layer_dirs:
        p = layer_dir / "maps" / "xu_ep2_universe" / "sechighways.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        for macro_el in tree.findall("macro"):
            if macro_el.get("class") != "highway":
                continue
            name = macro_el.get("name", "")
            if name in seen:
                continue
            seen.add(name)

            m = re.search(r"(Cluster_\d+_macro)", name, re.I)
            if not m:
                continue
            cluster = m.group(1)

            entry: dict | None = None
            exit_: dict | None = None
            for conn in macro_el.findall("connections/connection"):
                pos_el = conn.find("offset/position")
                if pos_el is None:
                    continue
                pos = {"x": float(pos_el.get("x", 0)), "z": float(pos_el.get("z", 0))}
                if conn.get("ref") == "entrypoint":
                    entry = pos
                elif conn.get("ref") == "exitpoint":
                    exit_ = pos

            spline: list[dict] = []
            for sp in macro_el.findall("properties/boundaries/boundary/splineposition"):
                spline.append({
                    "x":  float(sp.get("x",  0)),
                    "z":  float(sp.get("z",  0)),
                    "tx": float(sp.get("tx", 0)),
                    "tz": float(sp.get("tz", 0)),
                })

            highways.append({
                "name":    name,
                "cluster": cluster,
                "entry":   entry,
                "exit":    exit_,
                "spline":  spline,
            })

    return highways


# ---------------------------------------------------------------------------
# Step 10 — Assemble and write
# ---------------------------------------------------------------------------

def generate(xml_root: Path, db_path: Path, out_dir: Path) -> None:

    layer_dirs = _layer_dirs(xml_root)

    print(f"XML root   : {xml_root}")
    print(f"Layers     : {[d.name for d in layer_dirs]}")
    print(f"DB         : {db_path}")
    print(f"Output     : {out_dir}")
    print()

    print("[1/6] Loading strings from DB...")
    strings = load_strings(db_path)
    print(f"      {len(strings):,} strings loaded.")

    print("[2/6] Loading region definitions...")
    region_index     = load_region_index(layer_dirs)
    sector_boundaries = load_sector_boundaries(layer_dirs)
    print(f"      {len(region_index)} resource regions, {len(sector_boundaries)} sector boundaries indexed.")

    print("[3/6] Loading mapdefaults (names + descriptions + area stats)...")
    mapdefaults = load_mapdefaults(layer_dirs)
    print(f"      {len(mapdefaults)} dataset entries loaded.")

    print("[4/6] Loading galaxy positions + cluster/sector structure...")
    positions = load_cluster_positions(layer_dirs)
    cluster_data = parse_all_clusters(layer_dirs)
    print(f"      {len(positions)} cluster positions, {len(cluster_data)} cluster definitions.")

    print("[5/6] Loading faction index from god.xml...")
    faction_index = load_faction_index(layer_dirs)
    print(f"      {len(faction_index)} sectors with faction data.")

    print("[6/7] Parsing superhighways from sechighways.xml...")
    highways = parse_highways(layer_dirs)
    print(f"      {len(highways)} highways parsed.")

    print("[7/7] Assembling sectors.json + highways.json...")

    clusters_out: list[dict] = []

    for cluster_macro, data in sorted(cluster_data.items()):
        raw_x, raw_z = positions.get(cluster_macro, (0.0, 0.0))
        grid_x = round(raw_x / GRID_X_DIV, 4)
        grid_z = round(raw_z / GRID_Z_DIV, 4)

        cluster_meta = mapdefaults.get(cluster_macro.lower(), {})
        cluster_name = resolve(cluster_meta.get("name_ref"), strings) or cluster_macro
        cluster_desc = resolve(cluster_meta.get("description_ref"), strings)

        resources_by_sector = compute_resources_per_sector(
            data["sectors"], data["regions"], region_index
        )

        dlc = cluster_dlc(cluster_macro)

        sectors_out: list[dict] = []
        for sector_macro, sx, sz in data["sectors"]:
            sector_meta = mapdefaults.get(sector_macro.lower(), {})
            sector_name = resolve(sector_meta.get("name_ref"), strings) or sector_macro
            sector_desc = resolve(sector_meta.get("description_ref"), strings)
            sector_faction = faction_index.get(sector_macro.lower()) or "ownerless"
            region_key = _macro_to_region_name(sector_macro)
            boundary   = sector_boundaries.get(region_key, {}) if region_key else {}
            sectors_out.append({
                "macro":         sector_macro,
                "name":          sector_name,
                "dlc":           dlc,
                "description":   sector_desc,
                "pos_x":         sx,
                "pos_z":         sz,
                "sunlight":      sector_meta.get("sunlight"),
                "economy":       sector_meta.get("economy"),
                "security":      sector_meta.get("security"),
                "faction":       sector_faction,
                "resources":     resources_by_sector.get(sector_macro, {}),
                "region_shape":  boundary.get("shape"),
                "region_r":      boundary.get("r"),
                "region_linear": boundary.get("linear"),
            })

        # Cluster faction = dominant faction among its sectors (ignoring None)
        sector_factions = [s["faction"] for s in sectors_out if s["faction"]]
        cluster_faction = Counter(sector_factions).most_common(1)[0][0] if sector_factions else None

        clusters_out.append({
            "macro":       cluster_macro,
            "name":        cluster_name,
            "dlc":         dlc,
            "description": cluster_desc,
            "grid_x":      grid_x,
            "grid_z":      grid_z,
            "faction":     cluster_faction,
            "sectors":     sectors_out,
        })

    out_dir.mkdir(parents=True, exist_ok=True)

    out_path = out_dir / "sectors.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"clusters": clusters_out}, f, ensure_ascii=False, indent=2)

    hw_path = out_dir / "highways.json"
    with open(hw_path, "w", encoding="utf-8") as f:
        json.dump({"highways": highways}, f, ensure_ascii=False, indent=2)

    hw_size_kb = hw_path.stat().st_size / 1024
    print(f"      Written: {hw_path}  ({hw_size_kb:.0f} KB)")

    size_kb = out_path.stat().st_size / 1024
    all_sectors     = [s for c in clusters_out for s in c["sectors"]]
    no_position     = sum(1 for c in clusters_out if c["grid_x"] == 0 and c["grid_z"] == 0)
    no_name         = sum(1 for c in clusters_out if c["name"] == c["macro"])
    no_resources    = sum(1 for s in all_sectors if not s["resources"])
    no_faction      = sum(1 for s in all_sectors if s["faction"] is None)
    dlc_dist        = Counter(c["dlc"] for c in clusters_out)

    print(f"      Written: {out_path}  ({size_kb:.0f} KB)")
    print()
    print("=== Validation report ===")
    print(f"  Clusters total      : {len(clusters_out)}")
    print(f"  Sectors total       : {len(all_sectors)}")
    print(f"  No position (0,0)   : {no_position}  (Cluster_01 expected)")
    print(f"  Unresolved names    : {no_name}")
    print(f"  Sectors no resources: {no_resources}  (space-only sectors expected)")
    print(f"  Sectors no faction  : {no_faction}")
    print(f"  DLC distribution    : {dict(sorted(dlc_dist.items()))}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate catalog/sectors.json from X4 XML extractions.")
    parser.add_argument("--xml", default=str(DEFAULT_XML_ROOT), help="Path to extraction root (contains 00_VANILLA, 01_SPLIT_VENDETTA, …)")
    parser.add_argument("--db",  default=str(DEFAULT_DB_PATH),  help="Path to x4_data.db")
    parser.add_argument("--out", default=str(DEFAULT_OUT_DIR),  help="Output directory")
    args = parser.parse_args()

    generate(
        xml_root = Path(args.xml),
        db_path  = Path(args.db),
        out_dir  = Path(args.out),
    )


if __name__ == "__main__":
    main()
