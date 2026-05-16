import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { BlueprintInfo, CatalogMetadata, HighwaysCatalog, InventoryCatalogItem, ModuleCargoInfo, ModRecipesData, ModStat, ResearchEntry, SectorsCatalog, WareCargoInfo } from "@/types/save";

export function useGameResources() {
  const [moduleCargoIndex, setModuleCargoIndex] = useState<Record<string, ModuleCargoInfo>>({});
  const [wareCargoInfo, setWareCargoInfo] = useState<Record<string, WareCargoInfo>>({});
  const [wareLabels, setWareLabels] = useState<Record<string, string>>({});
  const [blueprintInfos, setBlueprintInfos] = useState<Record<string, BlueprintInfo>>({});
  const [factionNames, setFactionNames] = useState<Record<string, string>>({});
  const [shipLabels, setShipLabels] = useState<Record<string, string>>({});
  const [sectorNames, setSectorNames] = useState<Record<string, string>>({});
  const [inventoryCatalog, setInventoryCatalog] = useState<InventoryCatalogItem[]>([]);
  const [modStats, setModStats] = useState<ModStat[]>([]);
  const [modRecipes, setModRecipes] = useState<ModRecipesData | null>(null);
  const [sectorsCatalog, setSectorsCatalog] = useState<SectorsCatalog | null>(null);
  const [highwaysCatalog, setHighwaysCatalog] = useState<HighwaysCatalog | null>(null);
  const [researchCatalog, setResearchCatalog] = useState<ResearchEntry[]>([]);
  const [catalogMetadata, setCatalogMetadata] = useState<CatalogMetadata | null>(null);

  useEffect(() => {
    invoke<Record<string, ModuleCargoInfo>>("get_module_cargo_index")
      .then(setModuleCargoIndex)
      .catch(e => console.error("Impossible de charger modules.json :", e));
    invoke<Record<string, string>>("get_ware_labels")
      .then(setWareLabels)
      .catch(e => console.error("Impossible de charger wares.json :", e));
    invoke<Record<string, WareCargoInfo>>("get_ware_cargo_info")
      .then(setWareCargoInfo)
      .catch(e => console.error("Impossible de charger ware cargo info :", e));
    invoke<Record<string, BlueprintInfo>>("get_blueprint_labels")
      .then(setBlueprintInfos)
      .catch(e => console.error("Impossible de charger blueprints.json :", e));
    invoke<Record<string, string>>("get_faction_names")
      .then(setFactionNames)
      .catch(e => console.error("Impossible de charger factions.json :", e));
    invoke<Record<string, string>>("get_ship_labels")
      .then(setShipLabels)
      .catch(e => console.error("Impossible de charger ships.json :", e));
    invoke<Record<string, string>>("get_sector_names")
      .then(setSectorNames)
      .catch(e => console.error("Impossible de charger sectors.json :", e));
    invoke<InventoryCatalogItem[]>("get_inventory_catalog")
      .then(setInventoryCatalog)
      .catch(e => console.error("Impossible de charger inventory catalog :", e));
    invoke<ModStat[]>("get_mod_stats")
      .then(setModStats)
      .catch(e => console.error("Impossible de charger mod stats :", e));
    invoke<ModRecipesData>("get_mod_recipes")
      .then(setModRecipes)
      .catch(e => console.error("Impossible de charger mod recipes :", e));
    invoke<SectorsCatalog>("get_sectors_catalog")
      .then(setSectorsCatalog)
      .catch(e => console.error("Impossible de charger sectors catalog :", e));
    invoke<HighwaysCatalog>("get_highways_catalog")
      .then(setHighwaysCatalog)
      .catch(e => console.error("Impossible de charger highways catalog :", e));
    invoke<ResearchEntry[]>("get_research_catalog")
      .then(setResearchCatalog)
      .catch(e => console.error("Impossible de charger research catalog :", e));
    invoke<CatalogMetadata>("get_catalog_metadata")
      .then(setCatalogMetadata)
      .catch(e => console.error("Impossible de charger catalog metadata :", e));
  }, []);

  return { moduleCargoIndex, wareCargoInfo, wareLabels, blueprintInfos, factionNames, shipLabels, sectorNames, inventoryCatalog, modStats, modRecipes, sectorsCatalog, highwaysCatalog, researchCatalog, catalogMetadata };
}
