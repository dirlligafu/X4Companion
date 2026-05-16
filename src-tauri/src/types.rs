use serde::{Deserialize, Serialize};

use std::collections::HashMap;
use ts_rs::TS;
#[derive(Serialize, TS)]
#[ts(export)]
pub struct PatchEntry {
    pub name: String,       // <patch name="...">  — libellé lisible
    pub extension: String,  // <patch extension="..."> — identifiant technique (ego_dlc_* = DLC officiel)
    pub version: String,    // <patch version="...">
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct SaveSummary {
    pub player_name: String,
    pub save_name: String,
    #[ts(type = "number")]
    pub save_date: u64,
    #[ts(type = "number")]
    pub money: i64,
    pub location: String,
    pub game_version: String,
    pub game_build: String,
    pub modified: bool,
    pub patches: Vec<PatchEntry>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct InventoryItem {
    pub ware: String,
    pub amount: u32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct FactionRep {
    pub faction_id: String,
    pub relation: f32,
    pub is_booster: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct FormationInfo {
    pub shape: String,
    pub member_ids: Vec<String>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ShipMod {
    pub ware: String,
    pub scope: String,  // "engine", "ship", "weapon", "shield", "thruster", "paint"
}

#[derive(Serialize, TS)]
#[ts(export)]
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

#[derive(Serialize, TS)]
#[ts(export)]
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

#[derive(Serialize, TS)]
#[ts(export)]
pub struct DeployableInfo {
    pub class: String,               // satellite, resourceprobe, navbeacon, lasertower, mine
    pub macro_id: String,            // eq_arg_satellite_02
    pub code: String,                // ALQ-442
    pub sector_macro: Option<String>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct WareAmount {
    pub ware: String,
    #[ts(type = "number")]
    pub amount: u64,
}

#[derive(Serialize, Clone, TS)]
#[ts(export)]
pub struct StationStorageSlot {
    pub id: String,
    pub macro_id: String,
    /// `space` = stock station ; `shipconnection` = soute vaisseau amarré
    pub connection: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
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

#[derive(Serialize, TS)]
#[ts(export)]
pub struct MessageEntry {
    pub id: u32,
    pub time: f64,
    pub title: String,
    pub source: String,
    pub text: String,
    pub high_priority: bool,
}



#[derive(Serialize, TS)]
#[ts(export)]
pub struct LicenceEntry {
    pub licence_type: String,
    pub factions: Vec<String>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct StatEntry {
    pub id: String,
    pub value: f64,
}

#[derive(Serialize, TS)]
#[ts(export)]
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
    #[serde(default)]
    pub research_unlock: Vec<String>,
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

#[derive(Serialize, TS)]
#[ts(export)]
pub struct BlueprintInfo {
    pub label: String,
    pub category: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ModuleCargoInfo {
    #[ts(type = "number")]
    pub capacity: u64,
    pub types: Vec<String>,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct WareCargoInfo {
    pub volume: u32,
    pub transport: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct InventoryCatalogItem {
    pub id:       String,
    pub name:     String,
    pub group_id: Option<String>,
    pub tags:     Option<String>,
    #[ts(type = "number | null")]
    pub price:    Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ModBonus {
    stat:      String,
    min:       f64,
    max:       f64,
    chance:    f64,
    #[ts(type = "number")]
    max_count: i64,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ModStat {
    pub ware:     String,
    pub name:     Option<String>,
    pub category: String,
    pub stat:     String,
    #[ts(type = "number")]
    pub quality:  i64,
    pub min:      f64,
    pub max:      f64,
    pub bonuses:  Option<Vec<ModBonus>>,
}

// ── Ships catalog structs (deserialized from catalog/ships.json) ─────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipSlot {
    pub name:  String,
    #[serde(rename = "type")]
    pub slot_type: String,
    pub size:  Option<String>,
    pub tags:  Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipDrag {
    pub forward:    Option<f64>,
    pub reverse:    Option<f64>,
    pub horizontal: Option<f64>,
    pub vertical:   Option<f64>,
    pub pitch:      Option<f64>,
    pub yaw:        Option<f64>,
    pub roll:       Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipInertia {
    pub pitch: Option<f64>,
    pub yaw:   Option<f64>,
    pub roll:  Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipPhysics {
    pub mass:       Option<f64>,
    pub drag:       Option<ShipDrag>,
    pub inertia:    Option<ShipInertia>,
    #[ts(type = "Record<string, number> | null")]
    pub accfactors: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipCargo {
    #[ts(type = "number")]
    pub max:  i64,
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipPrice {
    #[ts(type = "number")]
    pub min:     i64,
    #[ts(type = "number")]
    pub average: i64,
    #[ts(type = "number")]
    pub max:     i64,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipSoftware {
    pub ware:       String,
    pub default:    Option<bool>,
    pub compatible: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShipCatalogItem {
    pub macro_id:        String,
    pub name:            String,
    pub basename:        String,
    pub description:     Option<String>,
    pub size:            Option<String>,
    pub ship_type:       Option<String>,
    pub faction:         Option<String>,
    pub variation:       Option<String>,
    pub icon:            Option<String>,
    #[ts(type = "number | null")]
    pub hull:            Option<i64>,
    #[ts(type = "number | null")]
    pub people_capacity: Option<i64>,
    #[ts(type = "Record<string, number>")]
    pub storage:         HashMap<String, serde_json::Value>,
    pub cargo:           Option<ShipCargo>,
    #[ts(type = "number | null")]
    pub radar_range:     Option<i64>,
    pub physics:         Option<ShipPhysics>,
    pub thruster_tags:   Vec<String>,
    pub software:        Vec<ShipSoftware>,
    pub slots:           Vec<ShipSlot>,
    #[ts(type = "Record<string, number>")]
    pub slot_counts:     HashMap<String, i64>,
    // outfitting_allowed intentionally omitted — loaded on demand for fitting tool only
    pub price:           Option<ShipPrice>,
    pub owners:          Vec<String>,
    pub player_usable:   bool,
    #[serde(default)]
    #[ts(type = "Record<string, number>")]
    pub hangar_storage:  HashMap<String, i64>,
    #[serde(default)]
    #[ts(type = "Record<string, number>")]
    pub docking_pads:    HashMap<String, i64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct WeaponBullet {
    pub speed:        Option<f64>,
    pub lifetime:     Option<f64>,
    pub chargetime:   Option<f64>,
    #[ts(type = "number")]
    pub amount:       i64,
    #[ts(type = "number")]
    pub barrelamount: i64,
    pub icon:         Option<String>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct WeaponDamage {
    pub hull:   Option<f64>,
    pub shield: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct WeaponReload {
    pub rate: Option<f64>,
    pub time: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct WeaponCatalogItem {
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    #[ts(type = "number | null")]
    pub mk:            Option<i64>,
    pub is_turret:     bool,
    pub weapon_type:   Option<String>,
    #[ts(type = "number | null")]
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

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct EngineBoost {
    pub duration:     Option<f64>,
    pub recharge:     Option<f64>,
    pub thrust:       Option<f64>,
    pub acceleration: Option<f64>,
    pub attack:       Option<f64>,
    pub release:      Option<f64>,
    pub coast:        Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct EngineTravelDrive {
    pub charge:   Option<f64>,
    pub thrust:   Option<f64>,
    pub attack:   Option<f64>,
    pub release:  Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct EngineFwdThrust {
    pub forward: Option<f64>,
    pub reverse: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct EngineCatalogItem {
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    #[ts(type = "number | null")]
    pub mk:            Option<i64>,
    #[ts(type = "number | null")]
    pub hull:          Option<i64>,
    pub boost:         Option<EngineBoost>,
    pub travel:        Option<EngineTravelDrive>,
    pub thrust:        Option<EngineFwdThrust>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Shield catalog structs ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShieldRecharge {
    #[ts(type = "number | null")]
    pub max:   Option<i64>,
    pub rate:  Option<f64>,
    pub delay: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ShieldCatalogItem {
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    #[ts(type = "number | null")]
    pub mk:            Option<i64>,
    #[ts(type = "number | null")]
    pub hull:          Option<i64>,
    pub recharge:      Option<ShieldRecharge>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Thruster catalog structs ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ThrusterThrust {
    pub strafe: Option<f64>,
    pub pitch:  Option<f64>,
    pub yaw:    Option<f64>,
    pub roll:   Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ThrusterAngular {
    pub roll:  Option<f64>,
    pub pitch: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ThrusterCatalogItem {
    pub macro_id:      String,
    pub name:          String,
    pub basename:      Option<String>,
    pub description:   Option<String>,
    pub faction:       Option<String>,
    pub size:          Option<String>,
    #[ts(type = "number | null")]
    pub mk:            Option<i64>,
    pub thrust:        Option<ThrusterThrust>,
    pub angular:       Option<ThrusterAngular>,
    pub price:         Option<ShipPrice>,
    pub owners:        Vec<String>,
    pub player_usable: bool,
}

// ── Unified equipment catalog ────────────────────────────────────────────────

#[derive(Serialize, Clone, TS)]
#[ts(export)]
pub struct EquipmentCatalog {
    pub weapons:   Vec<WeaponCatalogItem>,
    pub engines:   Vec<EngineCatalogItem>,
    pub shields:   Vec<ShieldCatalogItem>,
    pub thrusters: Vec<ThrusterCatalogItem>,
}

// ── Research catalog structs ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ResearchMaterial {
    pub ware: String,
    #[ts(type = "number")]
    pub amount: i64,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ResearchEntry {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    #[ts(type = "number")]
    pub time: i64,
    #[ts(type = "number | null")]
    pub sortorder: Option<i64>,
    pub hidden: bool,
    pub missiononly: bool,
    pub nocustomgamestart: bool,
    pub dlc: String,
    pub prerequisites: Vec<String>,
    pub materials: Vec<ResearchMaterial>,
}

// ── Sectors catalog structs ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct SectorCatalogItem {
    #[serde(rename = "macro")]
    pub sector_macro: String,
    pub name: String,
    pub dlc: String,
    pub description: Option<String>,
    pub pos_x: f64,
    pub pos_z: f64,
    pub sunlight: Option<f64>,
    pub economy: Option<f64>,
    pub security: Option<f64>,
    pub faction: Option<String>,
    pub resources: HashMap<String, String>,
    pub region_shape: Option<String>,
    pub region_r: Option<f64>,
    pub region_linear: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct ClusterCatalogItem {
    #[serde(rename = "macro")]
    pub cluster_macro: String,
    pub name: String,
    pub dlc: String,
    pub description: Option<String>,
    pub grid_x: f64,
    pub grid_z: f64,
    pub faction: Option<String>,
    pub sectors: Vec<SectorCatalogItem>,
}

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct SectorsCatalog {
    pub clusters: Vec<ClusterCatalogItem>,
}

// ── Catalog metadata ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, TS)]
#[ts(export)]
pub struct CatalogMetadata {
    pub game_build:      String,
    pub catalog_version: String,
}