import type { SectorsCatalog } from "@/types/save";

export type PlayerMapSector = {
  macro: string;
  name: string;
  faction: string | null;
  description: string | null;
  sunlight: number | null;
  economy: number | null;
  security: number | null;
  resources: Record<string, string>;
};

export type PlayerMapCluster = {
  macro: string;
  name: string;
  faction: string | null;
  sectors: PlayerMapSector[];
};

export type PlayerMapCatalog = {
  clusters: PlayerMapCluster[];
};

type OwnerMaps = {
  sectorOwners?: Record<string, string>;
  clusterOwners?: Record<string, string>;
};

function normalizeMacroKey(macro: string): string {
  return macro.toLowerCase().endsWith("_macro") ? macro.toLowerCase() : `${macro.toLowerCase()}_macro`;
}

export function toPlayerMapCatalog(source: SectorsCatalog, owners?: OwnerMaps): PlayerMapCatalog {
  const sectorOwnersRaw = owners?.sectorOwners ?? {};
  const clusterOwnersRaw = owners?.clusterOwners ?? {};
  const sectorOwners = new Map<string, string>();
  const clusterOwners = new Map<string, string>();

  for (const [macro, owner] of Object.entries(sectorOwnersRaw)) {
    sectorOwners.set(normalizeMacroKey(macro), owner);
  }
  for (const [macro, owner] of Object.entries(clusterOwnersRaw)) {
    clusterOwners.set(normalizeMacroKey(macro), owner);
  }

  return {
    clusters: source.clusters.map(cluster => ({
      macro: cluster.macro,
      name: cluster.name,
      faction: clusterOwners.get(normalizeMacroKey(cluster.macro)) ?? cluster.faction ?? null,
      sectors: cluster.sectors.map(sector => ({
        macro: sector.macro,
        name: sector.name,
        faction: sectorOwners.get(normalizeMacroKey(sector.macro)) ?? sector.faction ?? null,
        description: sector.description ?? null,
        sunlight: sector.sunlight ?? null,
        economy: sector.economy ?? null,
        security: sector.security ?? null,
        resources: sector.resources ?? {},
      })),
    })),
  };
}
