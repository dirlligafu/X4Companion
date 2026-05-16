mod ship_inject;
mod ship_inspect;
mod ship_xml;
#[macro_use]
pub mod catalog;
pub mod database;
#[macro_use]
pub mod parser;
pub mod station;
pub mod types;
#[macro_use]
pub mod writer;

pub use types::*;
use database::ensure_game_db;
use catalog::{
    CatalogCache,
    ensure_fittings_dir, get_blueprint_labels, get_catalog_metadata, get_equipment_catalog,
    get_faction_names, get_gates_catalog, get_highways_catalog, get_inventory_catalog,
    get_mod_recipes, get_mod_stats, get_module_cargo_index, get_research_catalog,
    get_sector_names, get_sectors_catalog, get_ship_labels, get_ships_catalog,
    get_stations_catalog, get_template_loadout, get_ware_cargo_info, get_ware_labels,
    list_ship_templates, load_fitting_from_path, open_dictionaries, save_fitting,
};
use parser::{parse_player_messages, parse_player_research, parse_player_stats, parse_save_basics};
use writer::apply_edits;

use std::fs;
use std::path::Path;
use tauri::Manager;

pub(crate) fn validate_save_path(path: &str) -> Result<(), String> {
    if !path.ends_with(".xml") && !path.ends_with(".xml.gz") {
        return Err(format!("Extension invalide : le chemin doit se terminer par .xml ou .xml.gz"));
    }
    if !Path::new(path).exists() {
        return Err(format!("Fichier introuvable : {path}"));
    }
    Ok(())
}

#[tauri::command]
fn ping() -> String {
    "pong from Rust".to_string()
}

#[tauri::command]
fn extract_player_ship_xml(path: String, code: String) -> Result<String, String> {
    validate_save_path(&path)?;
    ship_xml::extract_player_ship_subtree(&path, &code)
}

#[tauri::command]
fn inspect_player_ship(path: String, code: String) -> Result<ship_inspect::ShipInspect, String> {
    validate_save_path(&path)?;
    ship_inspect::inspect_player_ship(&path, &code)
}

#[tauri::command]
fn inject_ships(app: tauri::AppHandle, save_path: String, template_names: Vec<String>) -> Result<Vec<String>, String> {
    validate_save_path(&save_path)?;
    if template_names.is_empty() {
        return Err("Aucun template sélectionné.".to_string());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir : {e}"))?
        .join("resources")
        .join("ship_templates");

    let loc = ship_inject::find_player_location(&save_path)?;
    let max_id = ship_inject::scan_max_hex_id(&save_path)?;
    let mut next_id = max_id + 1;

    let mut occupied = loc.occupied.clone();
    let mut ship_xmls: Vec<String> = Vec::new();
    let mut codes: Vec<String> = Vec::new();

    for (i, template_name) in template_names.iter().enumerate() {
        let tpl_path = if std::path::Path::new(template_name.as_str()).is_absolute() {
            std::path::PathBuf::from(template_name.as_str())
        } else {
            resource_dir.join(format!("{}.xml", template_name))
        };
        let template_xml = fs::read_to_string(&tpl_path)
            .map_err(|e| format!("Template '{}' introuvable : {e}", template_name))?;

        let seed = next_id.wrapping_add(i as u64);
        let (spawn_x, spawn_z) = ship_inject::pick_position(loc.x, loc.z, &occupied, seed, 500.0);
        occupied.push((spawn_x, spawn_z));

        let c1 = (b'A' + ((next_id >> 4)  % 26) as u8) as char;
        let c2 = (b'A' + ((next_id >> 8)  % 26) as u8) as char;
        let c3 = (b'A' + ((next_id >> 12) % 26) as u8) as char;
        let num = next_id % 1000;
        let new_code = format!("{}{}{}-{:03}", c1, c2, c3, num);

        let ship_xml = ship_inject::prepare_ship_xml(&template_xml, &new_code, &mut next_id, spawn_x, spawn_z);
        codes.push(new_code);
        ship_xmls.push(ship_xml);
    }

    ship_inject::inject_into_save_batch(&save_path, &ship_xmls, &loc.tempzone_id)?;
    Ok(codes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(CatalogCache::default())
        .setup(|app| {
            ensure_game_db(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping, parse_save_basics, parse_player_stats, parse_player_messages, get_ware_labels, get_blueprint_labels, get_faction_names, get_ship_labels, get_sector_names, apply_edits, extract_player_ship_xml, inspect_player_ship, get_inventory_catalog, get_ships_catalog, get_equipment_catalog, open_dictionaries, get_sectors_catalog, get_highways_catalog, get_gates_catalog, get_stations_catalog,
            list_ship_templates, inject_ships, get_module_cargo_index, get_ware_cargo_info, get_template_loadout, save_fitting, load_fitting_from_path, get_mod_stats, get_mod_recipes, ensure_fittings_dir, parse_player_research, get_research_catalog, get_catalog_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
