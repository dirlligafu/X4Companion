#!/usr/bin/env python3
"""
Analyse rapide d'extraits XML de station X4 (souvent une seule ligne).
Usage:
  python scripts/saves/analyze_station_xml.py _SAVES/MY_SUPPLIER.xml _SAVES/MY_WARF.xml
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path


def read_xml(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _attr(tag_open: str, name: str) -> str:
    m = re.search(rf'{name}="([^"]*)"', tag_open)
    return m.group(1) if m else ""


def station_header(s: str) -> dict[str, str]:
    m = re.search(r"<component\s+class=\"station\"([^>]*>)", s)
    if not m:
        return {"error": "no station component"}
    attrs = m.group(1)
    code, name, owner, macro = _attr(attrs, "code"), _attr(attrs, "name"), _attr(attrs, "owner"), _attr(attrs, "macro")
    if code or name:
        return {"macro": macro, "code": code, "name": name, "owner": owner}
    return {"raw_open": attrs[:220] + ("..." if len(attrs) > 220 else "")}


def iter_storage_blocks(s: str) -> list[dict]:
    """Découpe chaque <component class="storage" ...>...</component> (non imbriqué dans un autre storage)."""
    out: list[dict] = []
    for m in re.finditer(
        r'<component\s+class="storage"([^>]*>)((?:(?!</component>).)*?)</component>',
        s,
        flags=re.DOTALL,
    ):
        open_attrs = m.group(1)
        inner = m.group(2)
        macro = re.search(r'macro="([^"]*)"', open_attrs)
        conn = re.search(r'connection="([^"]*)"', open_attrs)
        cid = re.search(r'id="([^"]*)"', open_attrs)
        has_cargo = "<cargo" in inner
        wares = re.findall(r'<ware\s+ware="([^"]+)"(?:\s+amount="([^"]*)")?\s*/>', inner)
        amounts = {w: int(a) if a else 1 for w, a in wares}
        out.append(
            {
                "macro": macro.group(1) if macro else "?",
                "connection": conn.group(1) if conn else "?",
                "id": cid.group(1) if cid else "",
                "has_cargo": has_cargo,
                "ware_lines": len(wares),
                "volume_units": sum(amounts.values()),
                "ware_amounts": amounts,
            }
        )
    return out


def build_queue_summary(s: str) -> dict:
    if "<buildtasks" not in s:
        return {"buildtasks": False}
    builds = re.findall(
        r'<build\s+[^>]*type="([^"]*)"[^>]*builder="([^"]*)"[^>]*faction="([^"]*)"[^>]*price="([^"]*)"',
        s,
    )
    insuf_blocks = re.findall(r"<insufficient>(.*?)</insufficient>", s, flags=re.DOTALL)
    insuf_wares: Counter[str] = Counter()
    for block in insuf_blocks:
        for wm in re.finditer(r'<ware\s+ware="([^"]+)"\s+amount="([^"]+)"', block):
            insuf_wares[wm.group(1)] += 1  # count occurrences, not sum amounts (sentinels)
    return {
        "buildtasks": True,
        "build_entries": len(builds),
        "build_types": Counter(b[0] for b in builds),
        "insufficient_blocks": len(insuf_blocks),
        "distinct_wares_in_insufficient": len(insuf_wares),
    }


def cargo_wares_by_connection(storages: list[dict]) -> tuple[Counter[str], Counter[str], Counter[str]]:
    """Compte les wares dans chaque bloc cargo, par connection."""
    space_w: Counter[str] = Counter()
    ship_w: Counter[str] = Counter()
    other_w: Counter[str] = Counter()
    for st in storages:
        if not st["has_cargo"] or not st.get("ware_amounts"):
            continue
        conn = st["connection"]
        target = ship_w if conn == "shipconnection" else space_w if conn == "space" else other_w
        for w, amt in st["ware_amounts"].items():
            target[w] += amt
    return space_w, ship_w, other_w


def analyze(path: Path) -> None:
    s = read_xml(path)
    print(f"\n{'=' * 72}\nFILE: {path} ({len(s):,} chars)\n{'=' * 72}")
    hdr = station_header(s)
    if "code" in hdr:
        print(f"Station: {hdr['name']}  code={hdr['code']}  owner={hdr['owner']}")
        print(f"  macro: {hdr['macro']}")
    else:
        print("Station (header parse):", hdr)

    storages = iter_storage_blocks(s)
    print(f"\n--- Storage modules ({len(storages)}) ---")
    by_conn = Counter(st["connection"] for st in storages)
    print("By connection:", dict(by_conn))
    with_cargo = sum(1 for st in storages if st["has_cargo"])
    print(f"With <cargo>: {with_cargo} / {len(storages)}")

    for i, st in enumerate(storages, 1):
        flag = "cargo" if st["has_cargo"] else "empty"
        print(
            f"  {i:2} [{st['connection'][:16]:16}] {st['macro'][:52]:52} {flag:5} "
            f"wares={st['ware_lines']:3} sum_units={st['volume_units']}"
        )

    sw, shw, ow = cargo_wares_by_connection(storages)
    print("\n--- Cargo totals by connection (sum of ware amounts) ---")
    print(f"  space:           {len(sw)} distinct wares, total units {sum(sw.values()):,}")
    print(f"  shipconnection:  {len(shw)} distinct wares, total units {sum(shw.values()):,}")
    if ow:
        print(f"  other conn:      {len(ow)} distinct wares, total units {sum(ow.values()):,}")

    bq = build_queue_summary(s)
    print("\n--- Build / orders (station) ---")
    if bq.get("buildtasks"):
        print(f"  buildtasks: yes -- {bq['build_entries']} <build> tags (summary attrs)")
        print(f"  build types: {dict(bq['build_types'])}")
        print(f"  <insufficient> blocks: {bq['insufficient_blocks']}")
        print(f"  distinct ware ids inside insufficient: {bq['distinct_wares_in_insufficient']}")
    else:
        print("  buildtasks: not found")

    oc = len(re.findall(r"<orders>", s))
    print(f"  '<orders>' occurrences (often ships): {oc}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Analyse structure station dans XML save (extrait).")
    ap.add_argument("paths", nargs="+", type=Path, help="Chemins vers .xml")
    args = ap.parse_args()
    for p in args.paths:
        if not p.is_file():
            print(f"Skip (not a file): {p}", file=sys.stderr)
            continue
        analyze(p.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
