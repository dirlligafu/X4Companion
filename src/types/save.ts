// Types générés depuis les structs Rust via ts-rs — ne pas éditer les re-exports.
// Pour ajouter un type : modifier lib.rs + cargo test export_bindings.
export type {
  CatalogMetadata,
  BlueprintInfo,
  ClusterCatalogItem,
  DeployableInfo,
  EngineBoost,
  EngineCatalogItem,
  EngineFwdThrust,
  EngineTravelDrive,
  EquipmentCatalog,
  FactionRep,
  FormationInfo,
  InventoryCatalogItem,
  InventoryItem,
  LicenceEntry,
  MessageEntry,
  ModBonus,
  ModStat,
  ModuleCargoInfo,
  NpcInfo,
  PatchEntry,
  PlayerBasics,
  ResearchEntry,
  ResearchMaterial,
  SaveSummary,
  SectorCatalogItem,
  SectorsCatalog,
  ShieldCatalogItem,
  ShieldRecharge,
  ShipCargo,
  ShipCatalogItem,
  ShipDrag,
  ShipInertia,
  ShipInfo,
  ShipMod,
  ShipPhysics,
  ShipPrice,
  ShipSlot,
  ShipSoftware,
  StatEntry,
  StationInfo,
  StationStorageSlot,
  ThrusterAngular,
  ThrusterCatalogItem,
  ThrusterThrust,
  WareAmount,
  WareCargoInfo,
  WeaponBullet,
  WeaponCatalogItem,
  WeaponDamage,
  WeaponReload,
} from "./bindings";

// ── Types manuels (commandes Rust retournant serde_json::Value — pas encore typées) ──
// Ces types resteront ici jusqu'à ce que les commandes correspondantes soient
// migrées vers des structs Rust typées (Phase 1.3 du plan de refactoring).

export interface ModRecipeIngredient {
  ware: string;
  amount: number;
  name: string | null;
}

export interface ModRecipe {
  ware: string;
  name: string | null;
  category: string;
  quality: number;
  noplayerblueprint: boolean;
  ingredients: ModRecipeIngredient[];
  research: string | null;
}

export interface ModRecipesData {
  mods: ModRecipe[];
  ingredient_names: Record<string, string | null>;
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
