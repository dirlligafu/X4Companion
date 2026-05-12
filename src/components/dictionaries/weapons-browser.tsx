import type { WeaponCatalogItem } from "@/types/save";
import { WeaponCatalogBrowser } from "./weapon-catalog-browser";

type Props = {
  /** Fixed weapons only (`!is_turret`), filtered by the parent. */
  weapons: WeaponCatalogItem[];
};

export function WeaponsBrowser({ weapons }: Props) {
  return <WeaponCatalogBrowser items={weapons} />;
}
