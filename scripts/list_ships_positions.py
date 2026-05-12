#!/usr/bin/env python3
"""
list_ships_positions.py — Liste tous les vaisseaux joueur avec leurs coordonnées.
Usage: python scripts/list_ships_positions.py <save.xml> [--csv]
"""
import argparse
import sys
from pathlib import Path
from xml.etree.ElementTree import iterparse

def list_ships(xml_path: Path):
    ships = []
    current = None   # ship en cours de lecture
    in_offset = False
    offset_done = False

    for event, elem in iterparse(xml_path, events=("start", "end")):
        if event == "start":
            cls = elem.get("class", "")

            if cls.startswith("ship_") and elem.get("owner") == "player":
                current = {
                    "code":    elem.get("code", ""),
                    "macro":   elem.get("macro", "").replace("_macro", ""),
                    "class":   cls,
                    "thruster": elem.get("thruster", "").replace("_macro", ""),
                    "x": None, "y": None, "z": None,
                }
                in_offset = False
                offset_done = False

            elif current and not offset_done:
                if elem.tag == "offset":
                    in_offset = True
                elif in_offset and elem.tag == "position":
                    current["x"] = elem.get("x", "0")
                    current["y"] = elem.get("y", "0")
                    current["z"] = elem.get("z", "0")
                    offset_done = True
                    in_offset = False

        elif event == "end":
            cls = elem.get("class", "")
            if cls.startswith("ship_") and elem.get("owner") == "player":
                if current:
                    ships.append(current)
                current = None
                offset_done = False
            elem.clear()

    return ships


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    parser.add_argument("--csv", action="store_true")
    args = parser.parse_args()

    if not args.save.is_file():
        sys.exit(f"Fichier introuvable : {args.save}")

    print(f"Lecture de {args.save.name}…", flush=True)
    ships = list_ships(args.save)

    if args.csv:
        out = args.save.with_suffix(".ships.csv")
        with out.open("w", encoding="utf-8") as f:
            f.write("code,class,macro,x,y,z,thruster\n")
            for s in ships:
                f.write(f"{s['code']},{s['class']},{s['macro']},{s['x']},{s['y']},{s['z']},{s['thruster']}\n")
        print(f"{len(ships)} vaisseaux -> {out}")
    else:
        print(f"\n{'CODE':<12} {'CLASS':<12} {'X':>10} {'Y':>8} {'Z':>10}  MACRO")
        print("-" * 80)
        for s in ships:
            x = s['x'] or "0"
            y = s['y'] or "0"
            z = s['z'] or "0"
            print(f"{s['code']:<12} {s['class']:<12} {float(x):>10.2f} {float(y):>8.2f} {float(z):>10.2f}  {s['macro']}")
        print(f"\nTotal : {len(ships)} vaisseaux")


if __name__ == "__main__":
    main()
