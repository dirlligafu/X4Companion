import type { WeaponCatalogItem } from "@/types/save";
import { WeaponCatalogBrowser } from "./weapon-catalog-browser";

type Props = {
  /** Turrets only (`is_turret`), filtered by the parent. */
  turrets: WeaponCatalogItem[];
};

export function TurretsBrowser({ turrets }: Props) {
  return <WeaponCatalogBrowser items={turrets} />;
}
