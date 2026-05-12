"""
Exporte la hiérarchie universe (galaxy → clusters → sectors → zones) depuis une save X4
en JSON, avec tous les attributs XML de chaque <component>.

Les noms « lisibles » ne sont en général PAS dans la save : ils viennent des fichiers jeu
(CAT/DAT). Option --names-json : fichier type x4-names.json (map macro -> chaîne ou objet).

Usage:
  python export_universe_json.py save.xml -o universe.json
  python export_universe_json.py save.xml -o universe.json --names-json x4-names.json

Mémoire : iterparse + elem.clear() uniquement sur "end".
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from typing import Any


def load_names_map(path: str) -> dict[str, str]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if isinstance(v, str):
            out[k] = v
        elif isinstance(v, dict) and "name" in v and isinstance(v["name"], str):
            out[k] = v["name"]
    return out


def enrich_display_names(galaxy: dict[str, Any], names: dict[str, str]) -> None:
    """Ajoute display_name sur galaxy, chaque cluster / sector / zone (ou null)."""

    def pick(attrs: dict[str, str]) -> str | None:
        macro = attrs.get("macro")
        if macro and macro in names:
            return names[macro]
        # Si le jeu a mis un attribut name (rare sur cluster/sector/zone)
        n = attrs.get("name")
        return n if n else None

    gattrs = galaxy.get("attributes") or {}
    galaxy["display_name"] = pick(gattrs)

    for cl in galaxy.get("clusters", []):
        a = cl.get("attributes") or {}
        cl["display_name"] = pick(a)
        for sec in cl.get("sectors", []):
            sa = sec.get("attributes") or {}
            sec["display_name"] = pick(sa)
            for zn in sec.get("zones", []):
                za = zn.get("attributes") or {}
                zn["display_name"] = pick(za)


def export_universe(
    xml_path: str,
    names_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    galaxy_data: dict[str, Any] | None = None
    # pile ( "cluster" | "sector", node_dict )
    stack: list[tuple[str, dict[str, Any]]] = []

    ctx = ET.iterparse(xml_path, events=("start", "end"))

    for event, elem in ctx:
        if event == "start" and elem.tag == "component":
            cls = elem.get("class")
            att = dict(elem.attrib)
            if cls == "galaxy":
                galaxy_data = {"attributes": att, "clusters": []}
            elif cls == "cluster" and galaxy_data is not None:
                node: dict[str, Any] = {"attributes": att, "sectors": []}
                galaxy_data["clusters"].append(node)
                stack.append(("cluster", node))
            elif cls == "sector" and stack:
                if stack[-1][0] != "cluster":
                    continue
                node = {"attributes": att, "zones": []}
                stack[-1][1]["sectors"].append(node)
                stack.append(("sector", node))
            elif cls == "zone" and stack and stack[-1][0] == "sector":
                stack[-1][1]["zones"].append({"attributes": att})
        elif event == "end" and elem.tag == "component":
            cls = elem.get("class")
            if cls in ("cluster", "sector") and stack and stack[-1][0] == cls:
                stack.pop()
        if event == "end":
            elem.clear()

    if galaxy_data is None:
        raise SystemExit("Aucun <component class=\"galaxy\"> trouvé dans le fichier.")

    enrich_display_names(galaxy_data, names_map or {})

    return {
        "format": "x4_universe_hierarchy_v1",
        "galaxy": galaxy_data,
        "stats": {
            "clusters": len(galaxy_data["clusters"]),
            "sectors": sum(len(c["sectors"]) for c in galaxy_data["clusters"]),
            "zones": sum(
                len(s["zones"])
                for c in galaxy_data["clusters"]
                for s in c["sectors"]
            ),
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Export universe hierarchy from X4 save XML to JSON.")
    p.add_argument("xml_path", help="Chemin vers le .xml de sauvegarde")
    p.add_argument("-o", "--output", required=True, help="Fichier JSON de sortie (- pour stdout)")
    p.add_argument(
        "--names-json",
        help="Optionnel : map macro -> nom (ex. x4-names.json du x4-cat-miner)",
    )
    args = p.parse_args()

    names: dict[str, str] | None = None
    if args.names_json:
        names = load_names_map(args.names_json)

    result = export_universe(args.xml_path, names_map=names)
    result["source_xml"] = args.xml_path

    text = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output == "-":
        sys.stdout.write(text)
        return

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Écrit : {args.output}", file=sys.stderr)
    print(json.dumps(result["stats"], indent=2), file=sys.stderr)


if __name__ == "__main__":
    main()
