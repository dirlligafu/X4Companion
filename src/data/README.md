# src/data/

## icon_catalogue.json

Mappe chaque nom d'asset (`engine_arg_m_allround_01_mk1_macro`) vers son URL publique (`/modules_and_upgrades/engine_arg_m_allround_01_mk1_macro.png`).

**Source :** les PNGs dans `public/` sont extraits manuellement des archives du jeu (X4: Foundations) via `scripts/catalog/convert_icons.py`, puis indexés par `scripts/catalog/build_icon_catalogue.py`.

**Dossiers couverts** (sous-dossiers de `public/`) :
- `modules_and_upgrades` — moteurs, boucliers, armes, tourelles, propulseurs
- `paintmods_images` — peintures
- `ship_images` — silhouettes de vaisseaux
- `station_modules` — modules de station
- `ware_images` — marchandises

**Exclus intentionnellement** : `faction_logos`, `map_objects` (gérés séparément).

**Régénérer après ajout de PNGs :**
```bash
# Ajuster PUBLIC_DIR et OUTPUT_FILE dans le CONFIG si nécessaire
python scripts/catalog/build_icon_catalogue.py
```

Le fichier généré contient 1 475 entrées (build 498349, v1.34.0).
