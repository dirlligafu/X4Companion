import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import type { EquipmentCatalog } from "@/types/save";

const EMPTY_EQUIPMENT: EquipmentCatalog = { weapons: [], engines: [], shields: [], thrusters: [] };

export function useEquipmentCatalog(): EquipmentCatalog {
  const [equipment, setEquipment] = useState<EquipmentCatalog>(EMPTY_EQUIPMENT);
  useEffect(() => {
    invoke<EquipmentCatalog>("get_equipment_catalog")
      .then(setEquipment)
      .catch(e => console.error("Impossible de charger equipment catalog :", e));
  }, []);
  return equipment;
}
