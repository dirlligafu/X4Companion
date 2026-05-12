/**
 * Shared table grouping: by ship size, then optionally by basename (series),
 * plus flat layout (faction → mk → name) for equipment catalog browsers.
 */

export const SIZE_ORDER: Record<string, number> = { xs: 0, s: 1, m: 2, l: 3, xl: 4 };

/** Minimal fields required for size / series / flat sorting. */
export type CatalogFamilyItem = {
  macro_id: string;
  name: string;
  basename: string | null;
  size: string | null;
  faction: string | null;
  mk: number | null;
  player_usable: boolean;
};

export type FamilySection<T> = { family: string; items: T[] };

export type SeriesLayout<T extends CatalogFamilyItem> = {
  orderedSizes: string[];
  sizeBuckets: Record<string, T[]>;
  sizeToFamilies: Record<string, FamilySection<T>[]>;
};

export type FlatLayout<T extends CatalogFamilyItem> = {
  orderedSizes: string[];
  sizeBuckets: Record<string, T[]>;
};

export type CatalogLayoutMode = "series" | "flat";

/** Group by size, then basename; sort families and items within family. */
export function buildSeriesLayout<T extends CatalogFamilyItem>(filtered: T[]): SeriesLayout<T> {
  const sizeBuckets: Record<string, T[]> = {};
  for (const e of filtered) {
    const sz = e.size ?? "?";
    if (!sizeBuckets[sz]) sizeBuckets[sz] = [];
    sizeBuckets[sz].push(e);
  }

  const sizeToFamilies: Record<string, FamilySection<T>[]> = {};

  for (const [sz, list] of Object.entries(sizeBuckets)) {
    const famBuckets: Record<string, T[]> = {};
    for (const e of list) {
      const k = e.basename?.trim() || "—";
      if (!famBuckets[k]) famBuckets[k] = [];
      famBuckets[k].push(e);
    }
    const famKeys = Object.keys(famBuckets).sort((a, b) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
    for (const k of famKeys) {
      famBuckets[k].sort((a, b) => {
        const ma = a.mk ?? 999;
        const mb = b.mk ?? 999;
        if (ma !== mb) return ma - mb;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    }
    sizeToFamilies[sz] = famKeys.map(family => ({ family, items: famBuckets[family] }));
  }

  const orderedSizes = Object.keys(sizeBuckets).sort(
    (a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99),
  );

  return { orderedSizes, sizeBuckets, sizeToFamilies };
}

/** Flat per size: faction → mk → name. */
export function buildFlatLayout<T extends CatalogFamilyItem>(filtered: T[]): FlatLayout<T> {
  const sizeBuckets: Record<string, T[]> = {};
  for (const e of filtered) {
    const sz = e.size ?? "?";
    if (!sizeBuckets[sz]) sizeBuckets[sz] = [];
    sizeBuckets[sz].push(e);
  }
  for (const list of Object.values(sizeBuckets)) {
    list.sort((a, b) => {
      const fa = (a.faction ?? "").toLowerCase();
      const fb = (b.faction ?? "").toLowerCase();
      if (fa !== fb) return fa.localeCompare(fb);
      const ma = a.mk ?? 999;
      const mb = b.mk ?? 999;
      if (ma !== mb) return ma - mb;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }
  const orderedSizes = Object.keys(sizeBuckets).sort(
    (a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99),
  );
  return { orderedSizes, sizeBuckets };
}
