use crate::database::{game_db_path, load_strings, resolve_refs};
use crate::parser::{collect_attrs, get};
use crate::station::{load_module_cargo_map_from_path, load_ware_cargo_map_from_path};
use crate::types::*;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::Serialize;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

pub struct CatalogCache {
    pub ships:     Mutex<Option<Vec<ShipCatalogItem>>>,
    pub equipment: Mutex<Option<EquipmentCatalog>>,
    pub research:  Mutex<Option<Vec<ResearchEntry>>>,
    pub sectors:   Mutex<Option<SectorsCatalog>>,
    pub mod_stats: Mutex<Option<Vec<ModStat>>>,
}

impl Default for CatalogCache {
    fn default() -> Self {
        Self {
            ships:     Mutex::new(None),
            equipment: Mutex::new(None),
            research:  Mutex::new(None),
            sectors:   Mutex::new(None),
            mod_stats: Mutex::new(None),
        }
    }
}
#[tauri::command]
pub fn get_catalog_metadata(app: tauri::AppHandle) -> Result<CatalogMetadata, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("metadata.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture metadata.json impossible : {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide metadata.json : {e}"))
}

/// Retourne { factionID -> name } depuis resources/factions.json
#[tauri::command]
pub fn get_faction_names(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("factions.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture factions.json impossible : {e}"))?;

    let items: Vec<Value> =
        serde_json::from_str(&content).map_err(|e| format!("JSON invalide : {e}"))?;

    let map = items
        .iter()
        .filter_map(|item| {
            let id = item["id"].as_str()?.to_string();
            let name = item["name"].as_str()?.to_string();
            Some((id, name))
        })
        .collect();

    Ok(map)
}

/// Retourne { wareID -> {label, category} } depuis resources/blueprints.json
#[tauri::command]
pub fn get_blueprint_labels(app: tauri::AppHandle) -> Result<HashMap<String, BlueprintInfo>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("blueprints.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture blueprints.json impossible : {e}"))?;

    let items: Vec<Value> =
        serde_json::from_str(&content).map_err(|e| format!("JSON invalide : {e}"))?;

    let map = items
        .iter()
        .filter_map(|item| {
            let id = item["wareID"].as_str()?.to_string();
            let label = item["label"].as_str()?.to_string();
            let category = item["categoryID"].as_str()?.to_string();
            Some((id, BlueprintInfo { label, category }))
        })
        .collect();

    Ok(map)
}

/// Retourne { macro_id -> name } depuis resources/catalog/ships.json
#[tauri::command]
pub fn get_ship_labels(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("ships.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/ships.json impossible : {e}"))?;

    let items: Vec<Value> =
        serde_json::from_str(&content).map_err(|e| format!("JSON invalide : {e}"))?;

    let map = items
        .iter()
        .filter_map(|item| {
            let raw = item["macro_id"].as_str()?;
            let id = raw.strip_suffix("_macro").unwrap_or(raw).to_string();
            let label = item["name"].as_str()?.to_string();
            Some((id, label))
        })
        .collect();

    Ok(map)
}

/// Retourne { macroID_sans_suffix -> { capacity, types } } depuis resources/modules.json
#[tauri::command]
pub fn get_module_cargo_index(app: tauri::AppHandle) -> Result<HashMap<String, ModuleCargoInfo>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("modules.json");
    load_module_cargo_map_from_path(&path)
}

/// Retourne { wareID -> label } depuis resources/wares.json
#[tauri::command]
pub fn get_ware_labels(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("wares.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture wares.json impossible : {e}"))?;

    let items: Vec<Value> =
        serde_json::from_str(&content).map_err(|e| format!("JSON invalide : {e}"))?;

    let map = items
        .iter()
        .filter_map(|item| {
            let id = item["wareID"].as_str()?.to_string();
            let label = item["label"].as_str()?.to_string();
            Some((id, label))
        })
        .collect();

    Ok(map)
}


/// Retourne { wareID -> { volume, transport } } depuis resources/wares.json
#[tauri::command]
pub fn get_ware_cargo_info(app: tauri::AppHandle) -> Result<HashMap<String, WareCargoInfo>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("wares.json");
    load_ware_cargo_map_from_path(&path)
}

/// Retourne { macroID -> sectorName } depuis resources/catalog/sectors.json.
/// Aplatit la hiérarchie clusters/sectors et normalise les clés en minuscules.
#[tauri::command]
pub fn get_sector_names(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("sectors.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/sectors.json impossible : {e}"))?;

    let root: Value = serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide : {e}"))?;

    let mut map = HashMap::new();
    if let Some(clusters) = root["clusters"].as_array() {
        for cluster in clusters {
            if let (Some(macro_id), Some(name)) = (cluster["macro"].as_str(), cluster["name"].as_str()) {
                map.insert(macro_id.to_lowercase(), name.to_string());
            }
            if let Some(sectors) = cluster["sectors"].as_array() {
                for sector in sectors {
                    if let (Some(macro_id), Some(name)) = (sector["macro"].as_str(), sector["name"].as_str()) {
                        map.insert(macro_id.to_lowercase(), name.to_string());
                    }
                }
            }
        }
    }
    Ok(map)
}

/// Retourne le catalogue complet de l'équipement depuis catalog/equipment.json.
/// Lit le fichier une seule fois et retourne les 4 catégories.
#[tauri::command]
pub fn get_equipment_catalog(
    state: tauri::State<CatalogCache>,
    app: tauri::AppHandle,
) -> Result<EquipmentCatalog, String> {
    #[derive(Deserialize)]
    struct RawCatalog {
        weapons:   Vec<WeaponCatalogItem>,
        turrets:   Vec<WeaponCatalogItem>,
        engines:   Vec<EngineCatalogItem>,
        shields:   Vec<ShieldCatalogItem>,
        thrusters: Vec<ThrusterCatalogItem>,
    }

    let mut guard = state.equipment.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources")
        .join("catalog")
        .join("equipment.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture equipment.json : {e}"))?;
    let raw: RawCatalog = serde_json::from_str(&content)
        .map_err(|e| format!("Parse equipment.json : {e}"))?;
    let mut weapons = raw.weapons;
    weapons.extend(raw.turrets);
    let catalog = EquipmentCatalog {
        weapons,
        engines:   raw.engines,
        shields:   raw.shields,
        thrusters: raw.thrusters,
    };
    *guard = Some(catalog.clone());
    Ok(catalog)
}

/// Crée (si besoin) et retourne le chemin du dossier des fittings custom.
#[tauri::command]
pub fn ensure_fittings_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("resources")
        .join("custom_fittings");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("create_dir_all: {e}"))?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "chemin non-UTF8".to_string())
}

/// Retourne tous les mods d'équipement depuis catalog/mod_stats.json.
#[tauri::command]
pub fn get_mod_stats(
    state: tauri::State<CatalogCache>,
    app: tauri::AppHandle,
) -> Result<Vec<ModStat>, String> {
    let mut guard = state.mod_stats.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources")
        .join("catalog")
        .join("mod_stats.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture mod_stats.json : {e}"))?;
    let items: Vec<ModStat> = serde_json::from_str(&content)
        .map_err(|e| format!("Parse mod_stats.json : {e}"))?;
    *guard = Some(items.clone());
    Ok(items)
}

/// Retourne les recettes de crafting des mods depuis catalog/mod_recipes.json.
#[tauri::command]
pub fn get_mod_recipes(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources")
        .join("catalog")
        .join("mod_recipes.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture mod_recipes.json : {e}"))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Parse mod_recipes.json : {e}"))
}

#[tauri::command]
pub fn get_research_catalog(
    state: tauri::State<CatalogCache>,
    app: tauri::AppHandle,
) -> Result<Vec<ResearchEntry>, String> {
    let mut guard = state.research.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources")
        .join("catalog")
        .join("research.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture research.json : {e}"))?;
    let items: Vec<ResearchEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("Parse research.json : {e}"))?;
    *guard = Some(items.clone());
    Ok(items)
}

/// Retourne le catalogue complet des items d'inventaire depuis x4_data.db,
/// avec les noms résolus depuis la table strings (résolution applicative).
#[tauri::command]
pub fn get_inventory_catalog(app: tauri::AppHandle) -> Result<Vec<InventoryCatalogItem>, String> {
    let db_path = game_db_path(&app)
        .ok_or("Impossible de localiser x4_data.db")?;

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Ouverture DB : {e}"))?;
    let strings = load_strings(&conn)?;

    // Charger les items et résoudre les noms
    let mut stmt = conn.prepare(
        "SELECT id, name_ref, group_id, tags, price FROM inventory_items
         WHERE tags LIKE '%inventory%'
         ORDER BY group_id, id"
    ).map_err(|e| format!("Prepare items : {e}"))?;

    let items = stmt.query_map([], |row| {
        let id:       String         = row.get(0)?;
        let name_ref: Option<String> = row.get(1)?;
        let group_id: Option<String> = row.get(2)?;
        let tags:     Option<String> = row.get(3)?;
        let price:    Option<i64>    = row.get(4)?;
        Ok((id, name_ref, group_id, tags, price))
    })
    .map_err(|e| format!("Query items : {e}"))?
    .flatten()
    .map(|(id, name_ref, group_id, tags, price)| {
        let name = match &name_ref {
            Some(r) => resolve_refs(r, &strings),
            None    => id.clone(),
        };
        InventoryCatalogItem { id, name, group_id, tags, price }
    })
    .collect();

    Ok(items)
}

/// Retourne le catalogue complet des vaisseaux depuis resources/catalog/ships.json.
/// Les noms sont déjà résolus à la génération. outfitting_allowed est absent du struct
/// et sera chargé à la demande par get_ship_outfitting() quand le fitting tool existera.
#[tauri::command]
pub fn get_ships_catalog(
    state: tauri::State<CatalogCache>,
    app: tauri::AppHandle,
) -> Result<Vec<ShipCatalogItem>, String> {
    let mut guard = state.ships.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("ships.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/ships.json impossible : {e}"))?;
    let items: Vec<ShipCatalogItem> = serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/ships.json : {e}"))?;
    *guard = Some(items.clone());
    Ok(items)
}

/// Retourne le catalogue complet clusters/secteurs depuis resources/catalog/sectors.json.
#[tauri::command]
pub fn get_sectors_catalog(
    state: tauri::State<CatalogCache>,
    app: tauri::AppHandle,
) -> Result<SectorsCatalog, String> {
    let mut guard = state.sectors.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return Ok(cached.clone());
    }
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("sectors.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/sectors.json impossible : {e}"))?;
    let catalog: SectorsCatalog = serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/sectors.json : {e}"))?;
    *guard = Some(catalog.clone());
    Ok(catalog)
}

/// Retourne les superhighways depuis resources/catalog/highways.json.
#[tauri::command]
pub fn get_highways_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("highways.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/highways.json impossible : {e}"))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/highways.json : {e}"))
}

/// Retourne les jump gates depuis resources/catalog/gates.json.
#[tauri::command]
pub fn get_gates_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("gates.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/gates.json impossible : {e}"))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/gates.json : {e}"))
}

/// Retourne les stations fixes depuis resources/catalog/stations.json.
#[tauri::command]
pub fn get_stations_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("stations.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/stations.json impossible : {e}"))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/stations.json : {e}"))
}

/// Parse un template de vaisseau et retourne { connectionName → macroId }.
/// Le thruster (attribut racine) est mappé sur "con_thruster_01".
/// Retourne une map vide si le fichier n'existe pas (pas de template pour ce vaisseau).
#[tauri::command]
pub fn get_template_loadout(
    app: tauri::AppHandle,
    size: String,
    macro_name: String,
) -> Result<HashMap<String, String>, String> {
    let size_dir = match size.as_str() {
        "xs" | "s" => "small",
        "m"        => "medium",
        "l"        => "large",
        "xl"       => "x-large",
        _          => return Ok(HashMap::new()),
    };
    let base = macro_name.strip_suffix("_macro").unwrap_or(&macro_name);
    let path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources").join("ship_templates").join(size_dir).join(format!("{base}.xml"));

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("read: {e}"))?;
    let mut reader = Reader::from_str(&content);
    reader.config_mut().trim_text(true);

    let mut loadout: HashMap<String, String> = HashMap::new();
    let mut pending_con: Option<String> = None;
    let mut root_done = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let attrs = collect_attrs(e.attributes());
                match e.name().as_ref() {
                    b"component" => {
                        if !root_done {
                            root_done = true;
                            if let Some(t) = get(&attrs, "thruster") {
                                loadout.insert("con_thruster_01".to_string(), t);
                            }
                        } else if let Some(con) = pending_con.take() {
                            if let Some(m) = get(&attrs, "macro") {
                                loadout.insert(con, m);
                            }
                        }
                    }
                    b"connection" => {
                        let con = get(&attrs, "connection").unwrap_or_default();
                        pending_con = if con.starts_with("con_") { Some(con) } else { None };
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"connection" { pending_con = None; }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    Ok(loadout)
}

/// Remplace le macro d'un slot dans le XML en cherchant la connection puis le premier macro= suivant.
fn substitute_slot(xml: &str, connection: &str, old_macro: &str, new_macro: &str) -> String {
    let conn_pat      = format!("connection=\"{}\"", connection);
    let old_macro_pat = format!("macro=\"{}\"", old_macro);
    let new_macro_pat = format!("macro=\"{}\"", new_macro);

    if let Some(conn_pos) = xml.find(&conn_pat) {
        let window_end = (conn_pos + 512).min(xml.len());
        let window     = &xml[conn_pos..window_end];
        if let Some(rel) = window.find(&old_macro_pat) {
            let abs = conn_pos + rel;
            let mut out = String::with_capacity(xml.len());
            out.push_str(&xml[..abs]);
            out.push_str(&new_macro_pat);
            out.push_str(&xml[abs + old_macro_pat.len()..]);
            return out;
        }
    }
    xml.to_string()
}

#[tauri::command]
pub fn save_fitting(
    app:             tauri::AppHandle,
    size:            String,
    ship_macro:      String,
    loadout:         HashMap<String, String>,
    default_loadout: HashMap<String, String>,
    save_path:       String,
) -> Result<(), String> {
    let size_dir = match size.as_str() {
        "xs" | "s" => "small",
        "m"        => "medium",
        "l"        => "large",
        "xl"       => "x-large",
        _          => return Err(format!("taille inconnue: {size}")),
    };
    let base = ship_macro.strip_suffix("_macro").unwrap_or(&ship_macro);
    let tpl_path = app.path().resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?
        .join("resources").join("ship_templates").join(size_dir).join(format!("{base}.xml"));

    let mut xml = fs::read_to_string(&tpl_path)
        .map_err(|e| format!("lecture template: {e}"))?;

    for (slot, new_macro) in &loadout {
        let old_macro = match default_loadout.get(slot) {
            Some(m) if m != new_macro => m,
            _ => continue,
        };
        if slot == "con_thruster_01" {
            xml = xml.replacen(
                &format!("thruster=\"{}\"", old_macro),
                &format!("thruster=\"{}\"", new_macro),
                1,
            );
        } else {
            xml = substitute_slot(&xml, slot, old_macro, new_macro);
        }
    }

    let dest = Path::new(&save_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir: {e}"))?;
    }
    fs::write(dest, xml.as_bytes()).map_err(|e| format!("écriture: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
pub struct LoadedFitting {
    ship_macro: String,
    loadout:    HashMap<String, String>,
}

#[tauri::command]
pub fn load_fitting_from_path(path: String) -> Result<LoadedFitting, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("lecture: {e}"))?;
    let mut reader = Reader::from_str(&content);
    reader.config_mut().trim_text(true);

    let mut loadout: HashMap<String, String> = HashMap::new();
    let mut ship_macro = String::new();
    let mut pending_con: Option<String> = None;
    let mut root_done = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let attrs = collect_attrs(e.attributes());
                match e.name().as_ref() {
                    b"component" => {
                        if !root_done {
                            root_done = true;
                            ship_macro = get(&attrs, "macro").unwrap_or_default();
                            if let Some(t) = get(&attrs, "thruster") {
                                loadout.insert("con_thruster_01".to_string(), t);
                            }
                        } else if let Some(con) = pending_con.take() {
                            if let Some(m) = get(&attrs, "macro") {
                                loadout.insert(con, m);
                            }
                        }
                    }
                    b"connection" => {
                        let con = get(&attrs, "connection").unwrap_or_default();
                        pending_con = if con.starts_with("con_") { Some(con) } else { None };
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                if e.name().as_ref() == b"connection" { pending_con = None; }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    Ok(LoadedFitting { ship_macro, loadout })
}

/// Ouvre (ou donne le focus à) la fenêtre Dictionnaires.
#[tauri::command]
pub fn open_dictionaries(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    let label = "dictionaries";
    if let Some(win) = app.get_webview_window(label) {
        win.set_focus().ok();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html".into());
    WebviewWindowBuilder::new(&app, label, url)
        .title("X4 Save Editor — Dictionaries")
        .inner_size(1400.0, 800.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Ouverture fenêtre : {e}"))?;
    Ok(())
}

/// Liste les templates disponibles dans resources/ship_templates/{small,medium,large,x-large}/
#[tauri::command]
pub fn list_ship_templates(app: tauri::AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir : {e}"))?
        .join("resources")
        .join("ship_templates");

    let size_classes = ["small", "medium", "large", "x-large"];
    let mut result: HashMap<String, Vec<String>> = HashMap::new();

    for size in &size_classes {
        let dir = base.join(size);
        let mut names: Vec<String> = match fs::read_dir(&dir) {
            Err(_) => { result.insert(size.to_string(), vec![]); continue; }
            Ok(entries) => entries,
        }
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.ends_with(".xml") {
                    Some(format!("{}/{}", size, name.trim_end_matches(".xml")))
                } else {
                    None
                }
            })
            .collect();
        names.sort();
        result.insert(size.to_string(), names);
    }

    Ok(result)
}