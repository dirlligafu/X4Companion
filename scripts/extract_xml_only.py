#!/usr/bin/env python
"""
extract_xml_only.py — Supprime tous les fichiers NON-XML des dossiers d'extraction
X4 (vanilla + DLCs), puis supprime les dossiers vides restants.

Réduit typiquement ~27 Go (textures + audio + shaders) à ~175 Mo (XML seuls).
Opération destructive et irréversible — à lancer sur une extraction que l'on peut refaire.

Usage:
    python scripts/extract_xml_only.py
    python scripts/extract_xml_only.py --root C:/autre/chemin
"""

import argparse
from pathlib import Path

DEFAULT_ROOT = Path(r"C:\DEVS\REACT\X4-Extractions")


def purge_non_xml(directory: Path) -> tuple[int, int]:
    """Purge non-XML files and empty dirs in directory. Returns (deleted_files, removed_dirs)."""
    non_xml = [f for f in directory.rglob("*") if f.is_file() and f.suffix.lower() != ".xml"]
    total = len(non_xml)
    print(f"\n[{directory.name}]  {total} fichiers non-XML à supprimer…")

    for i, f in enumerate(non_xml, 1):
        f.unlink()
        if i % 10000 == 0 or i == total:
            print(f"  {i}/{total} ({i * 100 // total}%)")

    empty = 0
    for d in sorted(directory.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            empty += 1

    size_mb = sum(f.stat().st_size for f in directory.rglob("*.xml")) / (1024 * 1024)
    xml_count = sum(1 for _ in directory.rglob("*.xml"))
    print(f"  → {xml_count} XML conservés, {empty} dossiers vides retirés, {size_mb:.1f} Mo restants.")
    return total, empty


def main(root: Path) -> None:
    if not root.is_dir():
        raise SystemExit(f"Dossier introuvable : {root}")

    # Process only numbered DLC/vanilla subdirs (e.g. 00_VANILLA, 01_SPLIT_VENDETTA…)
    subdirs = sorted([d for d in root.iterdir() if d.is_dir() and d.name[0].isdigit()])
    if not subdirs:
        raise SystemExit(f"Aucun sous-dossier numéroté trouvé dans : {root}")

    print(f"Racine     : {root}")
    print(f"Sous-dossiers trouvés ({len(subdirs)}) : {', '.join(d.name for d in subdirs)}")

    total_deleted = total_dirs = 0
    for d in subdirs:
        deleted, dirs = purge_non_xml(d)
        total_deleted += deleted
        total_dirs += dirs

    print(f"\n=== Terminé. {total_deleted} fichiers supprimés, {total_dirs} dossiers vides retirés. ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Purge les fichiers non-XML des extractions X4.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    main(args.root)
