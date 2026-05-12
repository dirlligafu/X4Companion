#!/usr/bin/env python
"""
build_icon_catalogue.py — Build a JSON index of all extracted PNGs in public/.

Output: { "stem_name": "/folder/stem_name.png", ... }
Consumers use this to resolve an asset name to its local URL.

Edit the CONFIG section below to adapt to your needs.
"""
from __future__ import annotations

import json
from pathlib import Path

# =============================================================================
# CONFIG
# =============================================================================

PUBLIC_DIR  = Path(r"C:\DEVS\REACT\X4\public")
OUTPUT_FILE = Path(r"C:\DEVS\REACT\X4\src\data\icon_catalogue.json")

# Subfolders to skip (managed elsewhere)
SKIP_DIRS = {"faction_logos", "map_objects"}

# =============================================================================

def main() -> None:
    catalogue: dict[str, str] = {}

    for folder in sorted(PUBLIC_DIR.iterdir()):
        if not folder.is_dir() or folder.name in SKIP_DIRS:
            continue

        pngs = sorted(folder.glob("*.png"))
        for png in pngs:
            key = png.stem
            url = f"/{folder.name}/{png.name}"
            catalogue[key] = url

        if pngs:
            print(f"  {folder.name}: {len(pngs)} PNGs")

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2, ensure_ascii=False)

    print(f"\nDone: {len(catalogue)} entries -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
