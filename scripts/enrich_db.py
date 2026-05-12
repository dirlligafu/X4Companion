#!/usr/bin/env python
"""
enrich_db.py — Enrichit x4_data.db avec les données physiques manquantes.

Nouvelles colonnes :
  ships        : mass, drag_forward, drag_reverse, drag_pitch, drag_yaw, drag_roll,
                 inertia_pitch, inertia_yaw, inertia_roll
  weapon_stats : bullet_lifetime

Usage :
  python scripts/enrich_db.py
  python scripts/enrich_db.py --db path/to/x4_data.db --xml C:/DEVS/REACT/X4-Extractions/OUTPUT
"""
from __future__ import annotations

import argparse
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def add_column_if_missing(cur: sqlite3.Cursor, table: str, column: str, coltype: str) -> None:
    cur.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cur.fetchall()}
    if column not in existing:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def float_or_none(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Step 1 — Ship physics
# ---------------------------------------------------------------------------

def extract_ship_physics(xml_root: Path) -> dict[str, dict]:
    """
    Parcourt assets/units/size_*/macros/ship_*_macro.xml.
    Retourne { macro_name: { mass, drag_forward, drag_reverse, drag_pitch,
                              drag_yaw, drag_roll, inertia_pitch, inertia_yaw, inertia_roll } }
    """
    results: dict[str, dict] = {}
    units_dir = xml_root / "assets" / "units"

    macro_files = list(units_dir.glob("size_*/macros/ship_*_macro.xml"))
    print(f"  Ship macro XMLs trouvés : {len(macro_files)}")

    for path in macro_files:
        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            print(f"    [WARN] Parse error {path.name}: {e}")
            continue

        for macro in tree.iter("macro"):
            name = macro.get("name")
            if not name:
                continue

            physics = macro.find(".//physics")
            if physics is None:
                continue

            drag    = physics.find("drag")
            inertia = physics.find("inertia")

            results[name] = {
                "mass":          float_or_none(physics.get("mass")),
                "drag_forward":  float_or_none(drag.get("forward"))  if drag is not None else None,
                "drag_reverse":  float_or_none(drag.get("reverse"))  if drag is not None else None,
                "drag_pitch":    float_or_none(drag.get("pitch"))    if drag is not None else None,
                "drag_yaw":      float_or_none(drag.get("yaw"))      if drag is not None else None,
                "drag_roll":     float_or_none(drag.get("roll"))     if drag is not None else None,
                "inertia_pitch": float_or_none(inertia.get("pitch")) if inertia is not None else None,
                "inertia_yaw":   float_or_none(inertia.get("yaw"))   if inertia is not None else None,
                "inertia_roll":  float_or_none(inertia.get("roll"))  if inertia is not None else None,
            }

    return results


# ---------------------------------------------------------------------------
# Step 2 — Weapon → bullet reference
# ---------------------------------------------------------------------------

def extract_weapon_bullet_refs(xml_root: Path) -> dict[str, str]:
    """
    Parcourt tous les weapon_*_macro.xml.
    Retourne { weapon_macro_name: bullet_macro_name }
    """
    refs: dict[str, str] = {}
    weapon_files = (
        list(xml_root.glob("assets/props/weaponsystems/**/macros/weapon_*_macro.xml")) +
        list(xml_root.glob("assets/props/weaponsystems/**/macros/turret_*_macro.xml"))
    )
    print(f"  Weapon/turret macro XMLs trouves : {len(weapon_files)}")

    for path in weapon_files:
        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            print(f"    [WARN] Parse error {path.name}: {e}")
            continue

        for macro in tree.iter("macro"):
            name = macro.get("name")
            if not name:
                continue
            bullet_el = macro.find(".//bullet")
            if bullet_el is not None:
                bullet_class = bullet_el.get("class")
                if bullet_class:
                    refs[name] = bullet_class

    return refs


# ---------------------------------------------------------------------------
# Step 3 — Bullet lifetime
# ---------------------------------------------------------------------------

def extract_bullet_lifetimes(xml_root: Path) -> dict[str, float]:
    """
    Parcourt assets/fx/weaponfx/macros/bullet_*_macro.xml.
    Retourne { bullet_macro_name: lifetime }
    """
    lifetimes: dict[str, float] = {}
    bullet_files = list(xml_root.glob("assets/fx/weaponfx/macros/bullet_*_macro.xml"))
    print(f"  Bullet macro XMLs trouvés : {len(bullet_files)}")

    for path in bullet_files:
        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            print(f"    [WARN] Parse error {path.name}: {e}")
            continue

        for macro in tree.iter("macro"):
            name = macro.get("name")
            if not name:
                continue
            bullet_el = macro.find(".//bullet")
            if bullet_el is not None:
                lt = float_or_none(bullet_el.get("lifetime"))
                if lt is not None:
                    lifetimes[name] = lt

    return lifetimes


# ---------------------------------------------------------------------------
# Step 4 — Write to DB
# ---------------------------------------------------------------------------

def enrich_database(db_path: Path, xml_root: Path) -> None:
    print(f"\n=== DB : {db_path} ===")
    if not db_path.exists():
        print("  [SKIP] Fichier introuvable.")
        return

    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()

    # ── Ajout des colonnes manquantes ──────────────────────────────────────
    print("\n[1/4] Ajout des colonnes manquantes…")
    ship_cols = [
        ("mass",          "REAL"),
        ("drag_forward",  "REAL"),
        ("drag_reverse",  "REAL"),
        ("drag_pitch",    "REAL"),
        ("drag_yaw",      "REAL"),
        ("drag_roll",     "REAL"),
        ("inertia_pitch", "REAL"),
        ("inertia_yaw",   "REAL"),
        ("inertia_roll",  "REAL"),
    ]
    for col, coltype in ship_cols:
        add_column_if_missing(cur, "ships", col, coltype)

    add_column_if_missing(cur, "weapon_stats", "bullet_lifetime", "REAL")
    conn.commit()
    print("  Colonnes OK.")

    # ── Extraction XML ─────────────────────────────────────────────────────
    print("\n[2/4] Extraction physique vaisseaux…")
    ship_physics = extract_ship_physics(xml_root)
    print(f"  {len(ship_physics)} macros lues.")

    print("\n[3/4] Extraction bullet lifetimes…")
    weapon_bullet_refs = extract_weapon_bullet_refs(xml_root)
    bullet_lifetimes   = extract_bullet_lifetimes(xml_root)
    print(f"  {len(weapon_bullet_refs)} weapon->bullet refs, {len(bullet_lifetimes)} lifetimes.")

    # ── UPDATE ships ───────────────────────────────────────────────────────
    print("\n[4/4] Mise à jour de la DB…")

    cur.execute("SELECT macro FROM ships")
    ship_macros = [row[0] for row in cur.fetchall()]

    ships_updated = 0
    for macro in ship_macros:
        data = ship_physics.get(macro)
        if data is None:
            continue
        cur.execute("""
            UPDATE ships SET
                mass          = ?,
                drag_forward  = ?,
                drag_reverse  = ?,
                drag_pitch    = ?,
                drag_yaw      = ?,
                drag_roll     = ?,
                inertia_pitch = ?,
                inertia_yaw   = ?,
                inertia_roll  = ?
            WHERE macro = ?
        """, (
            data["mass"],
            data["drag_forward"],
            data["drag_reverse"],
            data["drag_pitch"],
            data["drag_yaw"],
            data["drag_roll"],
            data["inertia_pitch"],
            data["inertia_yaw"],
            data["inertia_roll"],
            macro,
        ))
        ships_updated += 1

    print(f"  ships mis à jour : {ships_updated}/{len(ship_macros)}")

    # ── UPDATE weapon_stats ────────────────────────────────────────────────
    cur.execute("SELECT macro FROM weapon_stats")
    weapon_macros = [row[0] for row in cur.fetchall()]

    weapons_updated = 0
    for macro in weapon_macros:
        bullet_macro = weapon_bullet_refs.get(macro)
        if bullet_macro is None:
            continue
        lifetime = bullet_lifetimes.get(bullet_macro)
        if lifetime is None:
            continue
        cur.execute(
            "UPDATE weapon_stats SET bullet_lifetime = ? WHERE macro = ?",
            (lifetime, macro)
        )
        weapons_updated += 1

    print(f"  weapon_stats mis à jour : {weapons_updated}/{len(weapon_macros)}")

    conn.commit()
    conn.close()
    print("  DB sauvegardée.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Enrichit x4_data.db avec physique vaisseaux + bullet lifetimes.")
    parser.add_argument("--xml", default=r"C:\DEVS\REACT\X4-Extractions\OUTPUT",
                        help="Dossier racine des extractions XML")
    parser.add_argument("--db",  default=None,
                        help="Chemin unique vers x4_data.db (optionnel, sinon met à jour les deux)")
    args = parser.parse_args()

    xml_root = Path(args.xml)

    if args.db:
        dbs = [Path(args.db)]
    else:
        dbs = [
            Path(r"C:\DEVS\REACT\X4\src-tauri\resources\x4_data.db"),
            Path(r"C:\DEVS\REACT\X4-Extractions\OUTPUT\x4_data.db"),
        ]

    for db_path in dbs:
        enrich_database(db_path, xml_root)

    print("\nTerminé.")


if __name__ == "__main__":
    main()
