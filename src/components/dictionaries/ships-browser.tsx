import { Fragment, useMemo, useState, type ReactNode } from "react";
import iconCatalogue from "@/data/icon_catalogue.json";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShipCatalogItem, ShipSlot } from "@/types/save";

type Props = {
  ships: ShipCatalogItem[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const SIZE_ORDER: Record<string, number> = { xs: 0, s: 1, m: 2, l: 3, xl: 4 };
const SIZE_LABELS: Record<string, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

/** Long names for slot breakdown lines in the ship detail panel, e.g. "3 (Medium)". */
const SLOT_SIZE_LONG: Record<string, string> = {
  xs: "Extra Small",
  s:  "Small",
  m:  "Medium",
  l:  "Large",
  xl: "Extra Large",
  "?": "Unknown",
};

function slotSizeLongLabel(size: string): string {
  const key = size.toLowerCase();
  return SLOT_SIZE_LONG[key] ?? (size ? size.charAt(0).toUpperCase() + size.slice(1).toLowerCase() : "Unknown");
}

/** One segment like `2 (Small)` for the collapsible Slots section. */
function formatSlotCountLong(count: number, size: string): string {
  return `${count} (${slotSizeLongLabel(size)})`;
}

const TYPE_LABELS: Record<string, string> = {
  fighter:       "Fighter",
  heavyfighter:  "Heavy Fighter",
  bomber:        "Bomber",
  scout:         "Scout",
  corvette:      "Corvette",
  frigate:       "Frigate",
  destroyer:     "Destroyer",
  carrier:       "Carrier",
  battleship:    "Battleship",
  flagship:      "Flagship",
  mothership:    "Mothership",
  trans:         "Transport",
  miner:         "Miner",
  builder:       "Builder",
  cv:            "CV",
  pv:            "Patrol",
  police:        "Police",
  resupplier:    "Resupplier",
  gunboat:       "Gunboat",
  tugboat:       "Tug",
  yacht:         "Yacht",
  racer:         "Racer",
  scavenger:     "Scavenger",
  scrapper:      "Scrapper",
  research:      "Research",
  expeditionary: "Expeditionary",
};

const FACTION_LABELS: Record<string, string> = {
  arg: "Argon", par: "Paranid", tel: "Teladi", spl: "Split", ter: "Terran",
  atf: "ATF", ant: "Antigone", bor: "Boron", kha: "Kha'ak", xen: "Xenon",
  pir: "Pirate", hol: "HOP", fre: "Free Families", seg: "Segaris",
  yak: "Yaki", zyar: "Zyarth", gen: "Generic",
};

// Slot types shown in the main table and their display order
const SLOT_COLS = ["engine", "shield", "weapon", "turret"] as const;
const SLOT_COL_LABELS: Record<string, string> = { engine: "Engines", shield: "Shields", weapon: "Weapons", turret: "Turrets" };

/** Plural aggregate keys emitted by scripts/catalog/generate_ships.py (`compute_slot_counts`). */
const SLOT_TYPE_JSON_PLURAL: Record<string, string> = {
  engine:   "engines",
  shield:   "shields",
  weapon:   "weapons",
  turret:   "turrets",
  thruster: "thrusters",
};

/**
 * True if JSON key `k` counts toward slot `type` (singular), matching either
 * legacy keys (`engine`, `engine_s`) or Python output (`engines`, `weapons_l`).
 */
function matchesSlotType(k: string, type: string): boolean {
  const plural = SLOT_TYPE_JSON_PLURAL[type] ?? `${type}s`;
  return (
    k === type ||
    k.startsWith(`${type}_`) ||
    k === plural ||
    k.startsWith(`${plural}_`)
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function factionLabel(f: string | null) {
  if (!f) return "—";
  return FACTION_LABELS[f] ?? f.toUpperCase();
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString();
}

/** Total count across all sizes for a slot type, e.g. `engines` + `engine_s` */
function slotTotal(slot_counts: Record<string, number>, type: string): number {
  return Object.entries(slot_counts)
    .filter(([k]) => matchesSlotType(k, type))
    .reduce((s, [, v]) => s + v, 0);
}

/**
 * Breakdown of slot counts by size for a single type (detail panel fallback).
 * Returns e.g. "4 (Medium)  2 (Large)", "12" for aggregate-only keys (`shields`), or "" if none.
 */
function slotBreakdown(slot_counts: Record<string, number>, type: string): string {
  const plural = SLOT_TYPE_JSON_PLURAL[type] ?? `${type}s`;

  const entries = Object.entries(slot_counts)
    .filter(([k]) => matchesSlotType(k, type))
    .map(([k, v]) => {
      let size: string;
      if (k.startsWith(`${plural}_`)) size = k.slice(plural.length + 1);
      else if (k.startsWith(`${type}_`)) size = k.slice(type.length + 1);
      else size = "";
      return { size, count: v };
    })
    .sort((a, b) => {
      if (!a.size && !b.size) return 0;
      if (!a.size) return 1;
      if (!b.size) return -1;
      return (SIZE_ORDER[a.size] ?? 99) - (SIZE_ORDER[b.size] ?? 99);
    });

  return entries
    .map(e => (e.size ? formatSlotCountLong(e.count, e.size) : `${e.count}`))
    .join("  ");
}

/**
 * Per-size breakdown from the raw slot list (detail panel).
 * Engines/shields are not split in `slot_counts` by the catalog generator, but each `ShipSlot` has `size`.
 */
function slotBreakdownFromSlots(slots: ShipSlot[], type: string): string {
  const bySize = new Map<string, number>();
  for (const s of slots) {
    if (s.type !== type) continue;
    const size = s.size ?? "?";
    bySize.set(size, (bySize.get(size) ?? 0) + 1);
  }
  if (bySize.size === 0) return "";
  return [...bySize.entries()]
    .sort((a, b) => (SIZE_ORDER[a[0]] ?? 99) - (SIZE_ORDER[b[0]] ?? 99))
    .map(([size, count]) => formatSlotCountLong(count, size))
    .join("  ");
}

function shipDetailSlotBreakdown(ship: ShipCatalogItem, type: string): string {
  return slotBreakdownFromSlots(ship.slots, type) || slotBreakdown(ship.slot_counts, type);
}

/** Titre de bloc dans le panneau dépliable (sans Card). */
function DetailSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0", className)} aria-labelledby={id}>
      <h3
        id={id}
        className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Ligne libellé / valeur alignée sur une grille de labels fixe. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-foreground/90">
      <span className="w-29 shrink-0 capitalize text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono tabular-nums leading-snug text-foreground">{children}</span>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function ShipDetail({ ship }: { ship: ShipCatalogItem }) {
  const slotTypes = ["engine", "shield", "weapon", "turret", "thruster"] as const;

  const slotDetailLines = useMemo(
    () =>
      slotTypes
        .map(t => ({ t, bd: shipDetailSlotBreakdown(ship, t) }))
        .filter(x => x.bd),
    [ship],
  );

  const cargoTag = ship.cargo?.tags?.[0] ?? null;
  const dragFwd  = ship.physics?.drag?.forward;
  const inertiaPitch = ship.physics?.inertia?.pitch;
  const inertiaYaw   = ship.physics?.inertia?.yaw;
  const inertiaRoll  = ship.physics?.inertia?.roll;

  const sectionId = `ship-detail-${ship.macro_id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  return (
    <div
      className={cn(
        "box-border w-full min-w-0 rounded-lg border border-border/80 bg-muted/25 p-4 text-xs",
        "sm:p-5",
        "animate-in fade-in slide-in-from-top-0.5 duration-200 fill-mode-both",
      )}
    >
      {ship.description && (
        <p className="mb-5 border-b border-border/70 pb-4 text-sm leading-relaxed text-muted-foreground wrap-break-words whitespace-normal">
          {ship.description}
        </p>
      )}

      {(() => {
        const imgUrl = (iconCatalogue as Record<string, string>)[ship.macro_id];
        return (
      <div className={cn("grid grid-cols-1 gap-8", imgUrl ? "md:grid-cols-4 md:gap-0" : "md:grid-cols-3 md:gap-0")}>
        <DetailSection id={`${sectionId}-slots`} title="Slots" className="md:border-r md:border-border/60 md:pr-6">
          {slotDetailLines.map(({ t, bd }) => (
            <DetailRow key={t} label={`${t}s`}>
              {bd}
            </DetailRow>
          ))}
          {slotDetailLines.length === 0 && (
            <p className="text-muted-foreground">No equipment slots</p>
          )}
        </DetailSection>

        <DetailSection
          id={`${sectionId}-storage`}
          title="Storage"
          className="md:border-r md:border-border/60 md:px-6"
        >
          {ship.cargo && (
            <DetailRow label="Cargo">
              <>
                {ship.cargo.max.toLocaleString()} t
                {cargoTag && <span className="ml-1 text-muted-foreground">({cargoTag})</span>}
              </>
            </DetailRow>
          )}
          {(["missile", "deployable", "countermeasure", "unit"] as const).map(key => {
            const val = ship.storage[key];
            if (!val) return null;
            return (
              <DetailRow key={key} label={key}>
                {val}
              </DetailRow>
            );
          })}
          {ship.radar_range != null && (
            <DetailRow label="Radar">{(ship.radar_range / 1000).toFixed(0)} km</DetailRow>
          )}
        </DetailSection>

        <DetailSection id={`${sectionId}-physics`} title="Physics" className={imgUrl ? "md:border-r md:border-border/60 md:px-6" : "md:pl-6"}>
          {ship.physics?.mass != null && (
            <DetailRow label="Mass">{fmt(ship.physics.mass, 1)}</DetailRow>
          )}
          {dragFwd != null && <DetailRow label="Drag forward">{fmt(dragFwd, 1)}</DetailRow>}
          {ship.physics?.drag?.reverse != null && (
            <DetailRow label="Drag reverse">{fmt(ship.physics.drag.reverse, 1)}</DetailRow>
          )}
          {inertiaPitch != null && <DetailRow label="Inertia pitch">{fmt(inertiaPitch, 2)}</DetailRow>}
          {inertiaYaw != null && <DetailRow label="Inertia yaw">{fmt(inertiaYaw, 2)}</DetailRow>}
          {inertiaRoll != null && <DetailRow label="Inertia roll">{fmt(inertiaRoll, 2)}</DetailRow>}
        </DetailSection>

        {imgUrl && (
          <div className="flex items-center justify-center md:pl-6">
            <img src={imgUrl} alt={ship.macro_id} className="max-h-32 max-w-full object-contain opacity-90" />
          </div>
        )}
      </div>
        );
      })()}

      <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-4 text-[11px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-1">
        {ship.owners.length > 0 && (
          <p className="min-w-0">
            <span className="font-medium text-foreground">Owners</span>
            <span className="mx-1.5 text-border">·</span>
            {ship.owners.map(o => factionLabel(o)).join(", ")}
          </p>
        )}
        <p className="min-w-0 break-all">
          <span className="font-medium text-foreground">Macro</span>
          <span className="mx-1.5 text-border">·</span>
          <span className="font-mono text-[0.7rem] text-foreground/90">{ship.macro_id}</span>
        </p>
      </footer>
    </div>
  );
}

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortCol = "name" | "faction" | "type" | "hull" | "crew" | "cargo" | "price";
type SortDir = "asc" | "desc";

function compareShips(a: ShipCatalogItem, b: ShipCatalogItem, col: SortCol, dir: SortDir): number {
  let result = 0;

  switch (col) {
    case "name":
      result = a.name.localeCompare(b.name);
      break;
    case "faction":
      result = factionLabel(a.faction).localeCompare(factionLabel(b.faction));
      break;
    case "type": {
      const ta = a.ship_type ? (TYPE_LABELS[a.ship_type] ?? a.ship_type) : "";
      const tb = b.ship_type ? (TYPE_LABELS[b.ship_type] ?? b.ship_type) : "";
      result = ta.localeCompare(tb);
      break;
    }
    case "hull":
      if (a.hull == null && b.hull == null) result = 0;
      else if (a.hull == null) result = 1;
      else if (b.hull == null) result = -1;
      else result = a.hull - b.hull;
      break;
    case "crew":
      if (a.people_capacity == null && b.people_capacity == null) result = 0;
      else if (a.people_capacity == null) result = 1;
      else if (b.people_capacity == null) result = -1;
      else result = a.people_capacity - b.people_capacity;
      break;
    case "cargo": {
      const ca = a.cargo?.max ?? null;
      const cb = b.cargo?.max ?? null;
      if (ca == null && cb == null) result = 0;
      else if (ca == null) result = 1;
      else if (cb == null) result = -1;
      else result = ca - cb;
      break;
    }
    case "price": {
      const pa = a.price?.average ?? null;
      const pb = b.price?.average ?? null;
      if (pa == null && pb == null) result = 0;
      else if (pa == null) result = 1;
      else if (pb == null) result = -1;
      else result = pa - pb;
      break;
    }
  }

  return dir === "asc" ? result : -result;
}

function SortHead({
  col, label, active, dir, align = "left", className = "", onSort,
}: {
  col: SortCol; label: string; active: SortCol; dir: SortDir;
  align?: "left" | "center" | "right"; className?: string;
  onSort: (col: SortCol) => void;
}) {
  const isActive = active === col;
  const Icon = isActive ? (dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  const alignClass = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <TableHead
      className={`cursor-pointer select-none ${className}`}
      onClick={() => onSort(col)}
    >
      <div className={`flex items-center gap-0.5 ${alignClass}`}>
        <span>{label}</span>
        <Icon className={`h-3 w-3 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground/40"}`} />
      </div>
    </TableHead>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShipsBrowser({ ships }: Props) {
  const [search, setSearch]         = useState("");
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortCol, setSortCol]       = useState<SortCol>("name");
  const [sortDir, setSortDir]       = useState<SortDir>("asc");

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setExpandedId(null); // collapse open row when re-sorting
  }

  const sizes = useMemo(() => {
    const set = new Set(ships.map(s => s.size ?? ""));
    return [...set].filter(sz => sz && sz !== "xs").sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99));
  }, [ships]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return ships.filter(s => {
      if (s.size === "xs") return false;
      if (sizeFilter && s.size !== sizeFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.macro_id.toLowerCase().includes(q) ||
        factionLabel(s.faction).toLowerCase().includes(q) ||
        (s.faction ?? "").toLowerCase().includes(q) ||
        (s.ship_type ? (TYPE_LABELS[s.ship_type] ?? s.ship_type).toLowerCase().includes(q) : false)
      );
    });
  }, [ships, search, sizeFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, ShipCatalogItem[]> = {};
    for (const ship of filtered) {
      const key = ship.size ?? "?";
      if (!g[key]) g[key] = [];
      g[key].push(ship);
    }
    // Sort each group independently so size headers stay in place
    for (const key of Object.keys(g)) {
      g[key].sort((a, b) => compareShips(a, b, sortCol, sortDir));
    }
    return g;
  }, [filtered, sortCol, sortDir]);

  const orderedSizes = useMemo(
    () => Object.keys(grouped).sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99)),
    [grouped]
  );

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  // chevron + name + faction, type, hull, crew, cargo + slot cols + missiles + deployables + price
  const COL_COUNT = 2 + SLOT_COLS.length + 8;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">

        {/* ── Filters ── */}
        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          <SearchField
            placeholder="Filter by name, macro, faction, type…"
            value={search}
            onValueChange={setSearch}
            className="flex-1 min-w-48"
          />

          {/* Size filter */}
          <div className="flex gap-1">
            <Badge
              variant={sizeFilter === null ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setSizeFilter(null)}
            >
              All
            </Badge>
            {sizes.map(sz => (
              <Badge
                key={sz}
                variant={sizeFilter === sz ? "default" : "outline"}
                className="cursor-pointer select-none"
                onClick={() => setSizeFilter(sz === sizeFilter ? null : sz)}
              >
                {SIZE_LABELS[sz] ?? sz.toUpperCase()}
              </Badge>
            ))}
          </div>

          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {filtered.length} ships
          </span>
        </div>

        {/* ── Table (native overflow so thead sticky works; stickyRoot avoids nested overflow-x on Table) ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-6" />
                <SortHead col="name"    label="Name"     active={sortCol} dir={sortDir} onSort={handleSort} className="w-48 max-w-48" />
                <SortHead col="faction" label="Faction"  active={sortCol} dir={sortDir} onSort={handleSort} align="center" className="w-24" />
                <SortHead col="type"    label="Type"     active={sortCol} dir={sortDir} onSort={handleSort} align="center" className="w-28" />
                <SortHead col="hull"    label="Hull"     active={sortCol} dir={sortDir} onSort={handleSort} align="right"  className="w-20" />
                <SortHead col="crew"    label="Crew"     active={sortCol} dir={sortDir} onSort={handleSort} align="center" className="w-12" />
                <SortHead col="cargo"   label="Cargo"    active={sortCol} dir={sortDir} onSort={handleSort} align="right"  className="w-28" />
                {SLOT_COLS.map(t => (
                  <TableHead key={t} className="w-10 text-center">{SLOT_COL_LABELS[t]}</TableHead>
                ))}
                <TableHead className="w-10 text-center">Missiles</TableHead>
                <TableHead className="w-10 text-center">Deployables</TableHead>
                <SortHead col="price"   label="Avg price" active={sortCol} dir={sortDir} onSort={handleSort} align="right" className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedSizes.map(size => (
                <Fragment key={size}>
                  {/* Size group header */}
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COL_COUNT} className="py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {SIZE_LABELS[size] ?? size.toUpperCase()} — {grouped[size].length} ships
                    </TableCell>
                  </TableRow>

                  {grouped[size].map(ship => {
                    const isExpanded = expandedId === ship.macro_id;
                    return (
                      <Fragment key={ship.macro_id}>
                        {/* Main row */}
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpand(ship.macro_id)}
                        >
                          <TableCell className="text-muted-foreground pr-0">
                            {isExpanded
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />
                            }
                          </TableCell>
                          <TableCell className="font-medium w-48 max-w-48">
                            <span className="block truncate" title={ship.name}>
                              {ship.name}
                              {!ship.player_usable && (
                                <span className="ml-1 text-xs text-muted-foreground">(NPC)</span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs">{factionLabel(ship.faction)}</TableCell>
                          <TableCell className="text-center text-xs">
                            {ship.ship_type ? (TYPE_LABELS[ship.ship_type] ?? ship.ship_type) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmt(ship.hull)}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">
                            {ship.people_capacity ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {ship.cargo
                              ? `${ship.cargo.max.toLocaleString()} t`
                              : "—"}
                          </TableCell>
                          {SLOT_COLS.map(t => (
                            <TableCell key={t} className="text-center font-mono text-xs">
                              {slotTotal(ship.slot_counts, t) || "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-center font-mono text-xs">
                            {ship.storage["missile"] ?? "—"}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">
                            {ship.storage["deployable"] ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {ship.price ? ship.price.average.toLocaleString() : "—"}
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <TableRow className="hover:bg-transparent bg-muted/20">
                            {/* Même colonne que le chevron : laisse le détail commencer sous le nom du vaisseau */}
                            <TableCell
                              className="py-0.5 text-muted-foreground pr-0 align-top"
                              aria-hidden
                            />
                            <TableCell
                              colSpan={COL_COUNT - 1}
                              className="min-w-0 px-0 py-0.5 align-top whitespace-normal"
                            >
                              <ShipDetail ship={ship} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
