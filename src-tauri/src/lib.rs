mod ship_inject;
mod ship_inspect;
mod ship_xml;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use tauri::{Emitter, Manager};

// ── Contrats JSON ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PatchEntry {
    pub name: String,       // <patch name="...">  — libellé lisible
    pub extension: String,  // <patch extension="..."> — identifiant technique (ego_dlc_* = DLC officiel)
    pub version: String,    // <patch version="...">
}

#[derive(Serialize)]
pub struct SaveSummary {
    pub player_name: String,
    pub save_name: String,
    pub save_date: u64,
    pub money: i64,
    pub location: String,
    pub game_version: String,
    pub game_build: String,
    pub modified: bool,
    pub patches: Vec<PatchEntry>,
}

#[derive(Serialize)]
pub struct InventoryItem {
    pub ware: String,
    pub amount: u32,
}

#[derive(Serialize)]
pub struct FactionRep {
    pub faction_id: String,
    pub relation: f32,
    pub is_booster: bool,
}

#[derive(Serialize)]
pub struct FormationInfo {
    pub shape: String,
    pub member_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct ShipMod {
    pub ware: String,
    pub scope: String,  // "engine", "ship", "weapon", "shield", "thruster", "paint"
}

#[derive(Serialize)]
pub struct ShipInfo {
    pub macro_id: String,
    pub name: Option<String>,
    pub id: String,
    pub code: String,
    pub class: String,
    pub size: String,
    pub faction: String,
    pub hull: String,
    pub hull_type: Option<String>,
    pub is_docked: bool,
    pub sector_macro: Option<String>,
    /// Dernier cluster (macro sans suffixe _macro) dans la pile géo au moment du ship
    pub cluster_macro: Option<String>,
    /// Dernière zone dans la pile géo, si le vaisseau y est rattaché
    pub zone_macro: Option<String>,
    /// Attribut XML `state` (ex. normal, wreck)
    pub state: String,
    pub crew_count: u16,
    pub shields: Vec<String>,
    pub weapons: Vec<String>,
    pub turrets: Vec<String>,
    pub engines: Vec<String>,
    pub software: Vec<String>,
    pub thruster: Option<String>,
    pub current_order: Option<String>,
    pub formation: Option<FormationInfo>,
    pub wingman_leader: Option<String>,
    pub fleet_name: Option<String>,
    pub mods: Vec<ShipMod>,
}

#[derive(Serialize)]
pub struct NpcInfo {
    pub name: String,
    pub code: String,
    pub id: String,          // id interne XML (ex. [0x2f3b5])
    pub race: String,        // extrait du macro (argon, terran, …)
    pub role: String,        // rôle entraîné extrait du macro (pilot, manager, …)
    pub post: String,        // poste assigné depuis <entity post="…">
    pub piloting: u8,
    pub management: u8,
    pub morale: u8,
    pub engineering: u8,
    pub boarding: u8,
    pub ship_code: Option<String>,     // code du vaisseau parent (si applicable)
    pub ship_name: Option<String>,
    pub station_code: Option<String>,  // code de la station parente (si applicable)
    pub station_name: Option<String>,
}

#[derive(Serialize)]
pub struct DeployableInfo {
    pub class: String,               // satellite, resourceprobe, navbeacon, lasertower, mine
    pub macro_id: String,            // eq_arg_satellite_02
    pub code: String,                // ALQ-442
    pub sector_macro: Option<String>,
}

#[derive(Serialize)]
pub struct WareAmount {
    pub ware: String,
    pub amount: u64,
}

#[derive(Serialize, Clone)]
pub struct StationStorageSlot {
    pub id: String,
    pub macro_id: String,
    /// `space` = stock station ; `shipconnection` = soute vaisseau amarré
    pub connection: String,
}

#[derive(Serialize)]
pub struct StationInfo {
    pub macro_id: String,
    pub name: Option<String>,
    pub code: String,
    pub kind: String,             // "station" | "buildstorage"
    pub faction: String,          // extrait du macro (arg, tel, …)
    pub sector_macro: Option<String>,
    pub modules: Vec<String>,     // macros des buildmodules (defence_*, pier_*, hab_*, …)
    pub cargo: Vec<WareAmount>,   // stock agrégé (modules storage connection=space uniquement)
    pub storage_slots: Vec<StationStorageSlot>,
}

#[derive(Serialize)]
pub struct MessageEntry {
    pub id: u32,
    pub time: f64,
    pub title: String,
    pub source: String,
    pub text: String,
    pub high_priority: bool,
}

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
    let race = parts.get(1).unwrap_or(&"").to_string();
    let role = parts
        .iter()
        .skip(2)
        .find(|&&p| matches!(p, "pilot" | "manager" | "buildmanager" | "engineer"))
        .map(|s| s.to_string())
        .unwrap_or_default();
    (race, role)
}

/// Décompose ship_arg_m_trans_container_01_a → (faction, size, hull, hull_type)
/// Inspiré de ShipType::setMacro() dans x4-savegame-parser (Mistralys, MIT)
fn decompose_ship_macro(macro_id: &str) -> (String, String, String, Option<String>) {
    let parts: Vec<&str> = macro_id.split('_').collect();
    let faction   = parts.get(1).unwrap_or(&"").to_string();
    let size      = parts.get(2).unwrap_or(&"").to_string();
    let hull      = parts.get(3).unwrap_or(&"").to_string();
    let hull_type = if hull == "trans" || hull == "miner" {
        parts.get(4).map(|s| s.to_string())
    } else {
        None
    };
    (faction, size, hull, hull_type)
}

#[derive(Serialize)]
pub struct LicenceEntry {
    pub licence_type: String,
    pub factions: Vec<String>,
}

#[derive(Serialize)]
pub struct StatEntry {
    pub id: String,
    pub value: f64,
}

#[derive(Serialize)]
pub struct PlayerBasics {
    pub summary: SaveSummary,
    pub inventory: Vec<InventoryItem>,
    pub blueprints: Vec<String>,
    pub reputations: Vec<FactionRep>,
    pub ships: Vec<ShipInfo>,
    pub npcs: Vec<NpcInfo>,
    pub stations: Vec<StationInfo>,
    pub deployables: Vec<DeployableInfo>,
    pub licences: Vec<LicenceEntry>,
    pub known_clusters: Vec<String>,
    pub known_sectors: Vec<String>,
    pub sector_owners: HashMap<String, String>,
    pub cluster_owners: HashMap<String, String>,
}

// ── Helper : collecte tous les attributs d'un tag ───────────────────────────

fn collect_attrs(attrs: quick_xml::events::attributes::Attributes) -> HashMap<String, String> {
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

fn get(attrs: &HashMap<String, String>, key: &str) -> Option<String> {
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

struct ProgressReader<R: std::io::Read> {
    inner: R,
    total: u64,
    read: u64,
    last_pct: u8,
    app: tauri::AppHandle,
}

impl<R: std::io::Read> ProgressReader<R> {
    fn new(inner: R, total: u64, app: tauri::AppHandle) -> Self {
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

fn parse_save<R: std::io::BufRead>(reader: R) -> Result<PlayerBasics, String> {
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

// ── Contrats édition ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InventoryEdit {
    pub ware: String,
    pub amount: u32,
}

#[derive(Deserialize)]
pub struct ReputationEdit {
    pub faction_id: String,
    pub relation: f64,
}

#[derive(Clone, Deserialize)]
pub struct NpcSkillsEdit {
    pub code: String,
    pub piloting: u8,
    pub management: u8,
    pub morale: u8,
    pub engineering: u8,
    pub boarding: u8,
}

#[derive(Deserialize)]
pub struct WareAmountEdit {
    pub ware: String,
    pub amount: u64,
}

#[derive(Deserialize)]
pub struct StationCargoEdit {
    pub station_code: String,
    pub wares: Vec<WareAmountEdit>,
}

#[derive(Clone, Deserialize)]
pub struct StationStorageSlotJson {
    pub id: String,
    pub macro_id: String,
    pub connection: String,
}

#[derive(Clone, Deserialize)]
pub struct StationStorageLayoutEntry {
    pub station_code: String,
    pub slots: Vec<StationStorageSlotJson>,
}

#[derive(Deserialize)]
pub struct ShipNameEdit {
    pub code: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct EditRequest {
    pub player_name: String,
    pub money: i64,
    pub modified: bool,
    pub inventory: Vec<InventoryEdit>,
    pub blueprints_add: Vec<String>,
    pub blueprints_remove: Vec<String>,
    pub reputation_edits: Vec<ReputationEdit>,
    #[serde(default)]
    pub npc_skills: Vec<NpcSkillsEdit>,
    #[serde(default)]
    pub ship_names: Vec<ShipNameEdit>,
    #[serde(default)]
    pub station_cargo: Vec<StationCargoEdit>,
    /// Requis si `station_cargo` non vide : slots issus du parse (ids stables pour l’écriture).
    #[serde(default)]
    pub station_storage_layout: Vec<StationStorageLayoutEntry>,
}

// ── Helpers écriture ─────────────────────────────────────────────────────────

/// Remplace la valeur d'un attribut XML sur une ligne : attr="ancienne" → attr="nouvelle"
fn replace_attr(line: &str, attr: &str, new_val: &str) -> String {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = line.find(&pattern) {
        let val_start = start + pattern.len();
        if let Some(end) = line[val_start..].find('"') {
            let mut s = line.to_string();
            s.replace_range(val_start..val_start + end, new_val);
            return s;
        }
    }
    line.to_string()
}

/// Extrait la valeur d'un attribut XML sur une ligne
fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    let start = line.find(&pattern)? + pattern.len();
    let end = start + line[start..].find('"')?;
    Some(line[start..end].to_string())
}

/// `attr="…"` ou `attr='…'` (balise ouverte courte, ex. `<component …>`)

/// Met à jour ou ajoute l'attribut amount sur une balise <ware>
fn set_ware_amount(line: &str, amount: u32) -> String {
    if line.contains("amount=") {
        replace_attr(line, "amount", &amount.to_string())
    } else {
        // Insère amount="X" avant le /> final
        if let Some(pos) = line.rfind("/>") {
            let mut s = line.to_string();
            s.insert_str(pos, &format!(" amount=\"{}\"", amount));
            s
        } else {
            line.to_string()
        }
    }
}

fn clamp_skill15(v: u8) -> u8 {
    v.min(15)
}

fn line_opens_player_npc_component(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("<component")
        && t.contains("class=\"npc\"")
        && (t.contains("owner=\"player\"") || t.contains("owner='player'"))
}

fn npc_skills_xml_line(indent: &str, s: &NpcSkillsEdit) -> String {
    format!(
        r#"{indent}<skills piloting="{}" management="{}" morale="{}" engineering="{}" boarding="{}"/>"#,
        clamp_skill15(s.piloting),
        clamp_skill15(s.management),
        clamp_skill15(s.morale),
        clamp_skill15(s.engineering),
        clamp_skill15(s.boarding),
    )
}

/// Bloc compact comme dans les saves : `<traits …><skills … /></traits>` sur une ligne.
fn npc_traits_skills_one_line(indent: &str, s: &NpcSkillsEdit) -> String {
    let p = clamp_skill15(s.piloting);
    let m = clamp_skill15(s.management);
    let mo = clamp_skill15(s.morale);
    let e = clamp_skill15(s.engineering);
    let b = clamp_skill15(s.boarding);
    format!(
        r#"{indent}<traits flags="remotecommable"><skills boarding="{b}" engineering="{e}" management="{m}" morale="{mo}" piloting="{p}" /></traits>"#
    )
}

/// Balises `<component` (non auto-fermantes) et `</component>` sur une même ligne,
/// dans l'ordre du fichier — aligné sur le compteur `component_depth` du parseur.
fn scan_component_depth_delta(line: &str) -> i32 {
    let mut pos = 0usize;
    let mut delta = 0i32;
    while pos < line.len() {
        let rest = &line[pos..];
        let next_open = rest.find("<component");
        let next_close = rest.find("</component>");
        let take_open = match (next_open, next_close) {
            (Some(o), Some(c)) => o < c,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        if take_open {
            let i_open = pos + next_open.unwrap();
            let after_open = &line[i_open..];
            let Some(gt_rel) = after_open.find('>') else {
                pos = i_open + "<component".len();
                continue;
            };
            let gt = i_open + gt_rel;
            let frag = &line[i_open..=gt];
            if !frag.ends_with("/>") {
                delta += 1;
            }
            pos = gt + 1;
        } else {
            let i_close = pos + next_close.unwrap();
            delta -= 1;
            pos = i_close + "</component>".len();
        }
    }
    delta
}

fn load_module_cargo_map_from_path(json_path: &Path) -> Result<HashMap<String, ModuleCargoInfo>, String> {
    let content = fs::read_to_string(json_path)
        .map_err(|e| format!("Lecture modules.json impossible : {e}"))?;
    let items: Vec<Value> = serde_json::from_str(&content).map_err(|e| format!("JSON modules invalide : {e}"))?;
    let map: HashMap<String, ModuleCargoInfo> = items
        .iter()
        .filter_map(|item| {
            let macro_id = item["macroID"].as_str()?;
            let key = macro_id.strip_suffix("_macro").unwrap_or(macro_id).to_string();
            let capacity = item["cargoCapacity"].as_u64().unwrap_or(0);
            if capacity == 0 {
                return None;
            }
            let cargo_type_str = item["cargoType"].as_str().unwrap_or("");
            let types: Vec<String> = cargo_type_str.split_whitespace().map(String::from).collect();
            if types.is_empty() {
                return None;
            }
            Some((key, ModuleCargoInfo { capacity, types }))
        })
        .collect();
    Ok(map)
}

fn load_ware_cargo_map_from_path(json_path: &Path) -> Result<HashMap<String, WareCargoInfo>, String> {
    let content = fs::read_to_string(json_path)
        .map_err(|e| format!("Lecture wares.json impossible : {e}"))?;
    let items: Vec<Value> = serde_json::from_str(&content).map_err(|e| format!("JSON wares invalide : {e}"))?;
    let map: HashMap<String, WareCargoInfo> = items
        .iter()
        .filter_map(|item| {
            let id = item["wareID"].as_str()?.to_string();
            let volume = item["volume"].as_u64()? as u32;
            let transport = item["transport"].as_str()?.to_string();
            Some((id, WareCargoInfo { volume, transport }))
        })
        .collect();
    Ok(map)
}

fn merge_station_wanted(raw: &[WareAmountEdit]) -> HashMap<String, u64> {
    let mut m = HashMap::new();
    for w in raw {
        *m.entry(w.ware.clone()).or_insert(0) += w.amount;
    }
    m
}

fn slot_capacity_by_transport(
    module_index: &HashMap<String, ModuleCargoInfo>,
    macro_id: &str,
) -> Option<HashMap<String, u64>> {
    let info = module_index.get(macro_id)?;
    let mut caps = HashMap::new();
    for t in &info.types {
        *caps.entry(t.clone()).or_insert(0) += info.capacity;
    }
    Some(caps)
}

/// Remplit les silos `connection=space` connus du catalogue (`space_storage_index` = position dans la station).
fn ventilate_station_cargo(
    wanted: &[WareAmountEdit],
    slots: &[StationStorageSlotJson],
    module_index: &HashMap<String, ModuleCargoInfo>,
    ware_index: &HashMap<String, WareCargoInfo>,
) -> Result<HashMap<String, Vec<(String, u64)>>, String> {
    type SlotState = (String, HashMap<String, u64>, HashMap<String, u64>);
    let mut space_slots: Vec<SlotState> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    for sl in slots {
        if sl.connection != "space" { continue; }
        let Some(caps) = slot_capacity_by_transport(module_index, &sl.macro_id) else { continue; };
        if !seen_ids.insert(sl.id.clone()) {
            return Err(format!("station_storage_layout : id {} en double", sl.id));
        }
        space_slots.push((sl.id.clone(), caps, HashMap::new()));
    }
    if space_slots.is_empty() {
        return Err("Aucun module de stockage space connu dans le catalogue (modules.json).".to_string());
    }

    let mut remaining = merge_station_wanted(wanted);
    remaining.retain(|w, _| ware_index.contains_key(w));

    let mut w_order: Vec<String> = remaining.keys().cloned().collect();
    w_order.sort_by(|a, b| {
        let va = remaining[a] * ware_index.get(a).map(|i| i.volume as u64).unwrap_or(0);
        let vb = remaining[b] * ware_index.get(b).map(|i| i.volume as u64).unwrap_or(0);
        vb.cmp(&va)
    });

    let mut out: HashMap<String, Vec<(String, u64)>> = HashMap::new();
    for (id, _, _) in &space_slots {
        out.insert(id.clone(), Vec::new());
    }

    for ware in w_order {
        loop {
            let amt = *remaining.get(&ware).unwrap_or(&0);
            if amt == 0 { break; }
            let w_inf = match ware_index.get(&ware) { Some(x) => x, None => break };
            let vol = w_inf.volume as u64;
            if vol == 0 { break; }
            let t = w_inf.transport.clone();
            let mut placed = false;
            for slot in &mut space_slots {
                let cap_t = *slot.1.get(&t).unwrap_or(&0);
                if cap_t == 0 { continue; }
                let u = *slot.2.get(&t).unwrap_or(&0);
                // marge de 2 unités de volume pour éviter tout overflow de capacité en jeu
                let room = cap_t.saturating_sub(u).saturating_sub(2);
                if room < vol { continue; }
                let add = amt.min(room / vol);
                if add == 0 { continue; }
                let id = slot.0.clone();
                let vec = out.get_mut(&id).expect("id pré-rempli");
                if let Some(x) = vec.iter_mut().find(|(w, _)| w == &ware) {
                    x.1 += add;
                } else {
                    vec.push((ware.clone(), add));
                }
                *slot.2.entry(t.clone()).or_insert(0) += add * vol;
                *remaining.get_mut(&ware).unwrap() -= add;
                placed = true;
                break;
            }
            if !placed { break; }
        }
    }

    Ok(out)
}

fn build_storage_cargo_patches(
    edits: &EditRequest,
    module_index: &HashMap<String, ModuleCargoInfo>,
    ware_index: &HashMap<String, WareCargoInfo>,
) -> Result<HashMap<String, Vec<(String, u64)>>, String> {
    let mut combined: HashMap<String, Vec<(String, u64)>> = HashMap::new();
    for sc in &edits.station_cargo {
        let slots = edits
            .station_storage_layout
            .iter()
            .find(|e| e.station_code == sc.station_code)
            .map(|e| e.slots.as_slice())
            .ok_or_else(|| {
                format!("station_storage_layout manquant pour la station code={}", sc.station_code)
            })?;
        let part = ventilate_station_cargo(&sc.wares, slots, module_index, ware_index)?;
        combined.extend(part);
    }
    Ok(combined)
}

/// Retire `<cargo>…</cargo>` et `<cargo/>` d’un fragment interne au module storage.
fn strip_cargo_sections(inner: &str) -> String {
    let mut r = String::new();
    let mut rest = inner;
    while !rest.is_empty() {
        if let Some(pos) = rest.find("<cargo") {
            r.push_str(&rest[..pos]);
            rest = &rest[pos..];
            if rest.starts_with("<cargo/>") {
                if let Some(i) = rest.find('>') {
                    rest = &rest[i + 1..];
                    continue;
                }
            }
            if rest.starts_with("<cargo />") {
                if let Some(i) = rest.find('>') {
                    rest = &rest[i + 1..];
                    continue;
                }
            }
            if rest.starts_with("<cargo>") {
                if let Some(end) = rest.find("</cargo>") {
                    rest = &rest[end + "</cargo>".len()..];
                    continue;
                }
            }
            r.push('<');
            rest = &rest[1..];
        } else {
            r.push_str(rest);
            break;
        }
    }
    r
}

fn format_compact_cargo(wares: &[(String, u64)]) -> String {
    if wares.is_empty() {
        return "<cargo/>".to_string();
    }
    let mut s = String::from("<cargo>");
    for (w, a) in wares {
        use std::fmt::Write;
        let _ = write!(&mut s, r#"<ware ware="{}" amount="{}"/>"#, w, a);
    }
    s.push_str("</cargo>");
    s
}

fn storage_open_tag_is_valid(open_tag: &str) -> bool {
    open_tag.contains("class=\"storage\"")
        || open_tag.contains("class='storage'")
}

fn rebuild_storage_component_block(old: &str, wares: &[(String, u64)]) -> Result<String, String> {
    let gt = old.find('>').ok_or("storage: balise ouvrante invalide")?;
    let open_tag = &old[..=gt];
    if !storage_open_tag_is_valid(open_tag) {
        return Err("storage: class inattendu".into());
    }
    let trimmed = old.trim_end();
    // Module storage sans enfants : `<component class="storage" …/>`
    if trimmed.ends_with("/>") {
        let head = trimmed[..trimmed.len() - 2].trim_end();
        let mut opening = head.to_string();
        opening.push('>');
        let cargo = format_compact_cargo(wares);
        return Ok(format!("{}{}</component>", opening, cargo));
    }
    let close_pos = old.rfind("</component>").ok_or("storage: </component> manquant")?;
    let inner_raw = &old[gt + 1..close_pos];
    let stripped = strip_cargo_sections(inner_raw);
    let cargo = format_compact_cargo(wares);
    // Le cargo doit précéder <connections> — le jeu l'ignore s'il est après
    if let Some(conn_pos) = stripped.find("<connections") {
        let before = stripped[..conn_pos].trim_end();
        let after = &stripped[conn_pos..];
        Ok(format!("{}{}{}{}</component>", open_tag, before, cargo, after))
    } else {
        let inner = stripped.trim_end();
        Ok(format!("{}{}{}</component>", open_tag, inner, cargo))
    }
}


/// Réécriture streaming du fichier XML avec substitutions ciblées
fn write_edits<R: BufRead, W: Write>(
    reader: R,
    writer: &mut W,
    edits: &EditRequest,
    storage_cargo_patches: &HashMap<String, Vec<(String, u64)>>,
) -> Result<(), String> {
    use std::collections::HashSet;

    let inv_map: HashMap<String, u32> = edits
        .inventory.iter()
        .map(|e| (e.ware.clone(), e.amount))
        .collect();
    let bp_add: HashSet<&str> = edits.blueprints_add.iter().map(|s| s.as_str()).collect();
    let bp_remove: HashSet<&str> = edits.blueprints_remove.iter().map(|s| s.as_str()).collect();
    let rep_map: HashMap<String, f64> = edits.reputation_edits.iter()
        .map(|e| (e.faction_id.clone(), e.relation))
        .collect();
    let npc_skill_map: HashMap<String, NpcSkillsEdit> = edits
        .npc_skills
        .iter()
        .map(|e| (e.code.clone(), e.clone()))
        .collect();
    let ship_name_map: HashMap<String, String> = edits
        .ship_names
        .iter()
        .map(|e| (e.code.clone(), e.name.clone()))
        .collect();
    let mut in_info              = false;
    let mut info_done            = false;
    let mut faction_player_seen  = false;
    let mut faction_account_done = false;
    let mut rep_player_faction      = false;
    let mut in_rep_relations        = false;
    let mut rep_other_faction: Option<String> = None;  // faction ID en cours si dans rep_map
    let mut in_other_faction_relations = false;
    let mut in_player_component  = false;
    let mut player_depth: u32    = 0;
    let mut in_player_inventory  = false;
    let mut in_blueprints        = false;
    let mut stat_done            = false;
    let mut inv_seen: HashSet<String> = HashSet::new();

    let mut comp_depth: i32 = 0;
    let mut in_target_npc = false;
    let mut npc_start_depth: i32 = 0;
    let mut had_skills_line = false;
    let mut npc_edit_spec: Option<NpcSkillsEdit> = None;

    let mut storage_buf: Vec<String> = Vec::new();
    let mut storage_buf_id: String = String::new();
    let mut storage_buf_depth: i32 = 0;

    for line_result in reader.lines() {
        let mut line = line_result.map_err(|e| format!("Erreur lecture : {e}"))?;
        let trimmed = line.trim_start().to_string();
        let mut skip = false;

        // ── NPCs joueur : <traits><skills/></traits> ou ligne <skills/> seule (rempl. / insert) ─
        if !npc_skill_map.is_empty() {
            let depth_before = comp_depth;
            let dcomp = scan_component_depth_delta(&line);
            let depth_after = depth_before + dcomp;
            let t = trimmed.as_str();

            if in_target_npc && t.starts_with("<traits") && t.contains("<skills") {
                if let Some(ref spec) = npc_edit_spec {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    line = npc_traits_skills_one_line(&indent, spec);
                    had_skills_line = true;
                }
            } else if in_target_npc && t.starts_with("<skills") {
                if let Some(ref spec) = npc_edit_spec {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    line = npc_skills_xml_line(&indent, spec);
                    had_skills_line = true;
                }
            } else if in_target_npc && t.starts_with("</component>") && depth_before == npc_start_depth {
                if !had_skills_line {
                    if let Some(ref spec) = npc_edit_spec {
                        let base_indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                        let block_indent = format!("{}  ", base_indent);
                        let sl = npc_traits_skills_one_line(&block_indent, spec);
                        writeln!(writer, "{}", sl).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_target_npc = false;
                npc_edit_spec = None;
                had_skills_line = false;
            } else if line_opens_player_npc_component(&line) {
                if let Some(code) = extract_attr(&line, "code") {
                    if let Some(spec) = npc_skill_map.get(&code) {
                        in_target_npc = true;
                        npc_edit_spec = Some(spec.clone());
                        had_skills_line = false;
                        npc_start_depth = depth_after;
                    }
                }
            }
            comp_depth = depth_after;
        }

        // ── Bloc <info> ──────────────────────────────────────────────────────
        if !info_done {
            if trimmed.starts_with("<info") {
                in_info = true;
            } else if trimmed.starts_with("</info>") {
                in_info = false;
                info_done = true;
            } else if in_info {
                if trimmed.starts_with("<game ") {
                    line = replace_attr(&line, "modified", if edits.modified { "1" } else { "0" });
                } else if trimmed.starts_with("<player ") && trimmed.contains("money=") {
                    line = replace_attr(&line, "name", &edits.player_name);
                    line = replace_attr(&line, "money", &edits.money.to_string());
                }
            }
        }

        // ── Compte joueur dans <faction id="player"> ─────────────────────────
        if !faction_account_done {
            if line.contains("faction id=\"player\"") {
                faction_player_seen = true;
            } else if faction_player_seen && trimmed.starts_with("<account ") && !line.contains("own=") {
                line = replace_attr(&line, "amount", &edits.money.to_string());
                faction_account_done = true;
            } else if faction_player_seen && trimmed.starts_with("</faction>") {
                faction_player_seen = false;
            }
        }

        // ── Relations : côté joueur <faction id="player"><relations> ────────
        if !rep_map.is_empty() {
            if !rep_player_faction {
                if line.contains("faction id=\"player\"") {
                    rep_player_faction = true;
                }
            } else if !in_rep_relations {
                if trimmed.starts_with("<relations>") {
                    in_rep_relations = true;
                } else if trimmed.starts_with("</faction>") {
                    rep_player_faction = false;
                }
            } else {
                if trimmed.starts_with("</relations>") {
                    in_rep_relations = false;
                } else if trimmed.starts_with("<relation ") || trimmed.starts_with("<booster ") {
                    if let Some(faction_id) = extract_attr(&line, "faction") {
                        if let Some(&target_rel) = rep_map.get(&faction_id) {
                            line = replace_attr(&line, "relation", &format!("{}", target_rel));
                        }
                    }
                }
            }
        }

        // ── Relations : côté faction <faction id="X"><relations> ─────────────
        if !rep_map.is_empty() {
            if rep_other_faction.is_none() {
                if trimmed.starts_with("<faction ") && !line.contains("faction id=\"player\"") {
                    if let Some(fid) = extract_attr(&line, "id") {
                        if rep_map.contains_key(&fid) {
                            rep_other_faction = Some(fid);
                            in_other_faction_relations = false;
                        }
                    }
                }
            } else if let Some(ref fid) = rep_other_faction.clone() {
                if !in_other_faction_relations {
                    if trimmed.starts_with("<relations>") {
                        in_other_faction_relations = true;
                    } else if trimmed.starts_with("</faction>") {
                        rep_other_faction = None;
                    }
                } else {
                    if trimmed.starts_with("</relations>") {
                        in_other_faction_relations = false;
                    } else if trimmed.starts_with("<relation ") || trimmed.starts_with("<booster ") {
                        if let Some(other) = extract_attr(&line, "faction") {
                            if other == "player" {
                                if let Some(&target_rel) = rep_map.get(fid) {
                                    line = replace_attr(&line, "relation", &format!("{}", target_rel));
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Composant joueur ─────────────────────────────────────────────────
        if !in_player_component {
            if trimmed.starts_with("<component ") && line.contains("class=\"player\"") {
                in_player_component = true;
                player_depth = 1;
            }
        } else {
            if trimmed.starts_with("<component ") {
                player_depth += 1;
            } else if trimmed.starts_with("</component>") {
                player_depth -= 1;
                if player_depth == 0 {
                    in_player_component = false;
                    in_player_inventory = false;
                    in_blueprints = false;
                }
            } else if trimmed.starts_with("<inventory>") && player_depth == 1 {
                in_player_inventory = true;
            } else if player_depth == 1 && trimmed == "<blueprints/>" {
                // Blueprints vides (self-closing) — on développe si ajouts demandés
                if !bp_add.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let bp_indent = format!("{}  ", indent);
                    writeln!(writer, "{}<blueprints>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    for ware in &bp_add {
                        writeln!(writer, "{}<blueprint ware=\"{}\"/>", bp_indent, ware).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                    writeln!(writer, "{}</blueprints>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    skip = true;
                }
            } else if player_depth == 1 && trimmed.starts_with("<blueprints>") {
                in_blueprints = true;
            } else if in_blueprints && trimmed.starts_with("</blueprints>") {
                // Insère les nouveaux blueprints avant la fermeture
                if !bp_add.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let bp_indent = format!("{}  ", indent);
                    for ware in &bp_add {
                        writeln!(writer, "{}<blueprint ware=\"{}\"/>", bp_indent, ware).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_blueprints = false;
                // La ligne </blueprints> s'écrit normalement
            } else if in_blueprints && trimmed.starts_with("<blueprint ") {
                // Supprime les blueprints marqués à retirer
                if let Some(ware) = extract_attr(&line, "ware") {
                    if bp_remove.contains(ware.as_str()) {
                        skip = true;
                    }
                }
            } else if trimmed.starts_with("</inventory>") && in_player_inventory {
                // Injecter les nouveaux items (pas encore vus dans le XML)
                let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                let item_indent = format!("{}  ", indent);
                for (ware_id, &amount) in &inv_map {
                    if !inv_seen.contains(ware_id.as_str()) {
                        if amount > 0 {
                            writeln!(writer, "{}<ware ware=\"{}\" amount=\"{}\"/>", item_indent, ware_id, amount)
                                .map_err(|e| format!("Erreur écriture ware : {e}"))?;
                        }
                    }
                }
                in_player_inventory = false;
            } else if in_player_inventory && trimmed.starts_with("<ware ") {
                if let Some(ware_id) = extract_attr(&line, "ware") {
                    inv_seen.insert(ware_id.clone());
                    if let Some(&new_amount) = inv_map.get(&ware_id) {
                        line = set_ware_amount(&line, new_amount);
                    }
                }
            }
        }

        // ── Stat money_player ────────────────────────────────────────────────
        if !stat_done && line.contains("stat id=\"money_player\"") {
            line = replace_attr(&line, "value", &edits.money.to_string());
            stat_done = true;
        }

        // ── Noms de vaisseaux ────────────────────────────────────────────────
        if !ship_name_map.is_empty() {
            let hit = ship_name_map.keys().find(|code| {
                (line.contains(&format!("code=\"{}\"", code)) || line.contains(&format!("code='{}'", code)))
                    && (line.contains("class=\"ship_") || line.contains("class='ship_"))
            }).cloned();
            if let Some(code) = hit {
                let new_name = &ship_name_map[&code];
                if line.contains("name=\"") || line.contains("name='") {
                    line = replace_attr(&line, "name", new_name);
                } else {
                    let code_attr = format!("code=\"{}\"", code);
                    line = line.replacen(&code_attr, &format!("name=\"{}\" {}", new_name, code_attr), 1);
                }
            }
        }

        if !storage_cargo_patches.is_empty() {
            if !storage_buf.is_empty() {
                let delta = scan_component_depth_delta(&line);
                storage_buf_depth += delta;
                storage_buf.push(line.clone());
                skip = true;
                if storage_buf_depth <= 0 {
                    let joined = storage_buf.join("\n");
                    let wares = storage_cargo_patches.get(&storage_buf_id).map(|v| v.as_slice()).unwrap_or(&[]);
                    let rebuilt = rebuild_storage_component_block(&joined, wares)?;
                    writeln!(writer, "{}", rebuilt).map_err(|e| format!("Erreur écriture : {e}"))?;
                    storage_buf.clear();
                    storage_buf_id.clear();
                    storage_buf_depth = 0;
                }
            } else {
                let matched_id = storage_cargo_patches.keys().find(|id| {
                    let id_dq = format!("id=\"{}\"", id);
                    let id_sq = format!("id='{}'", id);
                    (line.contains(&id_dq) || line.contains(&id_sq))
                        && (line.contains("class=\"storage\"") || line.contains("class='storage'"))
                        && (line.contains("connection=\"space\"") || line.contains("connection='space'"))
                }).cloned();
                if let Some(slot_id) = matched_id {
                    let delta = scan_component_depth_delta(&line);
                    storage_buf_depth = delta;
                    storage_buf.push(line.clone());
                    storage_buf_id = slot_id;
                    skip = true;
                    if storage_buf_depth <= 0 {
                        let joined = storage_buf.join("\n");
                        let wares = storage_cargo_patches.get(&storage_buf_id).map(|v| v.as_slice()).unwrap_or(&[]);
                        let rebuilt = rebuild_storage_component_block(&joined, wares)?;
                        writeln!(writer, "{}", rebuilt).map_err(|e| format!("Erreur écriture : {e}"))?;
                        storage_buf.clear();
                        storage_buf_id.clear();
                        storage_buf_depth = 0;
                    }
                }
            }
        }

        if !skip {
            writeln!(writer, "{}", line).map_err(|e| format!("Erreur écriture : {e}"))?;
        }
    }

    Ok(())
}

// ── Commandes Tauri ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct BlueprintInfo {
    pub label: String,
    pub category: String,
}

/// Retourne { factionID -> name } depuis resources/factions.json
#[tauri::command]
fn get_faction_names(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
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
fn get_blueprint_labels(app: tauri::AppHandle) -> Result<HashMap<String, BlueprintInfo>, String> {
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
fn get_ship_labels(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
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
            let raw = item["macro"].as_str()?;
            let id = raw.strip_suffix("_macro").unwrap_or(raw).to_string();
            let label = item["name"].as_str()?.to_string();
            Some((id, label))
        })
        .collect();

    Ok(map)
}

#[derive(Serialize)]
pub struct ModuleCargoInfo {
    pub capacity: u64,
    pub types: Vec<String>,
}

/// Retourne { macroID_sans_suffix -> { capacity, types } } depuis resources/modules.json
#[tauri::command]
fn get_module_cargo_index(app: tauri::AppHandle) -> Result<HashMap<String, ModuleCargoInfo>, String> {
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
fn get_ware_labels(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
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

#[derive(Serialize)]
pub struct WareCargoInfo {
    pub volume: u32,
    pub transport: String,
}

/// Retourne { wareID -> { volume, transport } } depuis resources/wares.json
#[tauri::command]
fn get_ware_cargo_info(app: tauri::AppHandle) -> Result<HashMap<String, WareCargoInfo>, String> {
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
fn get_sector_names(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
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

#[tauri::command]
fn apply_edits(app: tauri::AppHandle, path: String, edits: EditRequest) -> Result<(), String> {
    let is_gz = path.ends_with(".gz");
    let total = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let storage_cargo_patches: HashMap<String, Vec<(String, u64)>> = if edits.station_cargo.is_empty() {
        HashMap::new()
    } else {
        let res_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("resource_dir indisponible : {e}"))?
            .join("resources");
        let mod_map = load_module_cargo_map_from_path(&res_dir.join("modules.json"))?;
        let ware_map = load_ware_cargo_map_from_path(&res_dir.join("wares.json"))?;
        build_storage_cargo_patches(&edits, &mod_map, &ware_map)?
    };

    // Backup
    let backup = format!("{}.bak", &path);
    fs::copy(&path, &backup)
        .map_err(|e| format!("Impossible de créer le backup : {e}"))?;

    // Écriture vers fichier temporaire
    let tmp = format!("{}.tmp", &path);
    {
        let src = File::open(&path)
            .map_err(|e| format!("Impossible d'ouvrir le fichier : {e}"))?;
        let dst = File::create(&tmp)
            .map_err(|e| format!("Impossible de créer le fichier temporaire : {e}"))?;
        let progress = ProgressReader::new(src, total, app.clone());

        if is_gz {
            // Pipeline : GzDecoder → write_edits → GzEncoder (pas de fichier intermédiaire)
            let reader = BufReader::new(GzDecoder::new(BufReader::new(progress)));
            let mut encoder = GzEncoder::new(BufWriter::new(dst), Compression::default());
            write_edits(reader, &mut encoder, &edits, &storage_cargo_patches)?;
            encoder
                .finish()
                .map_err(|e| format!("Erreur finalisation gz : {e}"))?;
        } else {
            let mut writer = BufWriter::new(dst);
            write_edits(BufReader::new(progress), &mut writer, &edits, &storage_cargo_patches)?;
            writer.flush().map_err(|e| format!("Erreur flush : {e}"))?;
        }
    }

    // Remplacement atomique
    fs::rename(&tmp, &path)
        .map_err(|e| format!("Impossible de remplacer le fichier : {e}"))?;

    app.emit("progress", json!({ "pct": 100 })).ok();
    Ok(())
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
fn parse_player_stats(path: String) -> Result<Vec<StatEntry>, String> {
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
fn parse_player_messages(path: String) -> Result<Vec<MessageEntry>, String> {
    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;

    if path.ends_with(".gz") {
        parse_messages_section(BufReader::new(GzDecoder::new(BufReader::new(file))))
    } else {
        parse_messages_section(BufReader::new(file))
    }
}

#[tauri::command]
fn ping() -> String {
    "pong from Rust".to_string()
}

#[tauri::command]
fn parse_save_basics(app: tauri::AppHandle, path: String) -> Result<PlayerBasics, String> {
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

/// Extrait le sous-arbre XML brut d'un vaisseau joueur (code instance), à la demande.
#[tauri::command]
fn extract_player_ship_xml(path: String, code: String) -> Result<String, String> {
    ship_xml::extract_player_ship_subtree(&path, &code)
}

/// Inspection structurée (équipage, loadout, ordres, …) sans reconstruire tout le XML.
#[tauri::command]
fn inspect_player_ship(path: String, code: String) -> Result<ship_inspect::ShipInspect, String> {
    ship_inspect::inspect_player_ship(&path, &code)
}

// ── x4_data.db — données statiques du jeu ───────────────────────────────────

/// Chemin vers la copie de travail de x4_data.db dans app_data_dir/saves/
fn game_db_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("saves");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("x4_data.db"))
}

/// Copie x4_data.db depuis les ressources bundlées vers app_data_dir/saves/
/// uniquement si le fichier n'existe pas encore.
fn ensure_game_db(app: &tauri::AppHandle) {
    let dest = match game_db_path(app) {
        Some(p) => p,
        None => return,
    };
    if dest.exists() && dest.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
        return;
    }
    let src = match app.path().resource_dir().ok() {
        Some(d) => d.join("resources").join("x4_data.db"),
        None => return,
    };
    eprintln!("ensure_game_db: src={} exists={}", src.display(), src.exists());
    if let Err(e) = fs::copy(&src, &dest) {
        eprintln!("ensure_game_db: copie échouée : {e}");
    } else {
        eprintln!("ensure_game_db: OK");
    }
}

// ── Helpers DB partagés ──────────────────────────────────────────────────────

fn load_strings(conn: &rusqlite::Connection) -> Result<HashMap<(i64, i64), String>, String> {
    let mut strings: HashMap<(i64, i64), String> = HashMap::new();
    let mut stmt = conn.prepare("SELECT page, string_id, text FROM strings")
        .map_err(|e| format!("Prepare strings : {e}"))?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| format!("Query strings : {e}"))?;
    for row in rows.flatten() {
        strings.insert((row.0, row.1), row.2);
    }
    Ok(strings)
}

/// Résolution de chaîne de références pour les champs où toute la valeur est une ref.
/// Ex: "{20003,270001}(The Void)" → look up → "{20005,1007}(The Void)" → look up → "The Void".
/// À chaque étape on remplace tout par le résultat du lookup; on s'arrête dès qu'il n'y a plus de {.
fn resolve_ref_chain(raw: &str, strings: &HashMap<(i64, i64), String>) -> String {
    let mut current = raw.to_string();
    for _ in 0..8 {
        if let Some(start) = current.find('{') {
            if let Some(rel_end) = current[start..].find('}') {
                let inner = &current[start + 1..start + rel_end];
                if let Some((ps, ss)) = inner.split_once(',') {
                    if let (Ok(p), Ok(s)) = (ps.trim().parse::<i64>(), ss.trim().parse::<i64>()) {
                        if let Some(resolved) = strings.get(&(p, s)) {
                            current = resolved.clone();
                            continue;
                        }
                    }
                }
            }
        }
        break;
    }
    current
}

fn resolve_refs(input: &str, strings: &HashMap<(i64, i64), String>) -> String {
    let mut text = input.to_string();
    // Saved hint text from (pre-resolved hint){...} pattern — used as fallback.
    let mut hint: Option<String> = None;

    for _ in 0..4 {
        // X4 pattern: (pre-resolved hint){ref1}...
        // The '){' closes the hint; save it in case refs can't be resolved (e.g. DLC strings).
        if text.starts_with('(') {
            if let Some(p) = text.as_bytes().windows(2).position(|w| w == b"){") {
                if hint.is_none() {
                    hint = Some(text[1..p].to_string()); // strip outer parens
                }
                text = text[p + 1..].to_string();
            }
        }
        if !text.contains('{') { break; }
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars().peekable();
        let mut changed = false;
        while let Some(ch) = chars.next() {
            if ch == '{' {
                let mut buf = String::new();
                let mut ok = false;
                for c2 in chars.by_ref() {
                    if c2 == '}' { ok = true; break; }
                    buf.push(c2);
                }
                if ok {
                    if let Some((ps, ss)) = buf.split_once(',') {
                        if let (Ok(p), Ok(s)) = (ps.trim().parse::<i64>(), ss.trim().parse::<i64>()) {
                            if let Some(resolved) = strings.get(&(p, s)) {
                                out.push_str(resolved);
                                changed = true;
                                continue;
                            }
                        }
                    }
                    out.push('{'); out.push_str(&buf); out.push('}');
                } else {
                    out.push('{'); out.push_str(&buf);
                }
            } else {
                out.push(ch);
            }
        }
        text = out;
        if !changed { break; }
    }

    // If unresolved refs remain, use the saved hint (pre-resolved by the game).
    if text.contains('{') {
        if let Some(h) = hint {
            return h;
        }
    }

    // Handle \(short\)long escaped variant
    if text.starts_with("\\(") {
        if let Some(end) = text.find("\\)") {
            text = text[end + 2..].trim_start().to_string();
        }
    }
    text.replace("\\(", "(").replace("\\)", ")")
}

#[derive(Serialize)]
pub struct InventoryCatalogItem {
    id:       String,
    name:     String,
    group_id: Option<String>,
    tags:     Option<String>,
    price:    Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct ModBonus {
    stat:      String,
    min:       f64,
    max:       f64,
    chance:    f64,
    max_count: i64,
}

#[derive(Serialize)]
pub struct ModStat {
    ware:     String,
    name:     Option<String>,
    category: String,
    stat:     String,
    quality:  i64,
    min:      f64,
    max:      f64,
    bonuses:  Option<Vec<ModBonus>>,
}

// ── Ships catalog structs (deserialized from catalog/ships.json) ─────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipSlot {
    pub name:  String,
    #[serde(rename = "type")]
    pub slot_type: String,
    pub size:  Option<String>,
    pub tags:  Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipDrag {
    pub forward:    Option<f64>,
    pub reverse:    Option<f64>,
    pub horizontal: Option<f64>,
    pub vertical:   Option<f64>,
    pub pitch:      Option<f64>,
    pub yaw:        Option<f64>,
    pub roll:       Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipInertia {
    pub pitch: Option<f64>,
    pub yaw:   Option<f64>,
    pub roll:  Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipPhysics {
    pub mass:       Option<f64>,
    pub drag:       Option<ShipDrag>,
    pub inertia:    Option<ShipInertia>,
    pub accfactors: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipCargo {
    pub max:  i64,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipPrice {
    pub min:     i64,
    pub average: i64,
    pub max:     i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipSoftware {
    pub ware:       String,
    pub default:    Option<bool>,
    pub compatible: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShipCatalogItem {
    #[serde(rename(deserialize = "macro", serialize = "macro_id"))]
    pub macro_id:        String,
    pub name:            String,
    pub basename:        String,
    pub description:     Option<String>,
    pub size:            Option<String>,
    pub ship_type:       Option<String>,
    pub faction:         Option<String>,
    pub variation:       Option<String>,
    pub icon:            Option<String>,
    pub hull:            Option<i64>,
    pub people_capacity: Option<i64>,
    pub storage:         HashMap<String, serde_json::Value>,
    pub cargo:           Option<ShipCargo>,
    pub radar_range:     Option<i64>,
    pub physics:         Option<ShipPhysics>,
    pub thruster_tags:   Vec<String>,
    pub software:        Vec<ShipSoftware>,
    pub slots:           Vec<ShipSlot>,
    pub slot_counts:     HashMap<String, i64>,
    // outfitting_allowed intentionally omitted — loaded on demand for fitting tool only
    pub price:           Option<ShipPrice>,
    pub owners:          Vec<String>,
    pub player_usable:   bool,
    #[serde(default)]
    pub hangar_storage:  HashMap<String, i64>,   // internal capacity by size  { "xs": 10, "s": 100 }
    #[serde(default)]
    pub docking_pads:    HashMap<String, i64>,   // external pad count by size { "s": 21, "m": 1 }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WeaponBullet {
    pub speed:        Option<f64>,
    pub lifetime:     Option<f64>,
    pub chargetime:   Option<f64>,
    pub amount:       i64,
    pub barrelamount: i64,
    pub icon:         Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WeaponDamage {
    pub hull:   Option<f64>,
    pub shield: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WeaponReload {
    pub rate: Option<f64>,
    pub time: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WeaponCatalogItem {
    #[serde(rename(deserialize = "macro", serialize = "macro_id"))]
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    pub mk:            Option<i64>,
    pub is_turret:     bool,
    pub weapon_type:   Option<String>,
    pub hull:          Option<i64>,
    pub bullet:        WeaponBullet,
    pub damage:        WeaponDamage,
    pub reload:        WeaponReload,
    pub heat_value:    Option<f64>,
    pub weapon_system: Option<String>,
    pub range_km:      Option<f64>,
    pub dps_hull:      Option<f64>,
    pub dps_shield:    Option<f64>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Engine catalog structs ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineBoost {
    pub duration:     Option<f64>,
    pub recharge:     Option<f64>,
    pub thrust:       Option<f64>,
    pub acceleration: Option<f64>,
    pub attack:       Option<f64>,
    pub release:      Option<f64>,
    pub coast:        Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineTravelDrive {
    pub charge:   Option<f64>,
    pub thrust:   Option<f64>,
    pub attack:   Option<f64>,
    pub release:  Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineFwdThrust {
    pub forward: Option<f64>,
    pub reverse: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineCatalogItem {
    #[serde(rename(deserialize = "macro", serialize = "macro_id"))]
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    pub mk:            Option<i64>,
    pub hull:          Option<i64>,
    pub boost:         Option<EngineBoost>,
    pub travel:        Option<EngineTravelDrive>,
    pub thrust:        Option<EngineFwdThrust>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Shield catalog structs ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ShieldRecharge {
    pub max:   Option<i64>,
    pub rate:  Option<f64>,
    pub delay: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShieldCatalogItem {
    #[serde(rename(deserialize = "macro", serialize = "macro_id"))]
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    pub mk:            Option<i64>,
    pub hull:          Option<i64>,
    pub recharge:      Option<ShieldRecharge>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Thruster catalog structs ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ThrusterThrust {
    pub strafe: Option<f64>,
    pub pitch:  Option<f64>,
    pub yaw:    Option<f64>,
    pub roll:   Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThrusterAngular {
    pub roll:  Option<f64>,
    pub pitch: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ThrusterCatalogItem {
    #[serde(rename(deserialize = "macro", serialize = "macro_id"))]
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    pub mk:            Option<i64>,
    pub thrust:        Option<ThrusterThrust>,
    pub angular:       Option<ThrusterAngular>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Unified equipment catalog ────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct EquipmentCatalog {
    pub weapons:   Vec<WeaponCatalogItem>,
    pub engines:   Vec<EngineCatalogItem>,
    pub shields:   Vec<ShieldCatalogItem>,
    pub thrusters: Vec<ThrusterCatalogItem>,
}

/// Retourne le catalogue complet de l'équipement depuis catalog/equipment.json.
/// Lit le fichier une seule fois et retourne les 4 catégories.
#[tauri::command]
fn get_equipment_catalog(app: tauri::AppHandle) -> Result<EquipmentCatalog, String> {
    #[derive(Deserialize)]
    struct RawCatalog {
        weapons:   Vec<WeaponCatalogItem>,
        turrets:   Vec<WeaponCatalogItem>,
        engines:   Vec<EngineCatalogItem>,
        shields:   Vec<ShieldCatalogItem>,
        thrusters: Vec<ThrusterCatalogItem>,
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

    Ok(EquipmentCatalog {
        weapons,
        engines:   raw.engines,
        shields:   raw.shields,
        thrusters: raw.thrusters,
    })
}

/// Crée (si besoin) et retourne le chemin du dossier des fittings custom.
#[tauri::command]
fn ensure_fittings_dir(app: tauri::AppHandle) -> Result<String, String> {
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

/// Retourne tous les mods d'équipement depuis mod_stats dans x4_data.db.
#[tauri::command]
fn get_mod_stats(app: tauri::AppHandle) -> Result<Vec<ModStat>, String> {
    let db_path = game_db_path(&app)
        .ok_or("Impossible de localiser x4_data.db")?;
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Ouverture DB : {e}"))?;

    let mut stmt = conn.prepare(
        "SELECT ware, name, category, stat, quality, min, max, bonuses \
         FROM mod_stats ORDER BY category, stat, quality, ware",
    ).map_err(|e| format!("Prepare mod_stats : {e}"))?;

    let mods = stmt
        .query_map([], |row| {
            let bonuses_json: Option<String> = row.get(7)?;
            let bonuses = bonuses_json
                .and_then(|j| serde_json::from_str::<Vec<ModBonus>>(&j).ok());
            Ok(ModStat {
                ware:     row.get(0)?,
                name:     row.get(1)?,
                category: row.get(2)?,
                stat:     row.get(3)?,
                quality:  row.get(4)?,
                min:      row.get(5)?,
                max:      row.get(6)?,
                bonuses,
            })
        })
        .map_err(|e| format!("Query mod_stats : {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(mods)
}

/// Retourne le catalogue complet des items d'inventaire depuis x4_data.db,
/// avec les noms résolus depuis la table strings (résolution applicative).
#[tauri::command]
fn get_inventory_catalog(app: tauri::AppHandle) -> Result<Vec<InventoryCatalogItem>, String> {
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
fn get_ships_catalog(app: tauri::AppHandle) -> Result<Vec<ShipCatalogItem>, String> {
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

    Ok(items)
}

/// Retourne le catalogue complet clusters/secteurs depuis resources/catalog/sectors.json.
#[tauri::command]
fn get_sectors_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir indisponible : {e}"))?
        .join("resources")
        .join("catalog")
        .join("sectors.json");

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Lecture catalog/sectors.json impossible : {e}"))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("JSON invalide dans catalog/sectors.json : {e}"))
}

/// Retourne les superhighways depuis resources/catalog/highways.json.
#[tauri::command]
fn get_highways_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
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
fn get_gates_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
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
fn get_stations_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
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
fn get_template_loadout(
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
fn save_fitting(
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
struct LoadedFitting {
    ship_macro: String,
    loadout:    HashMap<String, String>,
}

#[tauri::command]
fn load_fitting_from_path(path: String) -> Result<LoadedFitting, String> {
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
fn open_dictionaries(app: tauri::AppHandle) -> Result<(), String> {
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
fn list_ship_templates(app: tauri::AppHandle) -> Result<HashMap<String, Vec<String>>, String> {
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

/// Injecte un ou plusieurs vaisseaux depuis des templates dans la save en une seule passe.
/// Retourne les codes générés pour chaque nouveau vaisseau.
#[tauri::command]
fn inject_ships(app: tauri::AppHandle, save_path: String, template_names: Vec<String>) -> Result<Vec<String>, String> {
    if template_names.is_empty() {
        return Err("Aucun template sélectionné.".to_string());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir : {e}"))?
        .join("resources")
        .join("ship_templates");

    // Tempzone et position du joueur + ships déjà présents
    let loc = ship_inject::find_player_location(&save_path)?;

    // Scan du max ID existant dans la save
    let max_id = ship_inject::scan_max_hex_id(&save_path)?;
    let mut next_id = max_id + 1;

    // Préparer chaque vaisseau, en étendant occupied au fur et à mesure
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

        // Code unique : basé sur next_id au moment de l'allocation
        let c1 = (b'A' + ((next_id >> 4)  % 26) as u8) as char;
        let c2 = (b'A' + ((next_id >> 8)  % 26) as u8) as char;
        let c3 = (b'A' + ((next_id >> 12) % 26) as u8) as char;
        let num = next_id % 1000;
        let new_code = format!("{}{}{}-{:03}", c1, c2, c3, num);

        let ship_xml = ship_inject::prepare_ship_xml(&template_xml, &new_code, &mut next_id, spawn_x, spawn_z);
        codes.push(new_code);
        ship_xmls.push(ship_xml);
    }

    // Injection en une seule passe streaming
    ship_inject::inject_into_save_batch(&save_path, &ship_xmls, &loc.tempzone_id)?;

    Ok(codes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ensure_game_db(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping, parse_save_basics, parse_player_stats, parse_player_messages, get_ware_labels, get_blueprint_labels, get_faction_names, get_ship_labels, get_sector_names, apply_edits, extract_player_ship_xml, inspect_player_ship, get_inventory_catalog, get_ships_catalog, get_equipment_catalog, open_dictionaries, get_sectors_catalog, get_highways_catalog, get_gates_catalog, get_stations_catalog,
            list_ship_templates, inject_ships, get_module_cargo_index, get_ware_cargo_info, get_template_loadout, save_fitting, load_fitting_from_path, get_mod_stats, ensure_fittings_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
