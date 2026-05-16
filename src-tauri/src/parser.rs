use crate::database::{game_db_path, load_strings, resolve_ref_chain};
use crate::types::*;
use flate2::read::GzDecoder;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::BufReader;

use crate::validate_save_path;
use tauri::Emitter;
// ── Pile géographique ────────────────────────────────────────────────────────

struct GeoFrame {
    class: String,
    macro_id: String,
    depth: u32,
}

/// Décompose character_argon_female_cau_pilot_01 → (race, role_trained)
/// Le rôle est cherché par valeur (pas par position) car la structure varie selon la race.
fn decompose_npc_macro(macro_id: &str) -> (String, String) {
    let parts: Vec<&str> = macro_id.split('_').collect();
    let race = match parts.get(1) {
        Some(r) if !r.is_empty() => r.to_string(),
        _ => { eprintln!("WARN decompose_npc: race manquante dans '{macro_id}'"); "unknown".to_string() }
    };
    let role = parts
        .iter()
        .skip(2)
        .find(|&&p| matches!(p, "pilot" | "manager" | "buildmanager" | "engineer"
            | "crew" | "marine" | "generic" | "suit"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            eprintln!("WARN decompose_npc: rôle inconnu dans '{macro_id}'");
            "unknown".to_string()
        });
    (race, role)
}

/// Décompose ship_arg_m_trans_container_01_a → (faction, size, hull, hull_type)
/// Inspiré de ShipType::setMacro() dans x4-savegame-parser (Mistralys, MIT)
fn decompose_ship_macro(macro_id: &str) -> (String, String, String, Option<String>) {
    let parts: Vec<&str> = macro_id.split('_').collect();
    let get_part = |i: usize, label: &str| -> String {
        match parts.get(i) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => { eprintln!("WARN decompose_ship: {label} manquant dans '{macro_id}'"); "unknown".to_string() }
        }
    };
    let faction   = get_part(1, "faction");
    let size      = get_part(2, "size");
    let hull      = get_part(3, "hull");
    let hull_type = if hull == "trans" || hull == "miner" {
        parts.get(4).map(|s| s.to_string())
    } else {
        None
    };
    (faction, size, hull, hull_type)
}

// ── Helper : collecte tous les attributs d'un tag ───────────────────────────

pub(crate) fn collect_attrs(attrs: quick_xml::events::attributes::Attributes) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for attr in attrs.flatten() {
        let key = std::str::from_utf8(attr.key.as_ref())
            .unwrap_or("")
            .to_string();
        let val = std::str::from_utf8(attr.value.as_ref())
            .unwrap_or("")
            .to_string();
        if !key.is_empty() {
            map.insert(key, val);
        }
    }
    map
}

pub(crate) fn get(attrs: &HashMap<String, String>, key: &str) -> Option<String> {
    attrs.get(key).cloned()
}

fn knownto_has_player(attrs: &HashMap<String, String>) -> bool {
    attrs
        .get("knownto")
        .map(|v| v.split_whitespace().any(|tok| tok == "player"))
        .unwrap_or(false)
}

// ── ProgressReader ───────────────────────────────────────────────────────────
// Wrapper générique sur un Read : émet un événement Tauri "progress" tous les 5 %
// d'avancement (basé sur les octets lus). Émet jusqu'à 99 % — le 100 % est émis
// explicitement à la fin de la commande pour marquer la complétion.

pub(crate) struct ProgressReader<R: std::io::Read> {
    inner: R,
    total: u64,
    read: u64,
    last_pct: u8,
    app: tauri::AppHandle,
}

impl<R: std::io::Read> ProgressReader<R> {
    pub(crate) fn new(inner: R, total: u64, app: tauri::AppHandle) -> Self {
        Self { inner, total, read: 0, last_pct: 0, app }
    }
}

impl<R: std::io::Read> std::io::Read for ProgressReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 && self.total > 0 {
            self.read += n as u64;
            let pct = ((self.read * 100) / self.total).min(99) as u8;
            if pct >= self.last_pct + 5 {
                self.last_pct = pct;
                self.app.emit("progress", json!({ "pct": pct })).ok();
            }
        }
        Ok(n)
    }
}

// ── Parser principal ─────────────────────────────────────────────────────────

pub(crate) fn parse_save<R: std::io::BufRead>(reader: R) -> Result<PlayerBasics, String> {
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(true);

    let mut summary: Option<SaveSummary> = None;
    let mut save_name = String::new();
    let mut save_date: u64 = 0;
    let mut game_version = String::new();
    let mut game_build = String::new();
    let mut game_modified = false;
    let mut inventory: Vec<InventoryItem> = Vec::new();

    // État de navigation
    let mut in_info = false;
    let mut in_patches = false;
    let mut in_patches_history = false;
    let mut patches: Vec<PatchEntry> = Vec::new();

    // <faction id="player"><relations> — réputations joueur
    let mut in_player_faction = false;
    let mut player_faction_done = false;
    let mut in_player_faction_relations = false;
    let mut reputations: Vec<FactionRep> = Vec::new();
    let mut in_player_faction_licences = false;
    let mut licences: Vec<LicenceEntry> = Vec::new();
    let mut known_clusters: HashSet<String> = HashSet::new();
    let mut known_sectors: HashSet<String> = HashSet::new();
    let mut sector_owners: HashMap<String, String> = HashMap::new();
    let mut cluster_owners: HashMap<String, String> = HashMap::new();

    // Profondeur globale de tous les <component> imbriqués
    let mut component_depth: u32 = 0;

    // Pile géographique : galaxy → cluster → sector → zone
    let mut geo_stack: Vec<GeoFrame> = Vec::new();

    // <component class="player"> — inventaire + blueprints
    let mut in_player_component = false;
    let mut player_start_depth: u32 = 0;
    let mut player_inner_depth: u32 = 0;
    let mut in_player_inventory = false;
    let mut in_player_blueprints = false;
    let mut blueprints: Vec<String> = Vec::new();

    // Vaisseaux joueur — accumulateur
    let mut ships: Vec<ShipInfo> = Vec::new();
    let mut in_player_ship = false;
    let mut ship_start_depth: u32 = 0;
    let mut current_ship: Option<ShipInfo> = None;
    let mut in_ship_modification = false;
    let mut in_ship_people = false;
    let mut current_crew_count: u16 = 0;
    let mut current_ship_got_order = false;
    let mut in_formation_leader = false;
    let mut current_formation_shape: Option<String> = None;
    let mut current_formation_members: Vec<String> = Vec::new();

    // NPCs joueur — accumulateur + contexte vaisseau courant
    let mut npcs: Vec<NpcInfo> = Vec::new();
    let mut in_npc = false;
    let mut npc_start_depth: u32 = 0;
    let mut current_npc: Option<NpcInfo> = None;
    let mut npc_ship_code: Option<String> = None;
    let mut npc_ship_name: Option<String> = None;

    // Deployables joueur — accumulateur
    let mut deployables: Vec<DeployableInfo> = Vec::new();

    // Stations joueur — accumulateur + contexte station courant
    let mut stations: Vec<StationInfo> = Vec::new();
    let mut in_player_station = false;
    let mut station_start_depth: u32 = 0;
    let mut current_station: Option<StationInfo> = None;
    let mut npc_station_code: Option<String> = None;
    let mut npc_station_name: Option<String> = None;
    let mut in_station_storage = false;
    let mut in_station_cargo = false;
    let mut storage_depth: u32 = 0;

    let mut buf = Vec::new();

    loop {
        match xml.read_event_into(&mut buf) {
            // ── Balises ouvrantes (ont des enfants) ──────────────────────────
            Ok(Event::Start(ref e)) => {
                let tag = e.name();
                let attrs = collect_attrs(e.attributes());

                match tag.as_ref() {
                    b"info" => in_info = true,

                    b"patches" if in_info => in_patches = true,

                    b"history" if in_patches => in_patches_history = true,

                    b"faction" if !in_player_faction && !player_faction_done => {
                        if get(&attrs, "id").as_deref() == Some("player") {
                            in_player_faction = true;
                        }
                    }

                    b"relations" if in_player_faction => {
                        in_player_faction_relations = true;
                    }

                    b"licences" if in_player_faction => {
                        in_player_faction_licences = true;
                    }

                    b"component" => {
                        component_depth += 1;
                        let class = get(&attrs, "class").unwrap_or_default();
                        let owner = get(&attrs, "owner");
                        let raw_macro = get(&attrs, "macro").unwrap_or_default();
                        let macro_with_suffix = raw_macro.clone();

                        // Mise à jour pile géographique
                        if matches!(class.as_str(), "galaxy" | "cluster" | "sector" | "zone") {
                            let macro_id = raw_macro.strip_suffix("_macro").unwrap_or(&raw_macro).to_string();
                            geo_stack.push(GeoFrame { class: class.clone(), macro_id, depth: component_depth });
                        }

                        if knownto_has_player(&attrs) {
                            if class == "cluster" && macro_with_suffix.ends_with("_macro") {
                                known_clusters.insert(macro_with_suffix.clone());
                            } else if class == "sector" && macro_with_suffix.ends_with("_macro") {
                                known_sectors.insert(macro_with_suffix.clone());
                            }
                        }
                        if macro_with_suffix.ends_with("_macro") {
                            if let Some(owner_id) = owner.clone() {
                                if class == "sector" {
                                    sector_owners.insert(macro_with_suffix.clone(), owner_id);
                                } else if class == "cluster" {
                                    cluster_owners.insert(macro_with_suffix.clone(), owner_id);
                                }
                            }
                        }

                        if in_player_component {
                            player_inner_depth += 1;
                        } else if in_npc {
                            // composant imbriqué dans un npc — ignoré
                        } else if class == "player" {
                            // Composant joueur (inventaire, blueprints) — détecté en priorité,
                            // qu'il soit dans un vaisseau, une station, ou à nu
                            in_player_component = true;
                            player_start_depth = component_depth;
                            player_inner_depth = 0;
                        } else if in_player_ship {
                            if class == "npc" && owner.as_deref() == Some("player") {
                                let raw = get(&attrs, "macro").unwrap_or_default();
                                let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                                let (race, role) = decompose_npc_macro(&mid);
                                in_npc = true;
                                npc_start_depth = component_depth;
                                current_npc = Some(NpcInfo {
                                    name: get(&attrs, "name").unwrap_or_default(),
                                    code: get(&attrs, "code").unwrap_or_default(),
                                    id: get(&attrs, "id").unwrap_or_default(),
                                    race, role,
                                    post: String::new(),
                                    piloting: 0, management: 0, morale: 0,
                                    engineering: 0, boarding: 0,
                                    ship_code: npc_ship_code.clone(),
                                    ship_name: npc_ship_name.clone(),
                                    station_code: None,
                                    station_name: None,
                                });
                            } else {
                                // Équipement (Start events — ont des enfants)
                                let raw = get(&attrs, "macro").unwrap_or_default();
                                let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                                if !mid.is_empty() {
                                    if let Some(ref mut ship) = current_ship {
                                        match class.as_str() {
                                            "shieldgenerator" => ship.shields.push(mid),
                                            "weapon" => ship.weapons.push(mid),
                                            "turret" => ship.turrets.push(mid),
                                            "engine" => ship.engines.push(mid),
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        } else if class.starts_with("ship_")
                            && owner.as_deref() == Some("player")
                        {
                            // Nouveau vaisseau joueur (qu'il soit dans une station ou non)
                            let raw_macro = get(&attrs, "macro").unwrap_or_default();
                            let macro_id = raw_macro
                                .strip_suffix("_macro")
                                .unwrap_or(&raw_macro)
                                .to_string();
                            let (faction, size, hull, hull_type) = decompose_ship_macro(&macro_id);
                            let sector_macro = geo_stack
                                .iter()
                                .rev()
                                .find(|f| f.class == "sector")
                                .map(|f| f.macro_id.clone());
                            let cluster_macro = geo_stack
                                .iter()
                                .rev()
                                .find(|f| f.class == "cluster")
                                .map(|f| f.macro_id.clone());
                            let zone_macro = geo_stack
                                .iter()
                                .rev()
                                .find(|f| f.class == "zone")
                                .map(|f| f.macro_id.clone());
                            let is_docked = get(&attrs, "connection").as_deref() == Some("dock");
                            let ship_code = get(&attrs, "code").unwrap_or_default();
                            let ship_name = get(&attrs, "name");
                            let state = match get(&attrs, "state") {
                                Some(s) if !s.is_empty() => s,
                                _ => "normal".to_string(),
                            };

                            npc_ship_code = Some(ship_code.clone());
                            npc_ship_name = ship_name.clone();

                            in_player_ship = true;
                            ship_start_depth = component_depth;
                            in_ship_people = false;
                            current_crew_count = 0;
                            current_ship_got_order = false;
                            in_formation_leader = false;
                            current_formation_shape = None;
                            current_formation_members.clear();

                            let thruster = get(&attrs, "thruster").map(|t| {
                                t.strip_suffix("_macro").unwrap_or(&t).to_string()
                            });
                            let ship_id = get(&attrs, "id").unwrap_or_default();

                            current_ship = Some(ShipInfo {
                                macro_id,
                                name: ship_name,
                                id: ship_id,
                                code: ship_code,
                                class,
                                size,
                                faction,
                                hull,
                                hull_type,
                                is_docked,
                                sector_macro,
                                cluster_macro,
                                zone_macro,
                                state,
                                crew_count: 0,
                                shields: Vec::new(),
                                weapons: Vec::new(),
                                turrets: Vec::new(),
                                engines: Vec::new(),
                                software: Vec::new(),
                                thruster,
                                current_order: None,
                                formation: None,
                                wingman_leader: None,
                                fleet_name: None,
                                mods: Vec::new(),
                            });
                        } else if in_player_station && !in_player_ship && !in_npc && !in_player_component {
                            if class == "npc" && owner.as_deref() == Some("player") {
                                let raw = get(&attrs, "macro").unwrap_or_default();
                                let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                                let (race, role) = decompose_npc_macro(&mid);
                                in_npc = true;
                                npc_start_depth = component_depth;
                                current_npc = Some(NpcInfo {
                                    name: get(&attrs, "name").unwrap_or_default(),
                                    code: get(&attrs, "code").unwrap_or_default(),
                                    id: get(&attrs, "id").unwrap_or_default(),
                                    race, role,
                                    post: String::new(),
                                    piloting: 0, management: 0, morale: 0,
                                    engineering: 0, boarding: 0,
                                    ship_code: None,
                                    ship_name: None,
                                    station_code: npc_station_code.clone(),
                                    station_name: npc_station_name.clone(),
                                });
                            } else if matches!(class.as_str(),
                                "defencemodule" | "pier" | "storage" | "dockarea" |
                                "hab" | "production" | "productionmodule" |
                                "connectionmodule" | "highwaymodule"
                            ) {
                                let raw = get(&attrs, "macro").unwrap_or_default();
                                let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                                if !mid.is_empty() {
                                    if let Some(ref mut station) = current_station {
                                        station.modules.push(mid.clone());
                                    }
                                }
                                if class == "storage" {
                                    let storage_id = get(&attrs, "id").unwrap_or_default();
                                    let conn = get(&attrs, "connection").unwrap_or_default();
                                    if let Some(ref mut station) = current_station {
                                        if !storage_id.is_empty() {
                                            station.storage_slots.push(StationStorageSlot {
                                                id: storage_id,
                                                macro_id: mid.clone(),
                                                connection: conn.clone(),
                                            });
                                        }
                                    }
                                    if conn == "space" {
                                        in_station_storage = true;
                                        storage_depth = component_depth;
                                    }
                                }
                            }
                        } else if (class.starts_with("station") || class == "buildstorage")
                            && owner.as_deref() == Some("player")
                        {
                            // Nouvelle station joueur (station_* ou buildstorage)
                            let kind = if class == "buildstorage" {
                                "buildstorage".to_string()
                            } else {
                                "station".to_string()
                            };
                            let raw_macro = get(&attrs, "macro").unwrap_or_default();
                            let macro_id = raw_macro
                                .strip_suffix("_macro")
                                .unwrap_or(&raw_macro)
                                .to_string();
                            let parts: Vec<&str> = macro_id.split('_').collect();
                            let faction = parts.get(1).unwrap_or(&"").to_string();
                            let sector_macro = geo_stack
                                .iter()
                                .rev()
                                .find(|f| f.class == "sector")
                                .map(|f| f.macro_id.clone());
                            let station_code = get(&attrs, "code").unwrap_or_default();
                            let station_name = get(&attrs, "name");

                            npc_station_code = Some(station_code.clone());
                            npc_station_name = station_name.clone();

                            in_player_station = true;
                            station_start_depth = component_depth;

                            current_station = Some(StationInfo {
                                macro_id,
                                name: station_name,
                                code: station_code,
                                kind,
                                faction,
                                sector_macro,
                                modules: Vec::new(),
                                cargo: Vec::new(),
                                storage_slots: Vec::new(),
                            });
                        } else if matches!(class.as_str(),
                            "satellite" | "resourceprobe" | "navbeacon" | "lasertower" | "mine"
                        ) && owner.as_deref() == Some("player") {
                            let raw = get(&attrs, "macro").unwrap_or_default();
                            let macro_id = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                            let sector_macro = geo_stack
                                .iter()
                                .rev()
                                .find(|f| f.class == "sector")
                                .map(|f| f.macro_id.clone());
                            deployables.push(DeployableInfo {
                                class,
                                macro_id,
                                code: get(&attrs, "code").unwrap_or_default(),
                                sector_macro,
                            });
                        } else if class == "npc" && owner.as_deref() == Some("player") {
                            // NPC hors contexte connu (ne devrait pas arriver)
                            let raw = get(&attrs, "macro").unwrap_or_default();
                            let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                            let (race, role) = decompose_npc_macro(&mid);
                            in_npc = true;
                            npc_start_depth = component_depth;
                            current_npc = Some(NpcInfo {
                                name: get(&attrs, "name").unwrap_or_default(),
                                code: get(&attrs, "code").unwrap_or_default(),
                                id: get(&attrs, "id").unwrap_or_default(),
                                race, role,
                                post: String::new(),
                                piloting: 0, management: 0, morale: 0,
                                engineering: 0, boarding: 0,
                                ship_code: None,
                                ship_name: None,
                                station_code: None,
                                station_name: None,
                            });
                        }
                    }

                    b"inventory" if in_player_component && player_inner_depth == 0 => {
                        in_player_inventory = true;
                    }

                    b"blueprints" if in_player_component && player_inner_depth == 0 => {
                        in_player_blueprints = true;
                    }

                    b"people" if in_player_ship => {
                        in_ship_people = true;
                    }

                    b"person" if in_ship_people => {
                        current_crew_count += 1;
                    }

                    b"order" if in_player_ship && !current_ship_got_order => {
                        if let Some(order_type) = get(&attrs, "order") {
                            if let Some(ref mut ship) = current_ship {
                                ship.current_order = Some(order_type);
                                current_ship_got_order = true;
                            }
                        }
                    }

                    b"modification" if in_player_ship && !in_npc => {
                        in_ship_modification = true;
                    }

                    b"formation" if in_player_ship => {
                        in_formation_leader = false;
                        current_formation_shape = None;
                        current_formation_members.clear();
                    }

                    b"leader" if in_player_ship => {
                        in_formation_leader = true;
                    }

                    b"cargo" if in_station_storage => {
                        in_station_cargo = true;
                    }

                    _ => {}
                }
            }

            // ── Balises auto-fermantes (<tag/>) ──────────────────────────────
            Ok(Event::Empty(ref e)) => {
                let tag = e.name();
                let attrs = collect_attrs(e.attributes());

                match tag.as_ref() {
                    b"save" if in_info => {
                        save_name = get(&attrs, "name").unwrap_or_default();
                        save_date = get(&attrs, "date")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0);
                    }

                    b"game" if in_info => {
                        game_version = get(&attrs, "version").unwrap_or_default();
                        game_build = get(&attrs, "build").unwrap_or_default();
                        game_modified = get(&attrs, "modified").as_deref() == Some("1");
                    }

                    b"player" if in_info && summary.is_none() => {
                        summary = Some(SaveSummary {
                            player_name: get(&attrs, "name").unwrap_or_default(),
                            money: get(&attrs, "money")
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(0),
                            location: get(&attrs, "location").unwrap_or_default(),
                            save_name: save_name.clone(),
                            save_date,
                            game_version: game_version.clone(),
                            game_build: game_build.clone(),
                            modified: game_modified,
                            patches: Vec::new(), // filled at end of parse
                        });
                    }

                    b"patch" if in_patches && !in_patches_history => {
                        let name = get(&attrs, "name").unwrap_or_default();
                        let extension = get(&attrs, "extension").unwrap_or_default();
                        let version = get(&attrs, "version").unwrap_or_default();
                        if !extension.is_empty() {
                            patches.push(PatchEntry { name, extension, version });
                        }
                    }

                    b"ware" if in_player_inventory => {
                        let ware = get(&attrs, "ware").unwrap_or_default();
                        let amount = get(&attrs, "amount")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(1);
                        if !ware.is_empty() {
                            inventory.push(InventoryItem { ware, amount });
                        }
                    }

                    b"ware" if in_station_cargo => {
                        let ware = get(&attrs, "ware").unwrap_or_default();
                        let amount: u64 = get(&attrs, "amount")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0);
                        if !ware.is_empty() && amount > 0 {
                            if let Some(ref mut station) = current_station {
                                if let Some(w) = station.cargo.iter_mut().find(|w| w.ware == ware) {
                                    w.amount += amount;
                                } else {
                                    station.cargo.push(WareAmount { ware, amount });
                                }
                            }
                        }
                    }

                    b"relation" if in_player_faction_relations => {
                        if let (Some(faction), Some(rel)) = (get(&attrs, "faction"), get(&attrs, "relation")) {
                            if let Ok(value) = rel.parse::<f32>() {
                                reputations.push(FactionRep { faction_id: faction, relation: value, is_booster: false });
                            }
                        }
                    }

                    b"licence" if in_player_faction_licences => {
                        if let (Some(lt), Some(factions_str)) =
                            (get(&attrs, "type"), get(&attrs, "factions"))
                        {
                            let factions = factions_str
                                .split_whitespace()
                                .map(String::from)
                                .collect();
                            licences.push(LicenceEntry { licence_type: lt, factions });
                        }
                    }

                    b"booster" if in_player_faction_relations => {
                        if let (Some(faction), Some(rel)) = (get(&attrs, "faction"), get(&attrs, "relation")) {
                            if let Ok(value) = rel.parse::<f32>() {
                                reputations.push(FactionRep { faction_id: faction, relation: value, is_booster: true });
                            }
                        }
                    }

                    b"blueprint" if in_player_blueprints => {
                        if let Some(ware) = get(&attrs, "ware") {
                            if !ware.is_empty() {
                                blueprints.push(ware);
                            }
                        }
                    }

                    // Compétences et poste d'un NPC joueur
                    b"skills" if in_npc => {
                        if let Some(ref mut npc) = current_npc {
                            npc.piloting    = get(&attrs, "piloting").and_then(|v| v.parse().ok()).unwrap_or(0);
                            npc.management  = get(&attrs, "management").and_then(|v| v.parse().ok()).unwrap_or(0);
                            npc.morale      = get(&attrs, "morale").and_then(|v| v.parse().ok()).unwrap_or(0);
                            npc.engineering = get(&attrs, "engineering").and_then(|v| v.parse().ok()).unwrap_or(0);
                            npc.boarding    = get(&attrs, "boarding").and_then(|v| v.parse().ok()).unwrap_or(0);
                        }
                    }

                    b"entity" if in_npc => {
                        if let Some(ref mut npc) = current_npc {
                            npc.post = get(&attrs, "post").unwrap_or_default();
                        }
                    }

                    // Modules self-closing dans une station joueur
                    b"component" if in_player_station && !in_player_ship && !in_npc && !in_player_component => {
                        let class = get(&attrs, "class").unwrap_or_default();
                        if matches!(class.as_str(),
                            "defencemodule" | "pier" | "storage" | "dockarea" |
                            "hab" | "production" | "productionmodule" |
                            "connectionmodule" | "highwaymodule"
                        ) {
                            let raw = get(&attrs, "macro").unwrap_or_default();
                            let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                            if !mid.is_empty() {
                                if let Some(ref mut station) = current_station {
                                    station.modules.push(mid.clone());
                                }
                            }
                            if class == "storage" {
                                let storage_id = get(&attrs, "id").unwrap_or_default();
                                let conn = get(&attrs, "connection").unwrap_or_default();
                                if let Some(ref mut station) = current_station {
                                    if !storage_id.is_empty() {
                                        station.storage_slots.push(StationStorageSlot {
                                            id: storage_id,
                                            macro_id: mid.clone(),
                                            connection: conn,
                                        });
                                    }
                                }
                            }
                        }
                    }

                    // Équipement self-closing dans un vaisseau joueur
                    b"component" if in_player_ship && !in_npc && !in_player_component => {
                        let class = get(&attrs, "class").unwrap_or_default();
                        let raw = get(&attrs, "macro").unwrap_or_default();
                        let mid = raw.strip_suffix("_macro").unwrap_or(&raw).to_string();
                        if !mid.is_empty() {
                            if let Some(ref mut ship) = current_ship {
                                match class.as_str() {
                                    "shieldgenerator" => ship.shields.push(mid),
                                    "weapon" => ship.weapons.push(mid),
                                    "turret" => ship.turrets.push(mid),
                                    "engine" => ship.engines.push(mid),
                                    _ => {}
                                }
                            }
                        }
                    }

                    b"software" if in_player_ship && !in_npc => {
                        if let Some(wares_str) = get(&attrs, "wares") {
                            if let Some(ref mut ship) = current_ship {
                                ship.software = wares_str
                                    .split_whitespace()
                                    .map(String::from)
                                    .collect();
                            }
                        }
                    }

                    b"order" if in_player_ship && !current_ship_got_order => {
                        if let Some(order_type) = get(&attrs, "order") {
                            if let Some(ref mut ship) = current_ship {
                                ship.current_order = Some(order_type);
                                current_ship_got_order = true;
                            }
                        }
                    }

                    // Mods globaux (enfants de <modification> au niveau vaisseau)
                    b"engine" | b"ship" | b"shield" | b"thruster" | b"paint"
                        if in_player_ship && in_ship_modification && !in_npc =>
                    {
                        if let Some(ware) = get(&attrs, "ware") {
                            if ware.starts_with("mod_") {
                                let scope = String::from_utf8_lossy(tag.as_ref()).into_owned();
                                if let Some(ref mut s) = current_ship {
                                    s.mods.push(ShipMod { ware, scope });
                                }
                            }
                        }
                    }

                    // Mod per-arme (<modification ware="…"/> auto-fermant dans un <component class="weapon">)
                    b"modification" if in_player_ship && !in_npc && !in_ship_modification => {
                        if let Some(ware) = get(&attrs, "ware") {
                            if ware.starts_with("mod_") {
                                if let Some(ref mut s) = current_ship {
                                    s.mods.push(ShipMod { ware, scope: "weapon".to_string() });
                                }
                            }
                        }
                    }

                    b"shape" if in_player_ship && in_formation_leader => {
                        current_formation_shape = get(&attrs, "class");
                    }

                    b"member" if in_player_ship && in_formation_leader => {
                        if let Some(mid) = get(&attrs, "id") {
                            current_formation_members.push(mid);
                        }
                    }

                    b"wingman" if in_player_ship => {
                        if let Some(lid) = get(&attrs, "leader") {
                            if let Some(ref mut ship) = current_ship {
                                ship.wingman_leader = Some(lid);
                            }
                        }
                    }

                    b"fleet" if in_player_ship => {
                        if let Some(name) = get(&attrs, "name") {
                            if !name.is_empty() {
                                if let Some(ref mut ship) = current_ship {
                                    ship.fleet_name = Some(name);
                                }
                            }
                        }
                    }

                    _ => {}
                }
            }

            // ── Balises fermantes ────────────────────────────────────────────
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    // Tout ce dont on a besoin est dans <universe> — on arrête ici
                    // pour éviter de scanner les millions de lignes de <stats>
                    b"universe" => break,

                    b"info" => in_info = false,

                    b"patches" => { in_patches = false; in_patches_history = false; }

                    b"history" if in_patches_history => in_patches_history = false,

                    b"relations" if in_player_faction_relations => {
                        in_player_faction_relations = false;
                    }

                    b"licences" if in_player_faction_licences => {
                        in_player_faction_licences = false;
                    }

                    b"faction" if in_player_faction => {
                        in_player_faction = false;
                        player_faction_done = true;
                    }

                    b"inventory" if in_player_inventory => {
                        in_player_inventory = false;
                    }

                    b"blueprints" if in_player_blueprints => {
                        in_player_blueprints = false;
                    }

                    b"modification" if in_ship_modification => {
                        in_ship_modification = false;
                    }

                    b"people" if in_ship_people => {
                        in_ship_people = false;
                    }

                    b"leader" if in_player_ship => {
                        in_formation_leader = false;
                    }

                    b"formation" if in_player_ship => {
                        if let Some(shape) = current_formation_shape.take() {
                            let members = std::mem::take(&mut current_formation_members);
                            if let Some(ref mut ship) = current_ship {
                                ship.formation = Some(FormationInfo { shape, member_ids: members });
                            }
                        }
                    }

                    b"cargo" if in_station_cargo => {
                        in_station_cargo = false;
                    }

                    b"component" => {
                        // Dépiler la pile géo si ce composant en faisait partie
                        if geo_stack.last().map(|f| f.depth) == Some(component_depth) {
                            geo_stack.pop();
                        }

                        if in_station_storage && component_depth == storage_depth {
                            in_station_storage = false;
                            in_station_cargo = false;
                        }

                        if in_player_component {
                            if component_depth == player_start_depth {
                                in_player_component = false;
                            } else {
                                player_inner_depth -= 1;
                            }
                        } else if in_npc && component_depth == npc_start_depth {
                            // Fermeture du npc — on l'enregistre
                            in_npc = false;
                            if let Some(npc) = current_npc.take() {
                                if !npc.name.is_empty() {
                                    npcs.push(npc);
                                }
                            }
                        } else if in_player_ship && component_depth == ship_start_depth {
                            // Fermeture du vaisseau
                            in_player_ship = false;
                            npc_ship_code = None;
                            npc_ship_name = None;
                            if let Some(mut ship) = current_ship.take() {
                                ship.crew_count = current_crew_count;
                                ships.push(ship);
                            }
                        } else if in_player_station && component_depth == station_start_depth {
                            // Fermeture de la station
                            in_player_station = false;
                            in_station_storage = false;
                            in_station_cargo = false;
                            npc_station_code = None;
                            npc_station_name = None;
                            if let Some(station) = current_station.take() {
                                stations.push(station);
                            }
                        }

                        component_depth -= 1;
                    }

                    _ => {}
                }
            }

            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let mut summary = summary.ok_or("Bloc <info><player> introuvable")?;
    summary.patches = patches;
    let mut known_clusters: Vec<String> = known_clusters.into_iter().collect();
    let mut known_sectors: Vec<String> = known_sectors.into_iter().collect();
    known_clusters.sort();
    known_sectors.sort();

    Ok(PlayerBasics {
        summary,
        inventory,
        blueprints,
        reputations,
        licences,
        ships,
        npcs,
        stations,
        deployables,
        known_clusters,
        known_sectors,
        sector_owners,
        cluster_owners,
    })
}

// ── Parser stats joueur ──────────────────────────────────────────────────────
// Scan dédié : stream jusqu'à <stats>, capture <stat id="..." value="..."/>,
// break à </stats>. Séparé du parser principal qui s'arrête à </universe>.

fn parse_stats_section<R: std::io::BufRead>(reader: R) -> Result<Vec<StatEntry>, String> {
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(true);

    // La save contient plusieurs <stats> imbriqués (factions, planètes…).
    // Le vrai bloc player stats est un enfant direct de <savegame> (depth == 1).
    // On track la profondeur globale et on break dès qu'on l'a traité.
    let mut depth: u32 = 0;
    let mut in_stats = false;
    let mut map: HashMap<String, f64> = HashMap::new();
    let mut buf = Vec::new();

    loop {
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                if e.name().as_ref() == b"stats" && depth == 1 {
                    in_stats = true;
                }
                depth += 1;
            }
            Ok(Event::Empty(ref e)) => {
                if in_stats && e.name().as_ref() == b"stat" {
                    let attrs = collect_attrs(e.attributes());
                    if let (Some(id), Some(val_str)) = (get(&attrs, "id"), get(&attrs, "value")) {
                        if let Ok(value) = val_str.parse::<f64>() {
                            map.insert(id, value);
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                depth = depth.saturating_sub(1);
                if e.name().as_ref() == b"stats" && depth == 1 {
                    // Fin du bloc top-level — on a tout ce qu'il faut
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(map.into_iter().map(|(id, value)| StatEntry { id, value }).collect())
}

#[tauri::command]
pub fn parse_player_stats(path: String) -> Result<Vec<StatEntry>, String> {
    validate_save_path(&path)?;
    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;

    if path.ends_with(".gz") {
        parse_stats_section(BufReader::new(GzDecoder::new(BufReader::new(file))))
    } else {
        parse_stats_section(BufReader::new(file))
    }
}

// ── Parser messages joueur ───────────────────────────────────────────────────
// Scan dédié : stream jusqu'au <messages> top-level (depth == 1), capture
// chaque <message .../>, break à </messages>. Séparé du parser principal.

fn parse_messages_section<R: std::io::BufRead>(reader: R) -> Result<Vec<MessageEntry>, String> {
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(true);

    // <messages> peut se trouver à différentes profondeurs selon la version de save.
    // On cherche le premier <messages> venu, on mémorise sa profondeur,
    // et on break dès que le </messages> correspondant se ferme.
    let mut depth: u32 = 0;
    let mut messages_at: Option<u32> = None; // profondeur (avant incrémentation) où <messages> a été trouvé
    let mut messages: Vec<MessageEntry> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                if messages_at.is_none() && e.name().as_ref() == b"messages" {
                    messages_at = Some(depth);
                }
                depth += 1;
            }
            Ok(Event::Empty(ref e)) => {
                if messages_at.is_some() && e.name().as_ref() == b"entry" {
                    let attrs = collect_attrs(e.attributes());
                    let id = get(&attrs, "id").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
                    let time = get(&attrs, "time").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
                    let title = get(&attrs, "title").unwrap_or_default();
                    let source = get(&attrs, "source").unwrap_or_default();
                    let text = get(&attrs, "text").unwrap_or_default();
                    let high_priority = get(&attrs, "highpriority").as_deref() == Some("1");
                    messages.push(MessageEntry { id, time, title, source, text, high_priority });
                }
            }
            Ok(Event::End(ref e)) => {
                depth = depth.saturating_sub(1);
                if let Some(md) = messages_at {
                    if e.name().as_ref() == b"messages" && depth == md {
                        break;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(messages)
}

#[tauri::command]
pub fn parse_player_messages(path: String) -> Result<Vec<MessageEntry>, String> {
    validate_save_path(&path)?;
    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;

    if path.ends_with(".gz") {
        parse_messages_section(BufReader::new(GzDecoder::new(BufReader::new(file))))
    } else {
        parse_messages_section(BufReader::new(file))
    }
}

// ── Parser recherches complétées ─────────────────────────────────────────────
// Scan dédié : cherche tous les éléments <research ware="..." method="research"/>
// dans le fichier. L'attribut method="research" est unique à ce bloc dans la save.

fn parse_research_section<R: std::io::BufRead>(reader: R) -> Result<Vec<String>, String> {
    let mut xml = Reader::from_reader(reader);
    xml.config_mut().trim_text(true);
    let mut completed: Vec<String> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match xml.read_event_into(&mut buf) {
            Ok(Event::Empty(ref e)) => {
                if e.name().as_ref() == b"research" {
                    let attrs = collect_attrs(e.attributes());
                    if get(&attrs, "method").as_deref() == Some("research") {
                        if let Some(ware) = get(&attrs, "ware") {
                            completed.push(ware);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    Ok(completed)
}

#[tauri::command]
pub fn parse_player_research(path: String) -> Result<Vec<String>, String> {
    validate_save_path(&path)?;
    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;

    if path.ends_with(".gz") {
        parse_research_section(BufReader::new(GzDecoder::new(BufReader::new(file))))
    } else {
        parse_research_section(BufReader::new(file))
    }
}


#[tauri::command]
pub fn parse_save_basics(app: tauri::AppHandle, path: String) -> Result<PlayerBasics, String> {
    validate_save_path(&path)?;
    let file = File::open(&path).map_err(|e| format!("Impossible d'ouvrir le fichier : {e}"))?;
    let total = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let progress_reader = ProgressReader::new(file, total, app.clone());

    let mut result = if path.ends_with(".gz") {
        parse_save(BufReader::new(GzDecoder::new(BufReader::new(progress_reader))))?
    } else {
        parse_save(BufReader::new(progress_reader))?
    };
    app.emit("progress", json!({ "pct": 100 })).ok();

    let needs_resolution = result.summary.location.contains('{')
        || result.ships.iter().any(|s| s.name.as_deref().unwrap_or("").contains('{'))
        || result.npcs.iter().any(|n| {
            n.ship_name.as_deref().unwrap_or("").contains('{')
            || n.station_name.as_deref().unwrap_or("").contains('{')
        });

    if needs_resolution {
        if let Some(db_path) = game_db_path(&app) {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                if let Ok(strings) = load_strings(&conn) {
                    if result.summary.location.contains('{') {
                        result.summary.location = resolve_ref_chain(&result.summary.location, &strings);
                    }
                    for ship in &mut result.ships {
                        if let Some(name) = &ship.name {
                            if name.contains('{') {
                                ship.name = Some(resolve_ref_chain(name, &strings));
                            }
                        }
                    }
                    for npc in &mut result.npcs {
                        if let Some(name) = &npc.ship_name {
                            if name.contains('{') {
                                npc.ship_name = Some(resolve_ref_chain(name, &strings));
                            }
                        }
                        if let Some(name) = &npc.station_name {
                            if name.contains('{') {
                                npc.station_name = Some(resolve_ref_chain(name, &strings));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod save_tests {
    use super::*;
    use crate::types::EditRequest;
    use crate::writer::write_edits;
    use std::collections::HashMap;
    use std::io::Cursor;

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn minimal_xml(player_name: &str, money: i64, modified: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<savegame>
  <info>
    <save name="TestSave" date="12345"/>
    <game version="6.00" build="498349" modified="{}"/>
    <player name="{}" money="{}" location=""/>
  </info>
  <universe>
  </universe>
</savegame>"#,
            modified, player_name, money
        )
    }

    fn xml_with_blueprints(wares: &[&str]) -> String {
        let bps: String = wares
            .iter()
            .map(|w| format!(r#"        <blueprint ware="{}"/>"#, w))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<savegame>
  <info>
    <save name="TestSave" date="0"/>
    <game version="6.00" build="498349" modified="0"/>
    <player name="P" money="0" location=""/>
  </info>
  <universe>
    <component class="player" id="[0x1]" code="PLP-001">
      <blueprints>
{}
      </blueprints>
    </component>
  </universe>
</savegame>"#,
            bps
        )
    }

    fn xml_with_npc(
        npc_name: &str,
        npc_code: &str,
        macro_id: &str,
        piloting: u8, management: u8, morale: u8, engineering: u8, boarding: u8,
    ) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<savegame>
  <info>
    <save name="TestSave" date="0"/>
    <game version="6.00" build="498349" modified="0"/>
    <player name="P" money="0" location=""/>
  </info>
  <universe>
    <component class="ship_s" macro="ship_arg_s_fighter_01_a_macro" owner="player" code="AAA-001" name="Fighter" id="[0x2]">
      <component class="npc" owner="player" macro="{}_macro" name="{}" code="{}" id="[0x3]">
        <skills piloting="{}" management="{}" morale="{}" engineering="{}" boarding="{}"/>
      </component>
    </component>
  </universe>
</savegame>"#,
            macro_id, npc_name, npc_code,
            piloting, management, morale, engineering, boarding
        )
    }

    fn roundtrip_xml(player_name: &str, money: i64) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<savegame>
  <info>
    <save name="TestSave" date="12345"/>
    <game version="6.00" build="498349" modified="0"/>
    <player name="{}" money="{}" location=""/>
  </info>
  <factions>
    <faction id="player">
      <account id="[0xf4]" amount="{}"/>
    </faction>
  </factions>
  <statistics>
    <stat id="money_player" value="{}"/>
  </statistics>
  <universe>
  </universe>
</savegame>"#,
            player_name, money, money, money
        )
    }

    fn empty_edits(player_name: &str, money: i64) -> EditRequest {
        EditRequest {
            player_name: player_name.to_string(),
            money,
            modified: false,
            inventory: vec![],
            blueprints_add: vec![],
            blueprints_remove: vec![],
            research_unlock: vec![],
            reputation_edits: vec![],
            npc_skills: vec![],
            ship_names: vec![],
            station_cargo: vec![],
            station_storage_layout: vec![],
        }
    }

    // ── decompose_ship_macro ──────────────────────────────────────────────────

    #[test]
    fn ship_standard() {
        let (faction, size, hull, hull_type) = decompose_ship_macro("ship_arg_s_fighter_01_a");
        assert_eq!(faction, "arg");
        assert_eq!(size, "s");
        assert_eq!(hull, "fighter");
        assert_eq!(hull_type, None);
    }

    #[test]
    fn ship_trans() {
        let (faction, size, hull, hull_type) = decompose_ship_macro("ship_arg_m_trans_container_01");
        assert_eq!(hull, "trans");
        assert_eq!(hull_type, Some("container".to_string()));
        let _ = (faction, size);
    }

    #[test]
    fn ship_miner() {
        let (_faction, _size, hull, hull_type) = decompose_ship_macro("ship_arg_m_miner_liquid_01");
        assert_eq!(hull, "miner");
        assert_eq!(hull_type, Some("liquid".to_string()));
    }

    // ── decompose_npc_macro ───────────────────────────────────────────────────

    #[test]
    fn npc_pilot() {
        let (race, role) = decompose_npc_macro("character_argon_female_cau_pilot_01");
        assert_eq!(race, "argon");
        assert_eq!(role, "pilot");
    }

    #[test]
    fn npc_manager() {
        let (race, role) = decompose_npc_macro("character_teladi_female_cau_manager_02");
        assert_eq!(race, "teladi");
        assert_eq!(role, "manager");
    }

    #[test]
    fn npc_buildmanager() {
        let (_race, role) = decompose_npc_macro("character_arg_male_cau_buildmanager_01");
        assert_eq!(role, "buildmanager");
    }

    // ── parse_save ────────────────────────────────────────────────────────────

    #[test]
    fn parse_money() {
        let xml = minimal_xml("P", 1_234_567, "0");
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert_eq!(result.summary.money, 1_234_567);
    }

    #[test]
    fn parse_player_name() {
        let xml = minimal_xml("Mathias", 0, "0");
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert_eq!(result.summary.player_name, "Mathias");
    }

    #[test]
    fn parse_modified_zero() {
        let xml = minimal_xml("P", 0, "0");
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert!(!result.summary.modified);
    }

    #[test]
    fn parse_modified_one() {
        let xml = minimal_xml("P", 0, "1");
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert!(result.summary.modified);
    }

    #[test]
    fn parse_blueprints_v8() {
        let xml = xml_with_blueprints(&["ship_arg_s_fighter_01_a", "ship_par_m_corvette_01_a"]);
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert!(result.blueprints.contains(&"ship_arg_s_fighter_01_a".to_string()));
        assert!(result.blueprints.contains(&"ship_par_m_corvette_01_a".to_string()));
        assert_eq!(result.blueprints.len(), 2);
    }

    #[test]
    fn parse_npc_skills() {
        let xml = xml_with_npc("Hans Mueller", "HNS-001", "character_argon_male_cau_pilot_01", 10, 5, 8, 3, 7);
        let result = parse_save(Cursor::new(xml.as_bytes())).unwrap();
        assert_eq!(result.npcs.len(), 1);
        let npc = &result.npcs[0];
        assert_eq!(npc.name, "Hans Mueller");
        assert_eq!(npc.code, "HNS-001");
        assert_eq!(npc.race, "argon");
        assert_eq!(npc.role, "pilot");
        assert_eq!(npc.piloting, 10);
        assert_eq!(npc.management, 5);
        assert_eq!(npc.morale, 8);
        assert_eq!(npc.engineering, 3);
        assert_eq!(npc.boarding, 7);
    }

    // ── round-trip write_edits → parse_save ───────────────────────────────────

    #[test]
    fn roundtrip_money() {
        let xml = roundtrip_xml("OldName", 100);
        let edits = empty_edits("OldName", 9_999_999);
        let mut out: Vec<u8> = Vec::new();
        write_edits(Cursor::new(xml.as_bytes()), &mut out, &edits, &HashMap::new()).unwrap();
        let result = parse_save(Cursor::new(out.as_slice())).unwrap();
        assert_eq!(result.summary.money, 9_999_999);
    }

    #[test]
    fn roundtrip_player_name() {
        let xml = roundtrip_xml("OldName", 0);
        let edits = empty_edits("NewName", 0);
        let mut out: Vec<u8> = Vec::new();
        write_edits(Cursor::new(xml.as_bytes()), &mut out, &edits, &HashMap::new()).unwrap();
        let result = parse_save(Cursor::new(out.as_slice())).unwrap();
        assert_eq!(result.summary.player_name, "NewName");
    }
}