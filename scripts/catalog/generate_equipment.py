#!/usr/bin/env python
"""
generate_equipment.py — Build catalog/equipment.json from X4 game XML extractions.

Produces a single JSON file with five categories:
  engines    — main propulsion (boost, travel, thrust stats)
  shields    — shield generators (recharge max/rate/delay)
  thrusters  — RCS thrusters (strafe/pitch/yaw/roll thrust)
  weapons    — forward-facing weapons
  turrets    — turret weapons

For weapons and turrets, stats are split across TWO XMLs:
  1. weapon/turret macro  → name, faction, hull, bullet class reference
  2. bullet macro         → speed, lifetime, damage, reload, heat, weapon_system

Price, owners, player_usable and description refs come from libraries/wares.xml.
Names/descriptions are resolved at generation time via the SQLite strings table.

Usage:
  python scripts/catalog/generate_equipment.py
  python scripts/catalog/generate_equipment.py --xml C:/path/to/X4-Extractions --db path/to/x4_data.db --out path/to/out/

Extraction layout expected at --xml root:
  00_VANILLA/   01_SPLIT_VENDETTA/  02_CRADLE_OF_HUMANITY/  ...
DLC folders use Egosoft's <diff> format; only <add sel="/wares"> entries are merged.
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

DEFAULT_XML_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions\OUTPUT")
DEFAULT_DB_PATH  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\x4_data.db")
DEFAULT_OUT_DIR  = Path(r"C:\DEVS\REACT\X4\src-tauri\resources\catalog")

def _layer_dirs(root: Path) -> list[Path]:
    """Returns numbered extraction subdirs (00_VANILLA, 01_SPLIT_VENDETTA, …) in order."""
    return sorted(d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit())


# Map from macro name size segment to canonical label
SIZE_CANONICAL = {"xs", "s", "m", "l", "xl"}


# ---------------------------------------------------------------------------
# Step 1 — Shared utilities: strings + resolve
# ---------------------------------------------------------------------------

def load_strings(db_path: Path) -> dict[tuple[int, int], str]:
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()
    cur.execute("SELECT page, string_id, text FROM strings")
    result = {(row[0], row[1]): row[2] for row in cur.fetchall()}
    conn.close()
    return result


def _finalize_x4_localized_string(text: str | None) -> str | None:
    """
    After resolving {page,id}, apply the same visible unescaping as before, then
    strip X4 ship-class size markers. In t files the game uses e.g. \\(small\\)S
    (escaped parens) so the UI shows only the size letter S. Naive \\ unescape
    yields '(small)S' in JSON; in-game it reads 'PAR S Racing Engine…'.
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
    Keep in sync with generate_ships.resolve (incl. _finalize_x4_localized_string).
    """
    if not ref or _depth > 4:
        return None
    if not ref.startswith("{") and not ref.startswith("("):
        return _finalize_x4_localized_string(ref)

    text = ref
    hint = None

    if text.startswith("("):
        close = text.find("){")
        if close != -1:
            hint = text[1:close]
            text = text[close + 1:]

    if "{" not in text:
        return _finalize_x4_localized_string(hint or text)

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
                    return _finalize_x4_localized_string(hint)
            except ValueError:
                pass

    joined = " ".join(p.strip() for p in result_parts if p.strip())
    result = joined if joined else hint
    return _finalize_x4_localized_string(result)


# ---------------------------------------------------------------------------
# Step 2 — Parse libraries/wares.xml for equipment ware data
# ---------------------------------------------------------------------------

# Tags that identify each equipment category in wares.xml
EQUIP_TAG_GROUPS = {
    "engine equipment":    "engines",
    "equipment shield":    "shields",
    "equipment weapon":    "weapons",
    "equipment turret":    "turrets",
}
# Thrusters share the "engine equipment" tag but have 'thruster' in their macro name.
# We handle the disambiguation at parse time.


def load_equipment_wares(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Parses libraries/wares.xml across all layers and returns a dict keyed by macro name.

    Vanilla (00_VANILLA) is the base file. DLC files use Egosoft's <diff> format;
    only <add sel="/wares"> blocks are processed — they contain new equipment wares.

    Each entry contains:
      price           {min, average, max} | None
      owners          [faction_id, ...]
      player_usable   bool (True if <restriction> element is present)
      name_ref        string ref | None  (for fallback; macro XML has it too)
      description_ref string ref | None  (lore text)
    """
    wares: dict[str, dict] = {}

    def _process_ware(ware: ET.Element) -> None:
        tags = ware.get("tags", "")
        tag_set = set(tags.split())
        if "equipment" not in tag_set or "ship" in tag_set:
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
        wares[macro_name] = {
            "price":           price,
            "owners":          owners,
            "player_usable":   restriction is not None,
            "name_ref":        ware.get("name"),
            "description_ref": ware.get("description"),
        }

    for layer_dir in layer_dirs:
        p = layer_dir / "libraries" / "wares.xml"
        if not p.exists():
            continue
        tree = ET.parse(p)
        root_el = tree.getroot()

        if root_el.tag == "wares":
            for ware in root_el.iter("ware"):
                _process_ware(ware)
        elif root_el.tag == "diff":
            for add_el in root_el.findall("add"):
                if add_el.get("sel") == "/wares":
                    for ware in add_el:
                        _process_ware(ware)

    return wares


# ---------------------------------------------------------------------------
# Step 3 — Bullet macro cache (weapons/turrets only)
# ---------------------------------------------------------------------------

def build_bullet_index(layer_dirs: list[Path]) -> dict[str, dict]:
    """
    Pre-parses all bullet_*_macro.xml files from assets/fx/weaponfx/macros/ across all layers.
    Returns a dict keyed by bullet macro name. Later layers override earlier ones.

    Each entry contains the stats needed for DPS/range computation:
      speed, lifetime, range_m, amount, barrelamount
      damage_hull, damage_shield
      reload_rate, reload_time
      heat_value
      weapon_system
      chargetime (beam weapons)
      icon
    """
    index: dict[str, dict] = {}

    all_paths: list[Path] = []
    for layer_dir in layer_dirs:
        bullet_dir = layer_dir / "assets" / "fx" / "weaponfx" / "macros"
        if bullet_dir.exists():
            all_paths.extend(bullet_dir.glob("bullet_*_macro.xml"))

    for path in all_paths:
        try:
            tree = ET.parse(path)
        except ET.ParseError:
            continue

        root = tree.getroot()
        macro_el = root.find("macro")
        if macro_el is None or macro_el.get("class") != "bullet":
            continue

        macro_name = macro_el.get("name", "")
        props = macro_el.find("properties")
        if props is None:
            continue

        bullet_el  = props.find("bullet")
        damage_el  = props.find("damage")
        reload_el  = props.find("reload")
        heat_el    = props.find("heat")
        weapon_el  = props.find("weapon")

        def f(el, attr, default=None):
            if el is None:
                return default
            v = el.get(attr)
            if v is None:
                return default
            try:
                return float(v)
            except ValueError:
                return default

        speed      = f(bullet_el, "speed")
        lifetime   = f(bullet_el, "lifetime")
        # Some bullets have an explicit range attribute (beams)
        range_m    = f(bullet_el, "range")
        amount     = int(f(bullet_el, "amount", 1))
        barreln    = int(f(bullet_el, "barrelamount", 1))
        icon       = bullet_el.get("icon") if bullet_el is not None else None
        chargetime = f(bullet_el, "chargetime")

        damage_hull   = f(damage_el, "value")
        damage_shield = f(damage_el, "shield")

        reload_rate = f(reload_el, "rate")
        reload_time = f(reload_el, "time")

        heat_value  = f(heat_el, "value")
        weapon_sys  = weapon_el.get("system") if weapon_el is not None else None

        # Compute effective range in km:
        # - Use explicit range_m if present (beams)
        # - Else: speed * lifetime / 1000
        if range_m is not None:
            range_km = round(range_m / 1000, 2)
        elif speed is not None and lifetime is not None:
            range_km = round(speed * lifetime / 1000, 2)
        else:
            range_km = None

        # Compute DPS — effective rate depends on weapon type:
        # - Pulse/laser weapons: reload_rate = shots per second
        #   DPS = damage_per_shot * reload_rate
        # - Beam weapons: reload_time = total fire cycle duration
        #   DPS ≈ damage / reload_time  (approximation; beams deal continuous damage)
        # - Turrets with both rate+time: use rate
        effective_rate = reload_rate if reload_rate else (1.0 / reload_time if reload_time else None)

        def dps(dmg):
            if dmg is None or effective_rate is None or effective_rate <= 0:
                return None
            return round(dmg * effective_rate * amount * barreln, 1)

        index[macro_name] = {
            "speed":          speed,
            "lifetime":       lifetime,
            "range_km":       range_km,
            "amount":         amount,
            "barrelamount":   barreln,
            "icon":           icon,
            "chargetime":     chargetime,
            "damage_hull":    damage_hull,
            "damage_shield":  damage_shield,
            "reload_rate":    reload_rate,
            "reload_time":    reload_time,
            "heat_value":     heat_value,
            "weapon_system":  weapon_sys,
            "dps_hull":       dps(damage_hull),
            "dps_shield":     dps(damage_shield),
        }

    return index


# ---------------------------------------------------------------------------
# Step 4 — Helpers
# ---------------------------------------------------------------------------

def extract_size(macro_name: str) -> str | None:
    """
    Derives the canonical size from the macro name.
    Pattern: {category}_{faction}_{size}_{...}
    e.g. engine_arg_l_allround_01_mk1_macro → 'l'
         weapon_bor_xs_burst_01_mk1_macro   → 'xs'
    """
    parts = macro_name.split("_")
    if len(parts) >= 3:
        candidate = parts[2]
        if candidate in SIZE_CANONICAL:
            return candidate
    return None


def extract_weapon_type(macro_name: str) -> str | None:
    """
    Derives the weapon/turret type from the macro name.
    Pattern: {weapon|turret}_{faction}_{size}_{TYPE}_{...}
    e.g. weapon_arg_m_ion_01_mk1_macro → 'ion'
         turret_arg_l_beam_01_mk1_macro → 'beam'
    """
    parts = macro_name.split("_")
    if len(parts) >= 4:
        return parts[3]
    return None


def parse_ident(props_el, attr: str) -> str | None:
    ident = props_el.find("identification") if props_el is not None else None
    return ident.get(attr) if ident is not None else None


def float_attr(el, attr: str, default=None):
    if el is None:
        return default
    v = el.get(attr)
    if v is None:
        return default
    try:
        return float(v)
    except ValueError:
        return default


def int_attr(el, attr: str, default=None):
    v = float_attr(el, attr)
    return int(v) if v is not None else default


# ---------------------------------------------------------------------------
# Step 5 — Per-category parsers
# ---------------------------------------------------------------------------

def parse_engine_macro(path: Path) -> dict | None:
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return None

    root = tree.getroot()
    macro_el = root.find("macro")
    if macro_el is None or macro_el.get("class") != "engine":
        return None

    macro_name = macro_el.get("name", "")
    # Skip thrusters — they share the same folder and class="engine"
    if macro_name.startswith("thruster_"):
        return None

    props = macro_el.find("properties")
    if props is None:
        return None

    boost_el  = props.find("boost")
    travel_el = props.find("travel")
    thrust_el = props.find("thrust")
    hull_el   = props.find("hull")

    def boost_f(attr):
        return float_attr(boost_el, attr)

    def travel_f(attr):
        return float_attr(travel_el, attr)

    boost = None
    if boost_el is not None:
        boost = {k: boost_f(k) for k in ("duration", "recharge", "thrust", "acceleration", "attack", "release", "coast") if boost_f(k) is not None}

    travel = None
    if travel_el is not None:
        travel = {k: travel_f(k) for k in ("charge", "thrust", "attack", "release") if travel_f(k) is not None}

    thrust = None
    if thrust_el is not None:
        thrust = {k: float_attr(thrust_el, k) for k in ("forward", "reverse") if float_attr(thrust_el, k) is not None}

    return {
        "macro_id":    macro_name,
        "name_ref":    parse_ident(props, "name"),
        "basename_ref": parse_ident(props, "basename"),
        "faction":     parse_ident(props, "makerrace"),
        "mk":          int_attr(props.find("identification"), "mk"),
        "hull":        int_attr(hull_el, "max"),
        "boost":       boost,
        "travel":      travel,
        "thrust":      thrust,
    }


def parse_thruster_macro(path: Path) -> dict | None:
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return None

    root = tree.getroot()
    macro_el = root.find("macro")
    if macro_el is None or macro_el.get("class") != "engine":
        return None

    macro_name = macro_el.get("name", "")
    if not macro_name.startswith("thruster_"):
        return None

    props = macro_el.find("properties")
    if props is None:
        return None

    thrust_el  = props.find("thrust")
    angular_el = props.find("angular")

    thrust = None
    if thrust_el is not None:
        thrust = {k: float_attr(thrust_el, k) for k in ("strafe", "pitch", "yaw", "roll") if float_attr(thrust_el, k) is not None}

    angular = None
    if angular_el is not None:
        angular = {k: float_attr(angular_el, k) for k in ("roll", "pitch") if float_attr(angular_el, k) is not None}

    return {
        "macro_id":     macro_name,
        "name_ref":     parse_ident(props, "name"),
        "basename_ref": parse_ident(props, "basename"),
        "faction":      parse_ident(props, "makerrace"),  # usually None for thrusters
        "mk":           int_attr(props.find("identification"), "mk"),
        "thrust":       thrust,
        "angular":      angular,
    }


def parse_shield_macro(path: Path) -> dict | None:
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return None

    root = tree.getroot()
    macro_el = root.find("macro")
    if macro_el is None or macro_el.get("class") != "shieldgenerator":
        return None

    macro_name = macro_el.get("name", "")
    props      = macro_el.find("properties")
    if props is None:
        return None

    recharge_el = props.find("recharge")
    hull_el     = props.find("hull")

    recharge = None
    if recharge_el is not None:
        recharge = {
            "max":   int_attr(recharge_el, "max"),
            "rate":  float_attr(recharge_el, "rate"),
            "delay": float_attr(recharge_el, "delay"),
        }

    return {
        "macro_id":     macro_name,
        "name_ref":     parse_ident(props, "name"),
        "basename_ref": parse_ident(props, "basename"),
        "faction":      parse_ident(props, "makerrace"),
        "mk":           int_attr(props.find("identification"), "mk"),
        "hull":         int_attr(hull_el, "max"),
        "recharge":     recharge,
    }


def parse_weapon_macro(path: Path, is_turret: bool) -> dict | None:
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return None

    root = tree.getroot()
    macro_el = root.find("macro")
    if macro_el is None:
        return None

    expected_class = "turret" if is_turret else "weapon"
    if macro_el.get("class") != expected_class:
        return None

    macro_name = macro_el.get("name", "")
    props      = macro_el.find("properties")
    if props is None:
        return None

    bullet_el   = props.find("bullet")
    hull_el     = props.find("hull")
    rot_el      = props.find("rotationspeed")
    # Some turrets carry their own reload (rate + time)
    reload_el   = props.find("reload")

    bullet_class = bullet_el.get("class") if bullet_el is not None else None

    return {
        "macro_id":       macro_name,
        "name_ref":       parse_ident(props, "name"),
        "basename_ref":   parse_ident(props, "basename"),
        "faction":        parse_ident(props, "makerrace"),
        "mk":             int_attr(props.find("identification"), "mk"),
        "hull":           int_attr(hull_el, "max"),
        "bullet_macro":   bullet_class,
        "rotation_speed": float_attr(rot_el, "max"),
        # Some weapon macros carry a reload (turrets mostly)
        "macro_reload_rate": float_attr(reload_el, "rate"),
        "macro_reload_time": float_attr(reload_el, "time"),
    }


# ---------------------------------------------------------------------------
# Step 6 — Assemble one item from raw + wares + strings
# ---------------------------------------------------------------------------

def assemble_base(raw: dict, wares: dict, strings: dict) -> dict:
    """Common fields shared by all equipment categories."""
    macro_name = raw["macro_id"]
    ware       = wares.get(macro_name, {})

    name_ref    = raw.get("name_ref") or ware.get("name_ref")
    desc_ref    = ware.get("description_ref")

    return {
        "macro_id":     macro_name,
        "name":         resolve(name_ref, strings) or macro_name,
        "basename":     resolve(raw.get("basename_ref"), strings),
        "description":  resolve(desc_ref, strings),
        "faction":      raw.get("faction"),
        "size":         extract_size(macro_name),
        "mk":           raw.get("mk"),
        "price":        ware.get("price"),
        "owners":       ware.get("owners", []),
        "player_usable": ware.get("player_usable", False),
    }


# ---------------------------------------------------------------------------
# Step 7 — Main generate function
# ---------------------------------------------------------------------------

def generate(xml_root: Path, db_path: Path, out_dir: Path) -> None:

    layer_dirs = _layer_dirs(xml_root)

    print(f"XML root   : {xml_root}")
    print(f"Layers     : {[d.name for d in layer_dirs]}")
    print(f"DB         : {db_path}")
    print(f"Output     : {out_dir}")
    print()

    # ── Shared resources ────────────────────────────────────────────────────

    print("[1/6] Loading strings from DB...")
    strings = load_strings(db_path)
    print(f"      {len(strings):,} strings loaded.")

    print("[2/6] Indexing equipment wares across all layers (vanilla + DLC diffs)...")
    wares = load_equipment_wares(layer_dirs)
    print(f"      {len(wares)} equipment wares indexed.")

    print("[3/6] Building bullet index across all layers...")
    bullets = build_bullet_index(layer_dirs)
    print(f"      {len(bullets)} bullet macros indexed.")

    # ── Engines ─────────────────────────────────────────────────────────────

    print("[4/6] Parsing equipment macros...")

    engines: list[dict] = []
    thrusters: list[dict] = []
    engine_paths: list[Path] = []
    for layer_dir in layer_dirs:
        d = layer_dir / "assets" / "props" / "engines" / "macros"
        if d.exists():
            engine_paths.extend(d.glob("*_macro.xml"))
    for path in sorted(engine_paths):
        macro_name = path.stem  # filename without .xml
        if macro_name.startswith("thruster_"):
            raw = parse_thruster_macro(path)
            if raw:
                item = assemble_base(raw, wares, strings)
                item["thrust"]  = raw.get("thrust")
                item["angular"] = raw.get("angular")
                thrusters.append(item)
        elif macro_name.startswith("engine_"):
            raw = parse_engine_macro(path)
            if raw:
                item = assemble_base(raw, wares, strings)
                item["hull"]   = raw.get("hull")
                item["boost"]  = raw.get("boost")
                item["travel"] = raw.get("travel")
                item["thrust"] = raw.get("thrust")
                engines.append(item)

    print(f"      Engines: {len(engines)}, Thrusters: {len(thrusters)}")

    # ── Shields ─────────────────────────────────────────────────────────────

    shields: list[dict] = []
    shield_paths: list[Path] = []
    for layer_dir in layer_dirs:
        d = layer_dir / "assets" / "props" / "surfaceelements" / "macros"
        if d.exists():
            shield_paths.extend(d.glob("shield_*_macro.xml"))
    for path in sorted(shield_paths):
        raw = parse_shield_macro(path)
        if raw:
            item = assemble_base(raw, wares, strings)
            item["hull"]     = raw.get("hull")
            item["recharge"] = raw.get("recharge")
            shields.append(item)

    print(f"      Shields: {len(shields)}")

    # ── Weapons & Turrets ───────────────────────────────────────────────────

    weapons: list[dict] = []
    turrets: list[dict] = []

    weapon_macro_dirs: list[Path] = []
    for layer_dir in layer_dirs:
        wp = layer_dir / "assets" / "props" / "weaponsystems"
        if wp.exists():
            weapon_macro_dirs.extend(wp.rglob("macros"))
    for macros_dir in sorted(weapon_macro_dirs):
        for path in sorted(macros_dir.glob("*_macro.xml")):
            stem = path.stem
            is_turret = stem.startswith("turret_")
            is_weapon = stem.startswith("weapon_")
            if not is_turret and not is_weapon:
                continue

            raw = parse_weapon_macro(path, is_turret=is_turret)
            if raw is None:
                continue

            item = assemble_base(raw, wares, strings)
            item["is_turret"]    = is_turret
            item["weapon_type"]  = extract_weapon_type(stem)
            item["hull"]         = raw.get("hull")
            item["rotation_speed"] = raw.get("rotation_speed")
            item["bullet_macro"] = raw.get("bullet_macro")

            # Merge bullet stats
            bdata = bullets.get(raw.get("bullet_macro", ""), {})

            # For turrets that carry their own reload (overrides bullet reload)
            macro_rate = raw.get("macro_reload_rate")
            macro_time = raw.get("macro_reload_time")

            reload_rate = macro_rate or bdata.get("reload_rate")
            reload_time = macro_time or bdata.get("reload_time")

            damage_hull   = bdata.get("damage_hull")
            damage_shield = bdata.get("damage_shield")
            amount        = bdata.get("amount", 1)
            barreln       = bdata.get("barrelamount", 1)

            # Recompute DPS if turret overrides reload
            if macro_rate or macro_time:
                effective_rate = reload_rate if reload_rate else (1.0 / reload_time if reload_time else None)
                def dps(dmg):
                    if dmg is None or effective_rate is None or effective_rate <= 0:
                        return None
                    return round(dmg * effective_rate * amount * barreln, 1)
                dps_hull   = dps(damage_hull)
                dps_shield = dps(damage_shield)
            else:
                dps_hull   = bdata.get("dps_hull")
                dps_shield = bdata.get("dps_shield")

            item["bullet"] = {
                "speed":       bdata.get("speed"),
                "lifetime":    bdata.get("lifetime"),
                "chargetime":  bdata.get("chargetime"),
                "amount":      amount,
                "barrelamount": barreln,
                "icon":        bdata.get("icon"),
            }
            item["damage"] = {
                "hull":   damage_hull,
                "shield": damage_shield,
            }
            item["reload"] = {
                "rate": reload_rate,
                "time": reload_time,
            }
            item["heat_value"]    = bdata.get("heat_value")
            item["weapon_system"] = bdata.get("weapon_system")
            item["range_km"]      = bdata.get("range_km")
            item["dps_hull"]      = dps_hull
            item["dps_shield"]    = dps_shield

            if is_turret:
                turrets.append(item)
            else:
                weapons.append(item)

    print(f"      Weapons: {len(weapons)}, Turrets: {len(turrets)}")

    # ── Write output ─────────────────────────────────────────────────────────

    print("[5/6] Assembling catalog...")
    catalog = {
        "engines":   engines,
        "shields":   shields,
        "thrusters": thrusters,
        "weapons":   weapons,
        "turrets":   turrets,
    }

    total = sum(len(v) for v in catalog.values())

    print("[6/6] Writing output...")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "equipment.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    size_kb = out_path.stat().st_size / 1024
    print(f"      Written: {out_path}  ({size_kb:.0f} KB, {total} total items)")
    print()

    # ── Validation report ────────────────────────────────────────────────────

    def count_missing(items, field):
        return sum(1 for i in items if i.get(field) is None)

    def count_player(items):
        return sum(1 for i in items if i.get("player_usable"))

    print("=== Validation report ===")
    for cat, items in catalog.items():
        no_price   = count_missing(items, "price")
        no_name    = sum(1 for i in items if i["name"] == i["macro_id"])
        player_cnt = count_player(items)
        print(f"  {cat:<12}: {len(items):3} items | player_usable: {player_cnt:3} | no price: {no_price:3} | unresolved name: {no_name}")

    # Extra check for weapons: missing bullet data
    no_bullet  = sum(1 for w in weapons + turrets if w.get("dps_hull") is None)
    print(f"  weapons+turrets with no DPS: {no_bullet}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate catalog/equipment.json from X4 XML extractions.")
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
