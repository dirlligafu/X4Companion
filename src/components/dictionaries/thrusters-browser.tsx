import { Fragment, useMemo, useState, type ReactNode } from "react";
import iconCatalogue from "@/data/icon_catalogue.json";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ThrusterCatalogItem } from "@/types/save";
import {
  buildFlatLayout,
  buildSeriesLayout,
  type CatalogLayoutMode,
  SIZE_ORDER,
} from "./catalog-table-layout";
import { EquipmentCatalogNameCell } from "./equipment-catalog-name-cell";

type Props = { thrusters: ThrusterCatalogItem[] };

const SIZE_LABELS: Record<string, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

const FACTION_LABELS: Record<string, string> = {
  arg: "Argon", par: "Paranid", tel: "Teladi", spl: "Split", ter: "Terran",
  atf: "ATF", ant: "Antigone", bor: "Boron", gen: "Generic", seg: "Segaris",
};

function factionLabel(f: string | null) {
  if (!f) return "—";
  return FACTION_LABELS[f] ?? f.toUpperCase();
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString();
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailSection({ id, title, className, children }: { id: string; title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn("min-w-0", className)} aria-labelledby={id}>
      <h3 id={id} className="mb-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
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

function ThrusterDetail({ thruster: t }: { thruster: ThrusterCatalogItem }) {
  const sid = `thruster-${t.macro_id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <div className={cn(
      "box-border w-full min-w-0 rounded-lg border border-border/80 bg-muted/25 p-4 text-xs sm:p-5",
      "animate-in fade-in slide-in-from-top-0.5 duration-200 fill-mode-both",
    )}>
      {t.description && (
        <p className="mb-5 border-b border-border/70 pb-4 text-sm leading-relaxed text-muted-foreground whitespace-normal">{t.description}</p>
      )}

      {(() => {
        const imgUrl = (iconCatalogue as Record<string, string>)[t.macro_id];
        return (
          <div className={cn("grid grid-cols-1 gap-8", imgUrl ? "md:grid-cols-4 md:gap-0" : "md:grid-cols-3 md:gap-0")}>
            <DetailSection id={`${sid}-thrust`} title="Thrust" className="md:border-r md:border-border/60 md:pr-6">
              {t.thrust?.strafe != null && <DetailRow label="Strafe">{t.thrust.strafe.toLocaleString()} kN</DetailRow>}
              {t.thrust?.pitch  != null && <DetailRow label="Pitch">{t.thrust.pitch.toLocaleString()} kN</DetailRow>}
              {t.thrust?.yaw    != null && <DetailRow label="Yaw">{t.thrust.yaw.toLocaleString()} kN</DetailRow>}
              {t.thrust?.roll   != null && <DetailRow label="Roll">{t.thrust.roll.toLocaleString()} kN</DetailRow>}
            </DetailSection>

            <DetailSection id={`${sid}-angular`} title="Angular" className="md:border-r md:border-border/60 md:px-6">
              {t.angular?.pitch != null && <DetailRow label="Pitch rate">{t.angular.pitch.toFixed(1)} °/s</DetailRow>}
              {t.angular?.roll  != null && <DetailRow label="Roll rate">{t.angular.roll.toFixed(1)} °/s</DetailRow>}
            </DetailSection>

            <DetailSection id={`${sid}-economy`} title="Economy" className={imgUrl ? "md:border-r md:border-border/60 md:px-6" : "md:pl-6"}>
              {t.price && (
                <>
                  <DetailRow label="Avg price">{t.price.average.toLocaleString()}</DetailRow>
                  <DetailRow label="Min / Max">{t.price.min.toLocaleString()} / {t.price.max.toLocaleString()}</DetailRow>
                </>
              )}
              <DetailRow label="Faction">{factionLabel(t.faction)}</DetailRow>
            </DetailSection>

            {imgUrl && (
              <div className="flex items-center justify-center md:pl-6">
                <img src={imgUrl} alt={t.macro_id} className="max-h-32 max-w-full object-contain opacity-90" />
              </div>
            )}
          </div>
        );
      })()}

      <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 pt-4 text-[11px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-1">
        {t.basename && (
          <p>
            <span className="font-medium text-foreground">Series</span>
            <span className="mx-1.5 text-border">·</span>
            <span className="text-foreground/90">{t.basename}</span>
          </p>
        )}
        {t.owners.length > 0 && (
          <p><span className="font-medium text-foreground">Owners</span><span className="mx-1.5 text-border">·</span>{t.owners.map(factionLabel).join(", ")}</p>
        )}
        <p className="break-all"><span className="font-medium text-foreground">Macro</span><span className="mx-1.5 text-border">·</span><span className="font-mono text-[0.7rem] text-foreground/90">{t.macro_id}</span></p>
      </footer>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const COL_COUNT = 9; // chevron + name + faction + mk + strafe + pitch + yaw + roll + avg price

export function ThrustersBrowser({ thrusters }: Props) {
  const [search, setSearch]         = useState("");
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<CatalogLayoutMode>("series");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) { setExpandedId(p => p === id ? null : id); }

  function thrusterDataRow(t: ThrusterCatalogItem) {
    const isExpanded = expandedId === t.macro_id;
    return (
      <Fragment key={t.macro_id}>
        <TableRow className="cursor-pointer" onClick={() => toggleExpand(t.macro_id)}>
          <TableCell className="text-muted-foreground pr-0">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </TableCell>
          <TableCell className="max-w-56">
            <EquipmentCatalogNameCell name={t.name} playerUsable={t.player_usable} />
          </TableCell>
          <TableCell className="text-center text-xs">{factionLabel(t.faction)}</TableCell>
          <TableCell className="text-center font-mono text-xs">{t.mk ?? "—"}</TableCell>
          <TableCell className="text-right font-mono text-xs">{fmt(t.thrust?.strafe)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{fmt(t.thrust?.pitch)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{fmt(t.thrust?.yaw)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{fmt(t.thrust?.roll)}</TableCell>
          <TableCell className="text-right font-mono text-xs">{t.price ? t.price.average.toLocaleString() : "—"}</TableCell>
        </TableRow>
        {isExpanded && (
          <TableRow className="hover:bg-transparent bg-muted/20">
            <TableCell className="py-0.5 pr-0 align-top text-muted-foreground" aria-hidden />
            <TableCell colSpan={COL_COUNT - 1} className="min-w-0 px-0 py-0.5 align-top whitespace-normal">
              <ThrusterDetail thruster={t} />
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  }

  const sizes = useMemo(() => {
    const set = new Set(thrusters.map(t => t.size).filter((s): s is string => s !== null));
    return [...set].sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99));
  }, [thrusters]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return thrusters.filter(t => {
      if (sizeFilter && t.size !== sizeFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.macro_id.toLowerCase().includes(q) ||
        (t.basename ?? "").toLowerCase().includes(q) ||
        factionLabel(t.faction).toLowerCase().includes(q)
      );
    });
  }, [thrusters, search, sizeFilter]);

  const seriesLayout = useMemo(() => buildSeriesLayout(filtered), [filtered]);
  const flatLayout   = useMemo(() => buildFlatLayout(filtered), [filtered]);
  const activeLayout = layoutMode === "series" ? seriesLayout : flatLayout;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          <SearchField placeholder="Filter by name, series, macro, faction…" value={search} onValueChange={setSearch} className="flex-1 min-w-48" />
          <div className="flex gap-1">
            <Badge variant={sizeFilter === null ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => setSizeFilter(null)}>All sizes</Badge>
            {sizes.map(sz => (
              <Badge key={sz} variant={sizeFilter === sz ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => setSizeFilter(sz === sizeFilter ? null : sz)}>
                {SIZE_LABELS[sz] ?? sz.toUpperCase()}
              </Badge>
            ))}
          </div>
          <div className="flex gap-1" title="Series: group by product line within each size. Flat: sort by faction then mark for comparison; series only in name and detail.">
            <Badge variant={layoutMode === "series" ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => setLayoutMode("series")}>By series</Badge>
            <Badge variant={layoutMode === "flat" ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => setLayoutMode("flat")}>Flat</Badge>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{filtered.length} items</span>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-6" />
                <TableHead>Name</TableHead>
                <TableHead className="w-20 text-center">Faction</TableHead>
                <TableHead className="w-8  text-center">Mark</TableHead>
                <TableHead className="w-20 text-right">Strafe</TableHead>
                <TableHead className="w-20 text-right">Pitch</TableHead>
                <TableHead className="w-20 text-right">Yaw</TableHead>
                <TableHead className="w-20 text-right">Roll</TableHead>
                <TableHead className="w-24 text-right">Avg price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeLayout.orderedSizes.map(size => {
                const flatItems = layoutMode === "flat" ? (activeLayout.sizeBuckets[size] ?? []) : null;
                return (
                  <Fragment key={size}>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={COL_COUNT} className="py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                        {SIZE_LABELS[size] ?? size.toUpperCase()} — {activeLayout.sizeBuckets[size].length} items
                      </TableCell>
                    </TableRow>
                    {layoutMode === "series"
                      ? (seriesLayout.sizeToFamilies[size] ?? []).map(({ family, items }) => (
                          <Fragment key={`${size}-${family}`}>
                            <TableRow className="bg-muted/15 hover:bg-muted/15">
                              <TableCell
                                colSpan={COL_COUNT}
                                className="py-1 pl-6 text-[11px] font-medium tracking-wide text-muted-foreground/95 border-t border-border/40"
                              >
                                {family === "—" ? "Other" : family}
                                <span className="ml-1.5 tabular-nums font-normal text-muted-foreground/80">
                                  ({items.length})
                                </span>
                              </TableCell>
                            </TableRow>
                            {items.map(t => thrusterDataRow(t))}
                          </Fragment>
                        ))
                      : (flatItems ?? []).map(t => thrusterDataRow(t))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
