"""
Scan all ship templates and collect:
- Internal storage capacity (shipstorage_gen_*) by size + count
- External docking pads (dockarea subtree -> dockingbay children) by size
"""

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict

TEMPLATES_DIR = Path(__file__).parent.parent / "src-tauri/resources/ship_templates"

# shipstorage_gen_{size}_{count}_macro  e.g. shipstorage_gen_s_six_macro
WORD_TO_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "twelve": 12, "sixteen": 16, "twentyfour": 24, "twentyeight": 28,
    "thirty": 30, "sixtyfour": 64, "seventytwo": 72,
}
RE_STORAGE = re.compile(r"shipstorage_gen_(\w+)_(\w+)_macro")
RE_PAD     = re.compile(r"dockingbay_\w+_([smlx]+)_\d+")

def parse_storage_macro(macro: str) -> tuple[str, int] | None:
    m = RE_STORAGE.match(macro)
    if not m:
        return None
    size  = m.group(1).upper()   # xs, s, m, l
    count_word = m.group(2)
    count = WORD_TO_NUM.get(count_word) or (int(count_word) if count_word.isdigit() else None)
    return (size, count) if count else None

def pad_size(macro: str) -> str | None:
    m = RE_PAD.match(macro)
    if not m:
        return None
    raw = m.group(1)
    return {"xs": "XS", "s": "S", "m": "M", "l": "L", "xl": "XL"}.get(raw)

results: dict[str, dict] = {}

for xml_file in sorted(TEMPLATES_DIR.rglob("*.xml")):
    try:
        tree = ET.parse(xml_file)
    except ET.ParseError:
        continue

    ship = xml_file.stem
    storage: dict[str, int] = {}   # size -> count  (internal hangars)
    pads:    dict[str, int] = {}   # size -> count  (external pads)

    for elem in tree.iter("component"):
        cls   = elem.get("class", "")
        macro = elem.get("macro", "")

        # --- internal storage ---
        if cls == "dockingbay" and macro.startswith("shipstorage_gen_"):
            parsed = parse_storage_macro(macro)
            if parsed:
                size, count = parsed
                storage[size] = storage.get(size, 0) + count

        # --- external docking pads (descend into dockarea subtree) ---
        elif cls == "dockarea":
            for child in elem.iter("component"):
                if child.get("class") == "dockingbay":
                    size = pad_size(child.get("macro", ""))
                    if size:
                        pads[size] = pads.get(size, 0) + 1

    if storage or pads:
        results[ship] = {"storage": storage, "pads": pads}

# --- print ---
print(f"{'Ship':<50} {'Internal storage':<30} {'External pads'}")
print("-" * 100)
for ship, data in sorted(results.items()):
    storage_str = ", ".join(f"{c}x{s}" for s, c in sorted(data["storage"].items())) or "-"
    pads_str    = ", ".join(f"{c}x{s}" for s, c in sorted(data["pads"].items()))    or "-"
    if storage_str != "-" or pads_str != "-":
        print(f"{ship:<50} {storage_str:<30} {pads_str}")
