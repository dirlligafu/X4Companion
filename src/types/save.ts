export interface PatchEntry {
  name: string;
  extension: string;
  version: string;
}

export interface SaveSummary {
  player_name: string;
  save_name: string;
  save_date: number;
  money: number;
  location: string;
  game_version: string;
  game_build: string;
  modified: boolean;
  patches: PatchEntry[];
}

export interface InventoryItem {
  ware: string;
  amount: number;
}

export interface BlueprintInfo {
  label: string;
  category: string;
}

export interface FactionRep {
  faction_id: string;
  relation: number;
  is_booster: boolean;
}

export interface FormationInfo {
  shape: string;
  member_ids: string[];
}

export interface ShipMod {
  ware: string;
  scope: string;
}

export interface ShipInfo {
  macro_id: string;
  name: string | null;
  id: string;
  code: string;
  class: string;
  size: string;
  faction: string;
  hull: string;
  hull_type: string | null;
  is_docked: boolean;
  sector_macro: string | null;
  /** Macro cluster (ex. cluster_409) au moment du parse */
  cluster_macro?: string | null;
  /** Macro zone si le vaisseau est sous une zone */
  zone_macro?: string | null;
  /** État XML : normal, wreck, … */
  state?: string;
  crew_count: number;
  shields: string[];
  weapons: string[];
  turrets: string[];
  engines: string[];
  software: string[];
  thruster: string | null;
  current_order: string | null;
  formation: FormationInfo | null;
  wingman_leader: string | null;
  fleet_name: string | null;
  mods: ShipMod[];
}

export interface NpcInfo {
  name: string;
  code: string;
  id: string;
  race: string;
  role: string;
  post: string;
  piloting: number;
  management: number;
  morale: number;
  engineering: number;
  boarding: number;
  ship_code: string | null;
  ship_name: string | null;
  station_code: string | null;
  station_name: string | null;
}

export interface LicenceEntry {
  licence_type: string;
  factions: string[];
}

export interface MessageEntry {
  id: number;
  time: number;
  title: string;
  source: string;
  text: string;
  high_priority: boolean;
}

export interface StatEntry {
  id: string;
  value: number;
}

export interface InventoryCatalogItem {
  id: string;
  name: string;
  group_id: string | null;
  tags: string | null;
  price: number | null;
}

export interface ShipSlot {
  name: string;
  type: string;
  size: string | null;
  tags: string[];
}

export interface ShipDrag {
  forward?:    number;
  reverse?:    number;
  horizontal?: number;
  vertical?:   number;
  pitch?:      number;
  yaw?:        number;
  roll?:       number;
}

export interface ShipInertia {
  pitch?: number;
  yaw?:   number;
  roll?:  number;
}

export interface ShipPhysics {
  mass?:       number;
  drag?:       ShipDrag;
  inertia?:    ShipInertia;
  accfactors?: Record<string, number>;
}

export interface ShipCargo {
  max:  number;
  tags: string[];
}

export interface ShipPrice {
  min:     number;
  average: number;
  max:     number;
}

export interface ShipSoftware {
  ware:       string;
  default?:   boolean;
  compatible?: boolean;
}

export interface ShipCatalogItem {
  macro_id:        string;   // mapped from JSON "macro" field
  name:            string;
  basename:        string;
  description:     string | null;
  size:            string | null;
  ship_type:       string | null;
  faction:         string | null;
  variation:       string | null;
  icon:            string | null;
  hull:            number | null;
  people_capacity: number | null;
  storage:         Record<string, number>;  // missile, unit, countermeasure, deployable
  cargo:           ShipCargo | null;
  radar_range:     number | null;
  physics:         ShipPhysics | null;
  thruster_tags:   string[];
  software:        ShipSoftware[];
  slots:           ShipSlot[];
  slot_counts:     Record<string, number>;  // e.g. { engine_s: 1, weapon_s: 6 }
  price:           ShipPrice | null;
  owners:          string[];
  player_usable:   boolean;
  hangar_storage:  Record<string, number>;  // internal capacity by size  { xs: 10, s: 100 }
  docking_pads:    Record<string, number>;  // external pad count by size { s: 21, m: 1 }
}

export interface WeaponBullet {
  speed: number | null;
  lifetime: number | null;
  chargetime: number | null;
  amount: number;
  barrelamount: number;
  icon: string | null;
}

export interface WeaponDamage {
  hull: number | null;
  shield: number | null;
}

export interface WeaponReload {
  rate: number | null;
  time: number | null;
}

export interface WeaponCatalogItem {
  macro_id: string;
  name: string;
  basename: string | null;
  description: string | null;
  faction: string | null;
  size: string | null;
  mk: number | null;
  is_turret: boolean;
  weapon_type: string | null;
  hull: number | null;
  bullet: WeaponBullet;
  damage: WeaponDamage;
  reload: WeaponReload;
  heat_value: number | null;
  weapon_system: string | null;
  range_km: number | null;
  dps_hull: number | null;
  dps_shield: number | null;
  price: { min: number; average: number; max: number } | null;
  owners: string[];
  player_usable: boolean;
}

export interface EquipPrice {
  min: number;
  average: number;
  max: number;
}

export interface EngineCatalogItem {
  macro_id: string;
  name: string;
  basename: string | null;
  description: string | null;
  faction: string | null;
  size: string | null;
  mk: number | null;
  hull: number | null;
  boost: { duration: number | null; recharge: number | null; thrust: number | null; acceleration: number | null; attack: number | null; release: number | null; coast: number | null } | null;
  travel: { charge: number | null; thrust: number | null; attack: number | null; release: number | null } | null;
  thrust: { forward: number | null; reverse: number | null } | null;
  price: EquipPrice | null;
  owners: string[];
  player_usable: boolean;
}

export interface ShieldCatalogItem {
  macro_id: string;
  name: string;
  basename: string | null;
  description: string | null;
  faction: string | null;
  size: string | null;
  mk: number | null;
  hull: number | null;
  recharge: { max: number | null; rate: number | null; delay: number | null } | null;
  price: EquipPrice | null;
  owners: string[];
  player_usable: boolean;
}

export interface ThrusterCatalogItem {
  macro_id: string;
  name: string;
  basename: string | null;
  description: string | null;
  faction: string | null;
  size: string | null;
  mk: number | null;
  thrust: { strafe: number | null; pitch: number | null; yaw: number | null; roll: number | null } | null;
  angular: { roll: number | null; pitch: number | null } | null;
  price: EquipPrice | null;
  owners: string[];
  player_usable: boolean;
}

export interface EquipmentCatalog {
  weapons: WeaponCatalogItem[];
  engines: EngineCatalogItem[];
  shields: ShieldCatalogItem[];
  thrusters: ThrusterCatalogItem[];
}

export interface ModBonus {
  stat: string;
  min: number;
  max: number;
  chance: number;
  max_count: number;
}

export interface ModStat {
  ware: string;
  name: string | null;
  category: string;
  stat: string;
  quality: number;
  min: number;
  max: number;
  bonuses: ModBonus[] | null;
}

export interface DeployableInfo {
  class: string;
  macro_id: string;
  code: string;
  sector_macro: string | null;
}

export interface ModuleCargoInfo {
  capacity: number;
  types: string[];
}

export interface WareCargoInfo {
  volume: number;
  transport: string;
}

export interface StationStorageSlot {
  id: string;
  macro_id: string;
  connection: string;
}

export interface StationInfo {
  macro_id: string;
  name: string | null;
  code: string;
  kind: string;
  faction: string;
  sector_macro: string | null;
  modules: string[];
  /** Agrégat des modules storage `connection=space` uniquement */
  cargo: { ware: string; amount: number }[];
  storage_slots: StationStorageSlot[];
}

export interface SectorCatalogItem {
  macro:          string;
  name:           string;
  dlc:            string;
  description:    string | null;
  pos_x:          number;
  pos_z:          number;
  sunlight:       number | null;
  economy:        number | null;
  security:       number | null;
  faction:        string | null;
  resources:      Record<string, string>;
  region_shape:   string | null;
  region_r:       number | null;
  region_linear:  number | null;
}

export interface GateCatalogItem {
  name:                     string;
  sector_macro:             string;
  pos_x:                    number;
  pos_z:                    number;
  active:                   boolean;
  destination_sector_macro: string | null;
}

export interface GatesCatalog {
  gates: GateCatalogItem[];
}

export interface StationCatalogItem {
  id:           string;
  owner:        string;
  type:         string;
  icon:         string;
  sector_macro: string;
  pos_x:        number;
  pos_z:        number;
  dlc:          string;
}

export interface StationsCatalog {
  stations: StationCatalogItem[];
}

export interface ClusterCatalogItem {
  macro:       string;
  name:        string;
  dlc:         string;
  description: string | null;
  grid_x:      number;
  grid_z:      number;
  faction:     string | null;
  sectors:     SectorCatalogItem[];
}

export interface SectorsCatalog {
  clusters: ClusterCatalogItem[];
}

export interface SplinePoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

export interface HighwayItem {
  name:    string;
  cluster: string;
  entry:   { x: number; z: number } | null;
  exit:    { x: number; z: number } | null;
  spline:  SplinePoint[];
}

export interface HighwaysCatalog {
  highways: HighwayItem[];
}

export interface PlayerBasics {
  summary: SaveSummary;
  inventory: InventoryItem[];
  blueprints: string[];
  reputations: FactionRep[];
  licences: LicenceEntry[];
  ships: ShipInfo[];
  npcs: NpcInfo[];
  stations: StationInfo[];
  deployables: DeployableInfo[];
  known_clusters: string[];
  known_sectors: string[];
  sector_owners: Record<string, string>;
  cluster_owners: Record<string, string>;
}
