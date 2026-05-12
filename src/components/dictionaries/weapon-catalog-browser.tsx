import { Fragment, useMemo, useState, type ReactNode } from "react";
import iconCatalogue from "@/data/icon_catalogue.json";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import type { WeaponCatalogItem } from "@/types/save";

export type WeaponCatalogBrowserProps = {
  items: WeaponCatalogItem[];
};

const SIZE_ORDER: Record<string, number> = { xs: 0, s: 1, m: 2, l: 3, xl: 4 };
const SIZE_LABELS: Record<string, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

const FACTION_LABELS: Record<string, string> = {
  arg: "Argon", par: "Paranid", tel: "Teladi", spl: "Split", ter: "Terran",
  atf: "ATF", ant: "Antigone", bor: "Boron", kha: "Kha'ak", xen: "Xenon",
  pir: "Pirate", hol: "HOP", fre: "Free Families", seg: "Segaris",
  yak: "Yaki", zyar: "Zyarth", gen: "Generic",
};

function factionLabel(f: string | null) {
  if (!f) return "—";
  return FACTION_LABELS[f] ?? f.toUpperCase();
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString();
}

function DetailSection({
  id, title, className, children,
}: {
  id: string; title: string; className?: string; children: ReactNode;
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

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-foreground/90">
      <span className="w-29 shrink-0 capitalize text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono tabular-nums leading-snug text-foreground">{children}</span>
    </div>
  );
}

function WeaponDetail({ weapon: w }: { weapon: WeaponCatalogItem }) {
  const sectionId = `weapon-detail-${w.macro_id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const reloadLabel = w.reload.rate != null
    ? `${w.reload.rate.toFixed(2)} /s`
    : w.reload.time != null
      ? `${w.reload.time.toFixed(2)} s (beam cycle)`
      : "—";

  return (
    <div
      className={cn(
        "box-border w-full min-w-0 rounded-lg border border-border/80 bg-muted/25 p-4 text-xs",
        "sm:p-5",
        "animate-in fade-in slide-in-from-top-0.5 duration-200 fill-mode-both",
      )}
    >
      {w.description && (
        <p className="mb-5 border-b border-border/70 pb-4 text-sm leading-relaxed text-muted-foreground whitespace-normal wrap-break-words">
          {w.description}
        </p>
      )}

      {(() => {
        const imgUrl = (iconCatalogue as Record<string, string>)[w.macro_id];
        return (
      <div className={cn("grid grid-cols-1 gap-8", imgUrl ? "md:grid-cols-3 md:gap-0" : "md:grid-cols-2 md:gap-0")}>

        <DetailSection id={`${sectionId}-stats`} title="Combat" className="md:border-r md:border-border/60 md:pr-6">
          {w.damage.hull != null && (
            <DetailRow label="Dmg hull">{w.damage.hull.toLocaleString()}</DetailRow>
          )}
          {w.damage.shield != null && (
            <DetailRow label="Dmg shield">{w.damage.shield.toLocaleString()}</DetailRow>
          )}
          <DetailRow label="Reload">{reloadLabel}</DetailRow>
          {w.dps_hull != null && (
            <DetailRow label="DPS hull">{fmt(w.dps_hull, 1)}</DetailRow>
          )}
          {w.dps_shield != null && (
            <DetailRow label="DPS shield">{fmt(w.dps_shield, 1)}</DetailRow>
          )}
          {w.range_km != null && (
            <DetailRow label="Range">{w.range_km.toFixed(1)} km</DetailRow>
          )}
          {w.hull != null && (
            <DetailRow label="Hull HP">{w.hull.toLocaleString()}</DetailRow>
          )}
        </DetailSection>

        <DetailSection id={`${sectionId}-bullet`} title="Projectile" className={imgUrl ? "md:border-r md:border-border/60 md:px-6" : "md:pl-6"}>
          {w.bullet.speed != null && (
            <DetailRow label="Speed">{Math.round(w.bullet.speed).toLocaleString()} m/s</DetailRow>
          )}
          {w.bullet.lifetime != null && (
            <DetailRow label="Lifetime">{w.bullet.lifetime.toFixed(2)} s</DetailRow>
          )}
          {w.bullet.chargetime != null && (
            <DetailRow label="Charge">{w.bullet.chargetime.toFixed(2)} s</DetailRow>
          )}
          {(w.bullet.amount > 1 || w.bullet.barrelamount > 1) && (
            <DetailRow label="Projectiles">
              {w.bullet.amount > 1 ? `${w.bullet.amount}× ` : ""}
              {w.bullet.barrelamount > 1 ? `${w.bullet.barrelamount} barrels` : ""}
            </DetailRow>
          )}
          {w.heat_value != null && (
            <DetailRow label="Heat">{w.heat_value.toLocaleString()}</DetailRow>
          )}
          {w.weapon_system && (
            <DetailRow label="System">{w.weapon_system}</DetailRow>
          )}
          {w.price && (
            <DetailRow label="Avg price">{w.price.average.toLocaleString()}</DetailRow>
          )}
        </DetailSection>
        {imgUrl && (
          <div className="flex items-center justify-center md:pl-6">
            <img
              src={imgUrl}
              alt={w.name}
              className="max-h-32 max-w-full object-contain opacity-90"
            />
          </div>
        )}
      </div>
        );
      })()}

      <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-4 text-[11px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-1">
        {w.owners.length > 0 && (
          <p className="min-w-0">
            <span className="font-medium text-foreground">Owners</span>
            <span className="mx-1.5 text-border">·</span>
            {w.owners.map(o => factionLabel(o)).join(", ")}
          </p>
        )}
        <p className="min-w-0 break-all">
          <span className="font-medium text-foreground">Macro</span>
          <span className="mx-1.5 text-border">·</span>
          <span className="font-mono text-[0.7rem] text-foreground/90">{w.macro_id}</span>
        </p>
      </footer>
    </div>
  );
}

const COL_COUNT = 11; // chevron + name + faction + type + mk + DPS hull + DPS shield + range + speed + RoF + detail colSpan

/** Shared table + detail panel for a weapon-catalog slice (fixed guns or turrets). */
export function WeaponCatalogBrowser({ items }: WeaponCatalogBrowserProps) {
  const [search, setSearch]         = useState("");
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  const sizes = useMemo(() => {
    const set = new Set(items.map(w => w.size).filter((s): s is string => s !== null));
    return [...set].sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter(w => {
      if (sizeFilter && w.size !== sizeFilter) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.macro_id.toLowerCase().includes(q) ||
        factionLabel(w.faction).toLowerCase().includes(q) ||
        (w.faction ?? "").toLowerCase().includes(q) ||
        (w.weapon_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, sizeFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, WeaponCatalogItem[]> = {};
    for (const w of filtered) {
      const key = w.size ?? "?";
      if (!g[key]) g[key] = [];
      g[key].push(w);
    }
    return g;
  }, [filtered]);

  const orderedSizes = useMemo(
    () => Object.keys(grouped).sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99)),
    [grouped]
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">

        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          <SearchField
            placeholder="Filter by name, macro, faction, type…"
            value={search}
            onValueChange={setSearch}
            className="flex-1 min-w-48"
          />

          <div className="flex gap-1">
            <Badge
              variant={sizeFilter === null ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setSizeFilter(null)}
            >
              All sizes
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
            {filtered.length} items
          </span>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-6" />
                <TableHead>Name</TableHead>
                <TableHead className="w-20 text-center">Faction</TableHead>
                <TableHead className="w-20 text-center">Type</TableHead>
                <TableHead className="w-8  text-center">Mark</TableHead>
                <TableHead className="w-20 text-right">DPS Hull</TableHead>
                <TableHead className="w-20 text-right">DPS Shield</TableHead>
                <TableHead className="w-16 text-right">Range</TableHead>
                <TableHead className="w-20 text-right">Speed</TableHead>
                <TableHead className="w-16 text-right">RoF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedSizes.map(size => (
                <Fragment key={size}>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COL_COUNT} className="py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {SIZE_LABELS[size] ?? size.toUpperCase()} — {grouped[size].length} items
                    </TableCell>
                  </TableRow>
                  {grouped[size].map(w => {
                    const isExpanded = expandedId === w.macro_id;
                    return (
                      <Fragment key={w.macro_id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpand(w.macro_id)}
                        >
                          <TableCell className="text-muted-foreground pr-0">
                            {isExpanded
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />
                            }
                          </TableCell>
                          <TableCell className="font-medium">
                            <span className="block truncate" title={w.name}>
                              {w.name}
                              {!w.player_usable && (
                                <span className="ml-1 text-xs text-muted-foreground">(NPC)</span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-xs">{factionLabel(w.faction)}</TableCell>
                          <TableCell className="text-center text-xs">{w.weapon_type ?? "—"}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{w.mk ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(w.dps_hull, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{fmt(w.dps_shield, 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {w.range_km != null ? `${w.range_km.toFixed(1)} km` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {w.bullet.speed != null ? `${Math.round(w.bullet.speed).toLocaleString()} m/s` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {w.reload.rate != null ? w.reload.rate.toFixed(1) : "—"}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="hover:bg-transparent bg-muted/20">
                            <TableCell className="py-0.5 pr-0 align-top text-muted-foreground" aria-hidden />
                            <TableCell
                              colSpan={COL_COUNT - 1}
                              className="min-w-0 px-0 py-0.5 align-top whitespace-normal"
                            >
                              <WeaponDetail weapon={w} />
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
