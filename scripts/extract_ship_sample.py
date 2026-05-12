#!/usr/bin/env python3
"""
extract_ship_sample.py — Extrait un ou plusieurs vaisseaux par code depuis une save XML.
Produit pour chaque code : le subtree complet du vaisseau + le chemin d'ancêtres.
Usage:
  python scripts/extract_ship_sample.py <save.xml> EOW-473 UZF-603
"""
import argparse
import sys
from pathlib import Path
from xml.etree.ElementTree import iterparse, tostring

ANCESTOR_KEEP = 8

def fmt_tag(elem) -> str:
    attrs = {k: v for k, v in elem.items()
             if k in ("class", "macro", "name", "owner", "code", "id")}
    attr_str = " ".join(f'{k}="{v}"' for k, v in attrs.items())
    return f"<{elem.tag} {attr_str}>" if attr_str else f"<{elem.tag}>"


def extract_ships_by_code(xml_path: Path, codes: set[str]) -> dict[str, dict]:
    results   = {}
    ancestors = []        # stack of open elems (not cleared while capturing)
    capturing = {}        # code -> {"root": elem, "depth": int, "ancestors": [...]}
    depth     = 0

    context = iterparse(xml_path, events=("start", "end"))

    for event, elem in context:
        if event == "start":
            depth += 1
            code = elem.get("code", "")
            if code in codes and code not in results and code not in capturing:
                capturing[code] = {
                    "root":      elem,
                    "depth":     depth,
                    "ancestors": [fmt_tag(a) for a in ancestors[-ANCESTOR_KEEP:]],
                }
            ancestors.append(elem)

        elif event == "end":
            ancestors.pop()
            closed_code = None
            for code, info in capturing.items():
                if elem is info["root"]:
                    results[code] = {
                        "ancestors": info["ancestors"],
                        "subtree":   tostring(elem, encoding="unicode"),
                    }
                    closed_code = code
                    break
            if closed_code:
                del capturing[closed_code]
            # only clear if not inside a capturing subtree
            elif not any(depth >= info["depth"] for info in capturing.values()):
                elem.clear()
            depth -= 1

            if len(results) == len(codes):
                break

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("save", type=Path)
    parser.add_argument("codes", nargs="+")
    parser.add_argument("--out-dir", type=Path, default=None)
    args = parser.parse_args()

    if not args.save.is_file():
        sys.exit(f"Fichier introuvable : {args.save}")

    out_dir = args.out_dir or args.save.parent
    codes   = set(args.codes)

    print(f"Recherche de {codes} dans {args.save.name}…")
    found = extract_ships_by_code(args.save, codes)

    for code, data in found.items():
        out_path = out_dir / f"sample_{code.replace('-','_')}.xml"
        ancestors_comment = "<!-- Ancêtres :\n" + "\n".join(
            f"  {'  ' * i}{a}" for i, a in enumerate(data["ancestors"])
        ) + "\n-->\n"
        out_path.write_text(ancestors_comment + data["subtree"], encoding="utf-8")
        print(f"  {code} -> {out_path}  ({len(data['subtree']):,} chars)")
        print(f"    Ancetres : {' > '.join(data['ancestors'])}")

    missing = codes - set(found)
    if missing:
        print(f"Non trouvés : {missing}")


if __name__ == "__main__":
    main()
