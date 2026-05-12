#!/usr/bin/env python3
"""
extract_all_ships.py — Extrait tous les vaisseaux joueur d'une save, un fichier par macro.
Par défaut : première occurrence par macro uniquement.
Avec --all  : toutes les occurrences, nommées {macro}_{code}.xml

Usage:
  python scripts/extract_all_ships.py <save.xml> --out-dir <dossier>
  python scripts/extract_all_ships.py <save.xml> --out-dir <dossier> --all
"""
import argparse
import sys
from pathlib import Path
from xml.etree.ElementTree import iterparse, tostring


def extract_all_ships(xml_path: Path, out_dir: Path, all_occurrences: bool):
    out_dir.mkdir(parents=True, exist_ok=True)

    seen_macros: set[str] = set()
    written = 0
    skipped = 0

    # state
    current_root  = None
    current_macro = ""
    current_code  = ""
    capture_depth = 0
    global_depth  = 0

    for event, elem in iterparse(xml_path, events=("start", "end")):
        if event == "start":
            global_depth += 1

            if current_root is None:
                cls = elem.get("class", "")
                if cls.startswith("ship_") and elem.get("owner") == "player":
                    current_root  = elem
                    current_macro = elem.get("macro", "unknown")
                    current_code  = elem.get("code",  "unknown")
                    capture_depth = global_depth
            # else: inside a capture, iterparse builds the subtree automatically

        elif event == "end":
            if current_root is not None and elem is current_root:
                # decide filename
                macro_clean = current_macro.replace("_macro", "")
                if all_occurrences:
                    filename = f"{macro_clean}_{current_code}.xml"
                else:
                    if current_macro in seen_macros:
                        skipped += 1
                        current_root = None
                        elem.clear()
                        global_depth -= 1
                        continue
                    filename = f"{macro_clean}.xml"

                seen_macros.add(current_macro)
                out_path = out_dir / filename
                out_path.write_text(tostring(elem, encoding="unicode"), encoding="utf-8")
                written += 1
                print(f"  [{written}] {filename}")

                current_root = None
                elem.clear()
            elif current_root is None:
                elem.clear()

            global_depth -= 1

    return written, skipped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--all", dest="all_occurrences", action="store_true",
                        help="Extraire toutes les occurrences (pas seulement la première par macro)")
    args = parser.parse_args()

    if not args.save.is_file():
        sys.exit(f"Fichier introuvable : {args.save}")

    out_dir = args.out_dir or args.save.parent / "ships"
    print(f"Extraction depuis {args.save.name} → {out_dir}")

    written, skipped = extract_all_ships(args.save, out_dir, args.all_occurrences)
    print(f"\nTerminé : {written} fichiers écrits, {skipped} doublons ignorés.")


if __name__ == "__main__":
    main()
