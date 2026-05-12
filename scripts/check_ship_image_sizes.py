"""
Check dimensions of all ship images in public/ship_images/.
Uses only stdlib (no Pillow needed) — reads PNG header directly.
"""
import struct
import zlib
from pathlib import Path
from collections import Counter

IMG_DIR = Path(__file__).parent.parent / "public" / "ship_images"


def read_png_dimensions(path: Path) -> tuple[int, int]:
    """Extract width/height from PNG IHDR chunk (bytes 16-24). No full decode."""
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"Not a PNG: {path.name}")
        f.read(4)  # chunk length
        chunk_type = f.read(4)
        if chunk_type != b"IHDR":
            raise ValueError(f"IHDR not found: {path.name}")
        w = struct.unpack(">I", f.read(4))[0]
        h = struct.unpack(">I", f.read(4))[0]
    return w, h


results = []
errors = []

for img in sorted(IMG_DIR.glob("*.png")):
    try:
        w, h = read_png_dimensions(img)
        results.append((img.name, w, h))
    except Exception as e:
        errors.append((img.name, str(e)))

# Summary by unique dimension
dim_counts = Counter((w, h) for _, w, h in results)
non_square = [(name, w, h) for name, w, h in results if w != h]

print(f"Total images : {len(results)}")
print(f"\nDimensions uniques :")
for (w, h), count in sorted(dim_counts.items()):
    square = "OK carre" if w == h else "NON carre"
    print(f"  {w}x{h}  -  {count} image(s)  [{square}]")

if non_square:
    print(f"\nImages non carrées ({len(non_square)}) :")
    for name, w, h in non_square:
        print(f"  {name}  ->  {w}x{h}")
else:
    print("\nToutes les images sont carrees.")

if errors:
    print(f"\nErreurs ({len(errors)}) :")
    for name, err in errors:
        print(f"  {name} : {err}")
