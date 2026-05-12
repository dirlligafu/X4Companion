#!/usr/bin/env python
"""
generate_ships.py — Build catalog/ships.json from X4 game XML extractions.

Each ship entry contains everything needed for display and fitting:
  - Resolved name, basename, description (lore text)
  - Physics (mass, drag, inertia) for speed/maneuverability calculations
  - Storage capacities (missile, deployable, countermeasure, cargo)
  - Named equipment slots with their tags (used for fitting compatibility)
  - Price range and owning factions (from libraries/wares.xml)
  - Software loadout

Data comes from THREE separate XML files per ship:
  1. assets/units/size_*/macros/ship_*_macro.xml  → physics, storage, hull, type
  2. assets/units/size_*/ship_*.xml               → named slots with tags
  3. libraries/wares.xml                          → price, owners, description ref
  + SQLite strings table                          → resolved localized strings

Extraction layout expected at --xml root:
  00_VANILLA/   01_SPLIT_VENDETTA/  02_CRADLE_OF_HUMANITY/  ...
DLC folders use Egosoft's <diff> format; only <add sel="/wares"> entries are merged.

Usage:
  python scripts/catalog/generate_ships.py
  python scripts/catalog/generate_ships.py --xml C:/path/to/X4-Extractions --db path/to/x4_data.db --out path/to/out/
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Configuration — default paths
# ---------------------------------------------------------------------------

DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions")
DEFAULT_DB_PATH  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\x4_data.db")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")

def _layer_dirs(root: Path) -> list[Path]:
    """Returns numbered extraction subdirs (00_VANILLA, 01_SPLIT_VENDETTA, …) in order."""
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


# Equipment slot types we care about — others (cockpit, dockingbay, etc.) are ignored
SLOT_TYPES = {"engine", "weapon", "turret", "shield", "thruster"}

# Mapping from size tag to our canonical size label
SIZE_TAG_MAP = {
    "extrasmall": "xs", "tiny": "xs",
    "small":      "s",
    "medium":     "m",
    "large":      "l",
    "extralarge": "xl", "huge": "xl",
}

# dock_* tag → canonical size (for external docking pads)
DOCK_PAD_SIZE_MAP = {"dock_xs": "xs", "dock_s": "s", "dock_m": "m", "dock_l": "l", "dock_xl": "xl"}

RE_PAD_MACRO = re.compile(r"dockingbay_\w+_([smlx]+)_\d+")


# ---------------------------------------------------------------------------
# Step 1 — Load localized strings from SQLite
# ---------------------------------------------------------------------------

def load_strings(db_path: Path) -> dict[tuple[int, int], str]:
    """
    Returns a dict keyed by (page_id, string_id) → resolved text.
    The strings table is our authoritative source for all in-game text.
    Ship names/descriptions are stored as refs like {20101,10302} in the XMLs.
    """
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute("SELECT page, string_id, text FROM strings")
    result = {(row[0], row[1]): row[2] for row in cur.fetchall()}
    conn.close()
    return result


def _finalize_x4_localized_string(text: str | None) -> str | None:
    """
    After resolving {page,id}, unescape \\( \\) then strip X4 ship-class size hints
    (e.g. \\(small\\)S in t files → in-game 'S' only). See generate_equipment.py.
    """
    if text is None:
        return None
    s = text.replace(r"\(", "(").replace(r"\)", ")")
    s = re.sub(r"\((?:extra\s+large|xlarge)\)XL", "XL", s, flags=re.IGNORECASE)
    s = re.sub(r"\(large\)L", "L", s, flags=re.IGNORECASE)
    s = re.sub(r"\(medium\)M", "M", s, flags=re.IGNORECASE)
    s = re.sub(r"\(small\)S", "S", s, flags=re.IGNORECASE)
    return s


def resolve(ref: str | None, strings: dict, _depth: int = 0) -> str | None:
    """
    Resolves a localized string reference like '{20101,10302}' to its text.
    If the ref is already plain text, returns it as-is.
    If resolution fails (DLC string not in DB), returns None.

    X4 uses a two-level indirection:
      XML contains  → {20101,10302}
      strings table → (Nova Vanguard){20101,10301} {20111,1101}
      strings table → 'Nova' and 'Vanguard'
    So we recurse up to 4 times to handle all cases.

    The (hint) prefix in a string is the pre-resolved display text — used as
    fallback when inner refs point to DLC strings not present in our DB.
    """
    if not ref or _depth > 4:
        return None
    if not ref.startswith("{") and not ref.startswith("("):
        # Already plain text — still unescape \( and \) if present
        return _finalize_x4_localized_string(ref)

    text = ref
    hint = None

    # Strip and save the pre-resolved hint: (Nova Vanguard){page,id}...
    if text.startswith("("):
        close = text.find("){")
        if close != -1:
            hint = text[1:close]
            text = text[close + 1:]

    if "{" not in text:
        return _finalize_x4_localized_string(hint or text)

    # Resolve each {page,id} ref, concatenating results
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
                    # The retrieved string may itself contain refs → recurse
                    resolved = resolve(raw_string, strings, _depth + 1)
                    result_parts.append(resolved or raw_string)
                elif hint:
                    return _finalize_x4_localized_string(hint)  # DLC string missing — use hint as fallback
                # else: skip unresolvable ref
            except ValueError:
                pass

    joined = " ".join(p.strip() for p in result_parts if p.strip())
    result = joined if joined else hint
    return _finalize_x4_localized_string(result)


# ---------------------------------------------------------------------------
# Step 2 — Parse libraries/wares.xml for prices, owners, description refs
# ---------------------------------------------------------------------------

def load_wares_index(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Parses libraries/wares.xml across all layers to extract, for each ship ware:
      - price (min, average, max)
      - owner factions list
      - description string ref (the lore text ref is here, not in the macro)
      - player_usable flag (presence of a <restriction> element)

    Vanilla (00_VANILLA) is the base file. DLC files use Egosoft's <diff> format;
    only <add sel="/wares"> blocks are processed — they contain new ship wares.
    """
    wares: dict[str, dict] = {}  # keyed by macro name

    def _process_ware_element(ware: ET.Element) -> None:
        tags = ware.get("tags", "")
        if "ship" not in tags.split():
            return
        component = ware.find("component")
        if component is None:
            return
        macro_name = component.get("ref")
        if not macro_name:
            return
        price_el = ware.find("price")
        price = None
        if price_el is not None:
            price = {
                "min":     int(price_el.get("min", 0)),
                "average": int(price_el.get("average", 0)),
                "max":     int(price_el.get("max", 0)),
            }
        owners = [o.get("faction") for o in ware.findall("owner") if o.get("faction")]
        restriction = ware.find("restriction")
        player_usable = restriction is not None
        description_ref = ware.get("description")
        wares[macro_name] = {
            "price":           price,
            "owners":          owners,
            "player_usable":   player_usable,
            "description_ref": description_ref,
        }

    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "wares.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        root_el = tree.getroot()

        if root_el.tag == "wares":
            # Vanilla — full file
            for ware in root_el.iter("ware"):
                _process_ware_element(ware)
        elif root_el.tag == "diff":
            # DLC patch — only <add sel="/wares"> contains new top-level wares
            for add_el in root_el.findall("add"):
                if add_el.get("sel") == "/wares":
                    for ware in add_el:
                        _process_ware_element(ware)

    return wares


# ---------------------------------------------------------------------------
# Step 3 — Parse component XML for named equipment slots
# ---------------------------------------------------------------------------

def parse_component_slots(component_xml_path: Path) -> list[dict]:
    """
    Parses the component XML (e.g. ship_arg_s_fighter_01.xml) to extract
    all named connections that correspond to equipment slots.

    Each connection has a 'tags' attribute like:
      'engine small platformcollision standard'
      'weapon small platformcollision standard missile symmetry_right combat'
      'small shield unhittable standard'

    We filter to keep only connections whose tags contain a known slot type
    (engine, weapon, turret, shield, thruster).

    Returns a list of slot dicts:
      { name, type, size, tags: [] }
    """
    slots = []
    try:
        tree = ET.parse(component_xml_path)
    except (ET.ParseError, FileNotFoundError):
        return slots

    root = tree.getroot()
    component = root.find("component")
    if component is None:
        return slots

    connections = component.find("connections")
    if connections is None:
        return slots

    for conn in connections:
        name = conn.get("name", "")
        raw_tags = conn.get("tags", "")
        tag_list = [t for t in raw_tags.split() if t]

        # Determine slot type from tags
        slot_type = next((t for t in tag_list if t in SLOT_TYPES), None)
        if slot_type is None:
            continue  # not an equipment slot

        # Determine size from tags (small → s, medium → m, etc.)
        size = next(
            (SIZE_TAG_MAP[t] for t in tag_list if t in SIZE_TAG_MAP),
            None
        )

        slots.append({
            "name": name,
            "type": slot_type,
            "size": size,
            "tags": tag_list,
        })

    return slots


# ---------------------------------------------------------------------------
# Step 4 — Parse ship macro XML for physics and properties
# ---------------------------------------------------------------------------

def parse_ship_macro(macro_path: Path) -> dict | None:
    """
    Parses a ship_*_macro.xml file.

    Returns a dict with all ship properties, or None if the file is not
    a ship macro (cockpit macros, etc. are in the same folder and ignored).
    """
    try:
        tree = ET.parse(macro_path)
    except ET.ParseError:
        return None

    root = tree.getroot()
    macro_el = root.find("macro")
    if macro_el is None:
        return None

    # Only process ship macros (class starts with "ship_")
    cls = macro_el.get("class", "")
    if not cls.startswith("ship_"):
        return None

    macro_name = macro_el.get("name", "")
    component_ref = macro_el.findtext("component[@ref]") or ""
    # component ref is the base name used to find the component XML
    comp_ref = macro_el.find("component")
    component_ref = comp_ref.get("ref", "") if comp_ref is not None else ""

    props = macro_el.find("properties")
    if props is None:
        return None

    # ── Identification ──────────────────────────────────────────────────
    ident = props.find("identification")
    name_ref     = ident.get("name")        if ident is not None else None
    basename_ref = ident.get("basename")    if ident is not None else None
    maker_race   = ident.get("makerrace")   if ident is not None else None
    variation    = ident.get("variation")   if ident is not None else None
    icon         = ident.get("icon")        if ident is not None else None

    # ── Hull & crew ─────────────────────────────────────────────────────
    hull_el  = props.find("hull")
    hull_max = int(hull_el.get("max", 0)) if hull_el is not None else None

    people_el = props.find("people")
    crew      = int(people_el.get("capacity", 0)) if people_el is not None else None

    # ── Storage ─────────────────────────────────────────────────────────
    # All storage types are attributes on the <storage> element
    storage_el = props.find("storage")
    storage: dict[str, int] = {}
    if storage_el is not None:
        for attr in ("missile", "unit", "countermeasure", "deployable"):
            val = storage_el.get(attr)
            if val is not None:
                storage[attr] = int(val)

    # ── Ship type ────────────────────────────────────────────────────────
    # Explicitly set in <ship type="fighter"/> — much more reliable than
    # parsing the macro name (which we used as a fallback before)
    ship_el   = props.find("ship")
    ship_type = ship_el.get("type") if ship_el is not None else None

    # ── Radar range ─────────────────────────────────────────────────────
    radar_el    = props.find("radar")
    radar_range = int(radar_el.get("range", 0)) if radar_el is not None else None

    # ── Physics ─────────────────────────────────────────────────────────
    # mass      → used in: acceleration = (thrust * engine_count) / mass
    # drag      → used in: speed = (thrust * engine_count) / drag.forward
    # inertia   → moment of inertia (rotation resistance)
    # accfactors → thrust multipliers per direction
    physics = None
    physics_el = props.find("physics")
    if physics_el is not None:
        drag_el    = physics_el.find("drag")
        inertia_el = physics_el.find("inertia")
        acc_el     = physics_el.find("accfactors")

        physics = {
            "mass": float(physics_el.get("mass", 0)),
        }
        if drag_el is not None:
            physics["drag"] = {
                k: float(drag_el.get(k, 0))
                for k in ("forward", "reverse", "horizontal", "vertical", "pitch", "yaw", "roll")
                if drag_el.get(k) is not None
            }
        if inertia_el is not None:
            physics["inertia"] = {
                k: float(inertia_el.get(k, 0))
                for k in ("pitch", "yaw", "roll")
                if inertia_el.get(k) is not None
            }
        if acc_el is not None:
            physics["accfactors"] = {
                k: float(acc_el.get(k, 0))
                for k in ("forward", "reverse", "horizontal", "vertical")
                if acc_el.get(k) is not None
            }

    # ── Jerk parameters ─────────────────────────────────────────────────
    # Jerk controls how quickly the ship reaches its max speed / rotation.
    # Useful for feel/handling but not required for basic stat display.
    jerk = None
    jerk_el = props.find("jerk")
    if jerk_el is not None:
        jerk = {}
        for mode in jerk_el:
            mode_data = {k: float(v) for k, v in mode.attrib.items()}
            jerk[mode.tag] = mode_data

    # ── Software loadout ─────────────────────────────────────────────────
    software = []
    sw_el = props.find("software")
    if sw_el is not None:
        for sw in sw_el.findall("software"):
            entry: dict[str, Any] = {"ware": sw.get("ware")}
            if sw.get("default"):
                entry["default"] = True
            if sw.get("compatible"):
                entry["compatible"] = True
            software.append(entry)

    # ── Thruster tag ─────────────────────────────────────────────────────
    # Defines which thruster size is compatible with this ship
    thruster_el = props.find("thruster")
    thruster_tags = thruster_el.get("tags", "").split() if thruster_el is not None else []

    # ── Storage macro reference ───────────────────────────────────────────
    # The ship macro connections list which storage macro holds the cargo bay.
    # We extract the ref name here so the caller can resolve cargo info.
    storage_macro_ref = None
    connections_el = macro_el.find("connections")
    if connections_el is not None:
        for conn in connections_el:
            if conn.get("ref", "").startswith("con_storage"):
                child_macro = conn.find("macro")
                if child_macro is not None:
                    storage_macro_ref = child_macro.get("ref")
                    break

    return {
        "macro":             macro_name,
        "class":             cls,
        "component_ref":     component_ref,
        "name_ref":          name_ref,
        "basename_ref":      basename_ref,
        "maker_race":        maker_race,
        "variation":         variation,
        "icon":              icon,
        "hull":              hull_max,
        "people_capacity":   crew,
        "storage":           storage,
        "ship_type":         ship_type,
        "radar_range":       radar_range,
        "physics":           physics,
        "jerk":              jerk,
        "software":          software,
        "thruster_tags":     thruster_tags,
        "storage_macro_ref": storage_macro_ref,
    }


# ---------------------------------------------------------------------------
# Step 5 — Equipment index for outfitting compatibility
# ---------------------------------------------------------------------------

# Maps SQLite group_id to the slot type tag used in ship component connections
GROUP_TO_SLOT_TYPE = {
    "engines":   "engine",
    "shields":   "shield",
    "weapons":   "weapon",
    "turrets":   "turret",
    "thrusters": "thruster",
}

def load_equipment_index(db_path: Path) -> dict[str, list[dict]]:
    """
    Loads the equipment table from SQLite and organises it for fast lookup.

    Returns a dict keyed by slot_type (engine/shield/weapon/turret/thruster),
    each containing a list of { macro, size, faction } dicts.

    We use the existing equipment table rather than re-parsing all equipment
    XMLs — it already has size and faction (makerrace) which is all we need
    for compatibility matching.
    """
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute(
        "SELECT macro, size, faction, group_id FROM equipment WHERE player_usable = 1"
    )
    rows = cur.fetchall()
    conn.close()

    index: dict[str, list[dict]] = {t: [] for t in GROUP_TO_SLOT_TYPE.values()}
    for macro, size, faction, group_id in rows:
        slot_type = GROUP_TO_SLOT_TYPE.get(group_id)
        if slot_type:
            index[slot_type].append({
                "macro":   macro,
                "size":    size,
                "faction": faction,
            })
    return index


def compute_outfitting_allowed(
    slots: list[dict],
    ship_faction: str | None,
    equipment_index: dict[str, list[dict]],
) -> dict[str, list[str]]:
    """
    Computes the list of compatible equipment macros for each named slot.

    Matching rules (same logic as Roguey / QSNA):
      1. Equipment type must match slot type (engine→engine, etc.)
      2. Equipment size must match slot size (s→s, m→m, etc.)
      3. Race exclusivity: Boron equipment only fits Boron ships, and
         non-Boron equipment does not fit on Boron ships.

    Returns { slot_name: [compatible_macro, ...] }.
    Slots of the same type+size share an identical compatible list, but
    we still key by slot name so the fitting UI can address each slot individually.
    """
    is_boron_ship = (ship_faction == "bor")

    # Cache: (type, size) → filtered macro list — avoids recomputing for
    # ships with multiple identical slots (e.g. 4× M weapon slots)
    cache: dict[tuple[str, str | None], list[str]] = {}

    result: dict[str, list[str]] = {}

    for slot in slots:
        slot_name = slot["name"]
        slot_type = slot["type"]
        slot_size = slot["size"]
        cache_key = (slot_type, slot_size)

        if cache_key not in cache:
            compatible = []
            for eq in equipment_index.get(slot_type, []):
                # Size must match
                if eq["size"] != slot_size:
                    continue
                # Race exclusivity
                eq_is_boron = (eq["faction"] == "bor")
                if is_boron_ship != eq_is_boron:
                    continue
                compatible.append(eq["macro"])
            cache[cache_key] = sorted(compatible)

        result[slot_name] = cache[cache_key]

    return result


# ---------------------------------------------------------------------------
# Step 6 — Parse cargo info from the storage macro
# ---------------------------------------------------------------------------

def build_storage_macro_index(layer_dirs: list[Path]) -> dict[str, Path]:
    """
    Builds a name→path index of all storage_*_macro.xml files across all layers.

    Storage macros live in two distinct locations:
      - assets/units/size_*/macros/          (ship-specific storage)
      - assets/props/StorageModules/macros/  (shared generic storage)
    Later layers override earlier ones for the same macro name.
    """
    index: dict[str, Path] = {}
    for layer_dir in layer_dirs:
        for pattern in (
            "assets/units/size_*/macros/storage_*_macro.xml",
            "assets/props/StorageModules/macros/storage_*_macro.xml",
        ):
            for p in (layer_dir).glob(pattern):
                index[p.stem] = p
    return index


def build_shipstorage_lookup(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Builds name→{size, capacity} from all shipstorage_gen_*.xml files across all layers.
    Capacity comes from <dock capacity="N"/> — NOT derived from the macro name.
    """
    result: dict[str, dict] = {}
    for layer_dir in layer_dirs:
        for p in layer_dir.rglob("shipstorage_gen_*.xml"):
            try:
                tree = ET.parse(p)
            except ET.ParseError:
                continue
            root = tree.getroot()
            macro_el = root.find("macro")
            if macro_el is None:
                continue
            macro_name = macro_el.get("name", p.stem)
            props = macro_el.find("properties")
            if props is None:
                continue
            dock_el = props.find("dock")
            capacity = int(dock_el.get("capacity", 0)) if dock_el is not None else 0
            if capacity == 0:
                continue
            docksize_el = props.find("docksize")
            docksize_tags = (docksize_el.get("tags", "") if docksize_el is not None else "").split()
            size = next((DOCK_PAD_SIZE_MAP[t] for t in docksize_tags if t in DOCK_PAD_SIZE_MAP), None)
            if size:
                result[macro_name] = {"size": size, "capacity": capacity}
    return result


def build_template_index(templates_dir: Path) -> dict[str, Path]:
    """Flat stem→path index for all ship template XMLs."""
    return {p.stem: p for p in templates_dir.rglob("*.xml")}


def parse_ship_docking(
    template_path: Path | None,
    shipstorage_lookup: dict[str, dict],
) -> tuple[dict, dict]:
    """
    Parses a ship template XML to extract hangar and pad data.

    Returns:
      hangar_storage: { "xs": N, "s": N, "m": N }  — internal capacity by size
      docking_pads:   { "s": N, "m": N }             — external pad count by size
    """
    hangar_storage: dict[str, int] = {}
    docking_pads:   dict[str, int] = {}

    if template_path is None:
        return hangar_storage, docking_pads
    try:
        tree = ET.parse(template_path)
    except (ET.ParseError, FileNotFoundError):
        return hangar_storage, docking_pads

    for elem in tree.iter("component"):
        cls   = elem.get("class", "")
        macro = elem.get("macro", "")

        if cls == "dockingbay" and macro.startswith("shipstorage_gen_"):
            info = shipstorage_lookup.get(macro)
            if info:
                size = info["size"]
                hangar_storage[size] = hangar_storage.get(size, 0) + info["capacity"]

        elif cls == "dockarea":
            for child in elem.iter("component"):
                if child.get("class") == "dockingbay":
                    m = RE_PAD_MACRO.match(child.get("macro", ""))
                    if m:
                        size = {"xs": "xs", "s": "s", "m": "m", "l": "l", "xl": "xl"}.get(m.group(1))
                        if size:
                            docking_pads[size] = docking_pads.get(size, 0) + 1

    return hangar_storage, docking_pads


def parse_cargo(storage_macro_ref: str | None, storage_index: dict[str, Path]) -> dict | None:
    """
    Parses the storage sub-macro to get cargo bay capacity and type.
    Uses a pre-built index (name→path) to locate the file regardless of layer or folder.

    Returns { max, tags } or None if no storage macro is found.
    """
    if not storage_macro_ref:
        return None

    storage_path = storage_index.get(storage_macro_ref)
    if storage_path is None:
        return None

    try:
        tree = ET.parse(storage_path)
    except ET.ParseError:
        return None

    cargo_el = tree.getroot().find(".//cargo")
    if cargo_el is None:
        return None

    return {
        "max":  int(cargo_el.get("max", 0)),
        "tags": cargo_el.get("tags", "").split(),
    }


# ---------------------------------------------------------------------------
# Step 7 — Derive weapon/turret counts by size from slot list
# ---------------------------------------------------------------------------

def compute_slot_counts(slots: list[dict]) -> dict[str, int]:
    """
    Counts equipment slots grouped by type and size.

    e.g. { 'engines': 2, 'weapons_s': 2, 'turrets_m': 4, 'shields': 1 }

    Engines and shields typically come in one size per ship so we don't
    suffix them — but we do suffix weapons and turrets since a carrier
    may have both M and L turret slots.
    """
    counts: dict[str, int] = {}
    for slot in slots:
        t    = slot["type"]
        size = slot["size"] or "?"
        # For engines/shields/thrusters the size is uniform per ship,
        # suffix anyway for consistency
        key = f"{t}s_{size}" if t in ("weapon", "turret") else f"{t}s"
        counts[key] = counts.get(key, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Step 8 — Assemble and write output
# ---------------------------------------------------------------------------

def generate(xml_root: Path, db_path: Path, out_dir: Path) -> None:

    layer_dirs = _layer_dirs(xml_root)

    print(f"XML root   : {xml_root}")
    print(f"Layers     : {[d.name for d in layer_dirs]}")
    print(f"DB         : {db_path}")
    print(f"Output     : {out_dir}")
    print()

    # --- Load shared resources ---

    print("[1/5] Loading strings from DB...")
    strings = load_strings(db_path)
    print(f"      {len(strings):,} strings loaded.")

    print("[2/5] Indexing wares.xml across all layers (vanilla + DLC diffs)...")
    wares_index = load_wares_index(layer_dirs)
    print(f"      {len(wares_index)} ship wares indexed.")

    print("[3/5] Building storage macro index...")
    storage_index = build_storage_macro_index(layer_dirs)
    print(f"      {len(storage_index)} storage macros indexed.")

    print("[3b]  Building shipstorage (hangar) lookup...")
    shipstorage_lookup = build_shipstorage_lookup(layer_dirs)
    print(f"      {len(shipstorage_lookup)} shipstorage macros indexed.")

    print("[3c]  Indexing ship templates for docking data...")
    templates_dir   = out_dir.parent / "ship_templates"
    template_index  = build_template_index(templates_dir)
    print(f"      {len(template_index)} ship templates indexed.")

    print("[4/5] Loading equipment index for outfitting compatibility...")
    equipment_index = load_equipment_index(db_path)
    total_eq = sum(len(v) for v in equipment_index.values())
    print(f"      {total_eq} equipment entries indexed across {len(equipment_index)} slot types.")

    # --- Scan all ship macro files across all layers ---

    print("[5/5] Scanning ship macro XMLs...")
    macro_files = []
    for layer_dir in layer_dirs:
        macro_files.extend((layer_dir / "assets" / "units").glob("size_*/macros/ship_*_macro.xml"))
    print(f"      {len(macro_files)} macro files found.")

    ships = []
    skipped = 0

    print("[6/6] Parsing macros + components...")
    for macro_path in sorted(macro_files):
        raw = parse_ship_macro(macro_path)
        if raw is None:
            skipped += 1
            continue

        macro_name = raw["macro"]

        # The component XML is in the parent folder of /macros/
        # e.g. macros/ship_arg_s_fighter_01_a_macro.xml → ../ship_arg_s_fighter_01.xml
        component_xml = macro_path.parent.parent / f"{raw['component_ref']}.xml"
        slots = parse_component_slots(component_xml)

        # Cargo info from the storage sub-macro (looked up in the cross-layer index)
        cargo = parse_cargo(raw["storage_macro_ref"], storage_index)

        # Slot counts by type+size (e.g. weapons_s: 2, turrets_m: 4)
        slot_counts = compute_slot_counts(slots)

        # Outfitting compatibility — which equipment fits which slot
        outfitting = compute_outfitting_allowed(slots, raw["maker_race"], equipment_index)

        # Docking/hangar data from the ship template XML
        # Template stems match macro_name without "_macro" suffix (variant-specific files)
        hangar_storage, docking_pads = parse_ship_docking(
            template_index.get(macro_name.replace("_macro", "")),
            shipstorage_lookup,
        )

        # Merge ware data (price, owners, player_usable, description ref)
        ware = wares_index.get(macro_name, {})

        # Resolve all localized strings now — stored as plain text in the JSON.
        # This way the app never needs to look up strings at runtime.
        name        = resolve(raw["name_ref"],     strings) or macro_name
        basename    = resolve(raw["basename_ref"], strings) or name
        description = resolve(ware.get("description_ref"), strings)

        # Derive ship size from class: "ship_s" → "s", "ship_xl" → "xl"
        size = raw["class"].replace("ship_", "") if raw["class"].startswith("ship_") else None

        ship: dict[str, Any] = {
            "macro":             macro_name,
            "name":              name,
            "basename":          basename,
            "description":       description,
            "size":              size,
            "ship_type":         raw["ship_type"],
            "faction":           raw["maker_race"],
            "variation":         raw["variation"],
            "icon":              raw["icon"],
            "hull":              raw["hull"],
            "people_capacity":   raw["people_capacity"],
            "storage":           raw["storage"],
            "cargo":             cargo,
            "radar_range":       raw["radar_range"],
            "physics":           raw["physics"],
            "jerk":              raw["jerk"],
            "thruster_tags":     raw["thruster_tags"],
            "software":          raw["software"],
            "slots":             slots,
            "slot_counts":       slot_counts,
            "outfitting_allowed": outfitting,
            "price":             ware.get("price"),
            "owners":            ware.get("owners", []),
            "player_usable":     ware.get("player_usable", False),
            "hangar_storage":    hangar_storage,
            "docking_pads":      docking_pads,
        }

        ships.append(ship)

    print(f"      {len(ships)} ships assembled, {skipped} non-ship macros skipped.")

    # --- Write output ---

    print("[6/6] Writing output...")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "ships.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(ships, f, ensure_ascii=False, indent=2)

    print(f"      Written: {out_path}  ({out_path.stat().st_size / 1024:.0f} KB)")
    print()

    # --- Quick validation report ---
    no_physics   = sum(1 for s in ships if s["physics"] is None)
    no_price     = sum(1 for s in ships if s["price"] is None)
    no_desc      = sum(1 for s in ships if s["description"] is None)
    no_slots     = sum(1 for s in ships if not s["slots"])
    no_cargo     = sum(1 for s in ships if s["cargo"] is None)
    no_outfitting = sum(1 for s in ships if not s["outfitting_allowed"])
    player_only  = sum(1 for s in ships if s["player_usable"])

    print("=== Validation report ===")
    print(f"  Total ships         : {len(ships)}")
    print(f"  Player-usable       : {player_only}")
    print(f"  Missing physics     : {no_physics}")
    print(f"  Missing price       : {no_price}  (NPC-only ships expected)")
    print(f"  Missing description : {no_desc}  (NPC-only ships expected)")
    print(f"  Missing cargo       : {no_cargo}")
    print(f"  No equipment slots  : {no_slots}  (drones/carriers expected)")
    print(f"  No outfitting       : {no_outfitting}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate catalog/ships.json from X4 XML extractions.")
    parser.add_argument("--xml", default=str(DEFAULT_XML_ROOT), help="Path to the extraction root (contains 00_VANILLA, 01_SPLIT_VENDETTA, …)")
    parser.add_argument("--db",  default=str(DEFAULT_DB_PATH),  help="Path to x4_data.db (for string resolution)")
    parser.add_argument("--out", default=str(DEFAULT_OUT_DIR),  help="Output directory for catalog JSON files")
    args = parser.parse_args()

    generate(
        xml_root = Path(args.xml),
        db_path  = Path(args.db),
        out_dir  = Path(args.out),
    )


if __name__ == "__main__":
    main()
