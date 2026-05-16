import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import type { ShipCatalogItem } from "@/types/save";

export function useShipsCatalog(): ShipCatalogItem[] {
  const [ships, setShips] = useState<ShipCatalogItem[]>([]);
  useEffect(() => {
    invoke<ShipCatalogItem[]>("get_ships_catalog")
      .then(setShips)
      .catch(e => console.error("Impossible de charger ships catalog :", e));
  }, []);
  return ships;
}
