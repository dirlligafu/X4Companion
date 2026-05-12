"""
Streaming scan of X4 save XML: counts components and rebuilds cluster → sector counts.
Memory-safe: uses iterparse + elem.clear().
"""
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from collections import Counter


def main(path: str) -> None:
    class_counts: Counter[str] = Counter()
    # Stack of {class, id, macro, code, sector_ids}
    stack: list[dict] = []
    clusters_out: list[dict] = []
    max_clusters_store = 200_000

    ctx = ET.iterparse(path, events=("start", "end"))

    for event, elem in ctx:
        if event == "start":
            if elem.tag == "component":
                cls = elem.get("class")
                if cls:
                    class_counts[cls] += 1
                if cls in ("galaxy", "cluster", "sector", "zone"):
                    frame = {
                        "class": cls,
                        "id": elem.get("id"),
                        "macro": elem.get("macro"),
                        "code": elem.get("code"),
                        "sector_ids": [],
                    }
                    if cls == "sector":
                        for f in reversed(stack):
                            if f["class"] == "cluster":
                                sid = elem.get("id")
                                if sid:
                                    f["sector_ids"].append(sid)
                                break
                    stack.append(frame)
        else:
            if elem.tag == "component":
                cls = elem.get("class")
                if cls in ("galaxy", "cluster", "sector", "zone") and stack and stack[-1]["class"] == cls:
                    popped = stack.pop()
                    if cls == "cluster" and len(clusters_out) < max_clusters_store:
                        clusters_out.append(
                            {
                                "id": popped.get("id"),
                                "macro": popped.get("macro"),
                                "code": popped.get("code"),
                                "n_sectors": len(popped["sector_ids"]),
                            }
                        )
        # clear() uniquement en fin de nœud : sur "start" il supprimerait les enfants non encore parcourus.
        if event == "end":
            elem.clear()

    print("=== Top 25 component@class counts (all <component> in file) ===")
    for name, n in class_counts.most_common(25):
        print(f"  {name}: {n}")

    print()
    print(f"=== Galaxy / cluster / sector / zone (from nested stack) ===")
    for key in ("galaxy", "cluster", "sector", "zone"):
        print(f"  {key}: {class_counts.get(key, 0)}")

    print()
    print(f"=== Clusters recorded on close: {len(clusters_out)} ===")
    if not clusters_out:
        return

    n_sec = [c["n_sectors"] for c in clusters_out]
    print(f"  Sectors per cluster (min / max / avg): {min(n_sec)} / {max(n_sec)} / {sum(n_sec)/len(n_sec):.2f}")

    print()
    print("=== Sample: first 8 clusters ===")
    for c in clusters_out[:8]:
        print(f"  id={c['id']} macro={c['macro']!r} code={c['code']!r} sectors={c['n_sectors']}")

    print()
    print("=== Sample: 5 clusters with most sectors ===")
    top = sorted(clusters_out, key=lambda x: -x["n_sectors"])[:5]
    for c in top:
        print(f"  id={c['id']} macro={c['macro']!r} sectors={c['n_sectors']}")


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else r"c:\DEVS\REACT\X4\src\save_020.xml"
    main(p)
