#!/usr/bin/env python
"""
convert_icons.py — Convert X4 icon files to PNG.

Supports two input formats:
  - .dds files (already extracted from .gz)
  - .gz files (gzip-compressed DDS, extracted on the fly)

Edit the CONFIG section below to adapt to your needs.
"""
from __future__ import annotations

import gzip
import io
from pathlib import Path

from PIL import Image

# =============================================================================
# CONFIG — edit these paths and options
# =============================================================================

# Input directory containing .dds or .gz files
INPUT_DIR = Path(r"C:\DEVS\REACT\X4-Extractions\00_VANILLA\assets\textures\ui\map_objects")

# Output directory for PNG files
OUTPUT_DIR = Path(r"C:\DEVS\REACT\X4-Extractions\00_VANILLA\assets\textures\ui\map_objects")

# Input format: "dds" or "gz"
INPUT_FORMAT = "gz"

# =============================================================================

def convert(src: Path, out_dir: Path, fmt: str) -> bool:
    try:
        if fmt == "gz":
            with gzip.open(src, "rb") as f:
                data = f.read()
            img = Image.open(io.BytesIO(data))
        else:
            img = Image.open(src)

        out_path = out_dir / (src.stem + ".png")
        img.save(out_path, "PNG")
        return True
    except Exception as e:
        print(f"  ERROR {src.name}: {e}")
        return False


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    pattern = f"*.{INPUT_FORMAT}"
    files = sorted(INPUT_DIR.glob(pattern))
    if not files:
        print(f"No {pattern} files found in {INPUT_DIR}")
        return

    print(f"Converting {len(files)} {INPUT_FORMAT.upper()} files -> {OUTPUT_DIR}")
    ok = sum(convert(f, OUTPUT_DIR, INPUT_FORMAT) for f in files)
    print(f"Done: {ok}/{len(files)} converted.")


if __name__ == "__main__":
    main()
