import { useState, useMemo, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModuleCargoInfo, NpcInfo, PlayerBasics, StationInfo, WareCargoInfo } from "@/types/save";

type StationsTabProps = {
  data: PlayerBasics;
  stationSearch: string;
  setStationSearch: (v: string) => void;
  sectorNames: Record<string, string>;
  wareLabels: Record<string, string>;
  wareCargoInfo: Record<string, WareCargoInfo>;
  moduleCargoIndex: Record<string, ModuleCargoInfo>;
  editStationCargo: Map<string, Map<string, number>>;
  updateStationWare: (stationCode: string, wareId: string, amount: number) => void;
  onSelectEmployee?: (name: string) => void;
};

/** cluster_31_sector001 → nom réel ou "C31 · S001" en fallback */
function formatSector(macro: string | null, sectorNames: Record<string, string>): string {
  if (!macro) return "—";
  const real = sectorNames[macro + "_macro"];
  if (real) return real;
  const m = macro.match(/cluster_(\d+)_sector(\d+)/);
  if (m) return `C${m[1]} · S${m[2]}`;
  return macro;
}

const MODULE_TYPES: Record<string, string> = {
  defence: "Defence",
  pier: "Pier",
  hab: "Habitation",
  dockarea: "Dock Area",
  storage: "Storage",
  production: "Production",
  connectionmodule: "Connection",
  highwaymodule: "Highway",
};

function moduleType(macro: string): string {
  const prefix = macro.split("_")[0];
  return MODULE_TYPES[prefix] ?? prefix;
}

function groupModules(macros: string[]): string {
  if (macros.length === 0) return "—";
  const counts = new Map<string, number>();
  for (const m of macros) {
    const type = moduleType(m);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, n]) => `${n}× ${type}`)
    .join(" · ");
}

function managerCell(managers: NpcInfo[], onSelect?: (name: string) => void) {
  if (managers.length === 0)
    return <span className="italic text-muted-foreground/50">none</span>;
  return (
    <span>
      {managers.map((m, i) => (
        <span key={m.code}>
          {i > 0 && <span className="text-muted-foreground/40">, </span>}
          <span
            className="cursor-pointer hover:text-foreground"
            onClick={() => onSelect?.(m.name)}
          >
            {m.name}
            {m.management > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">★{m.management}</span>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

const CARGO_TYPE_LABEL: Record<string, string> = { container: "Container", solid: "Solid", liquid: "Liquid" };

function StationDetailRow({ station, npcs, wareLabels, wareCargoInfo, moduleCargoIndex, editCargoMap, onUpdateWare }: {
  station: StationInfo;
  npcs: NpcInfo[];
  wareLabels: Record<string, string>;
  wareCargoInfo: Record<string, WareCargoInfo>;
  moduleCargoIndex: Record<string, ModuleCargoInfo>;
  editCargoMap: Map<string, number> | undefined;
  onUpdateWare: (wareId: string, amount: number) => void;
}) {
  const hasModules = station.modules.length > 0;
  const hasStaff = npcs.length > 0;
  const sortedCargo = [...station.cargo].sort((a, b) => b.amount - a.amount);
  const hasCargo = sortedCargo.length > 0;

  const capacities: Record<string, number> = {};
  for (const slot of station.storage_slots ?? []) {
    if (slot.connection !== "space") continue;
    const info = moduleCargoIndex[slot.macro_id];
    if (!info) continue;
    for (const type of info.types) {
      capacities[type] = (capacities[type] ?? 0) + info.capacity;
    }
  }

  // Effective amount = edited value if present, otherwise original
  const effAmount = (ware: string, orig: number) => editCargoMap?.get(ware) ?? orig;

  // Used volume per type using effective amounts
  const usedVolume: Record<string, number> = {};
  for (const { ware, amount } of station.cargo) {
    const info = wareCargoInfo[ware];
    if (!info) continue;
    usedVolume[info.transport] = (usedVolume[info.transport] ?? 0) + effAmount(ware, amount) * info.volume;
  }

  const capacityEntries = (["container", "solid", "liquid"] as const)
    .filter(t => capacities[t] > 0)
    .map(t => ({ type: t, cap: capacities[t], used: usedVolume[t] ?? 0 }));
  const hasCapacity = capacityEntries.length > 0;

  const maxForWare = (ware: string): number => {
    const info = wareCargoInfo[ware];
    if (!info?.volume) return 0;
    const cap = capacities[info.transport] ?? 0;
    const usedByOthers = station.cargo
      .filter(c => c.ware !== ware && wareCargoInfo[c.ware]?.transport === info.transport)
      .reduce((s, c) => s + effAmount(c.ware, c.amount) * (wareCargoInfo[c.ware]?.volume ?? 0), 0);
    return Math.max(0, Math.floor((cap - usedByOthers) / info.volume));
  };

  const shareEvenly = (type: string) => {
    const items = station.cargo.filter(c => wareCargoInfo[c.ware]?.transport === type);
    if (items.length === 0) return;
    const cap = capacities[type] ?? 0;
    for (const { ware } of items) {
      const vol = wareCargoInfo[ware]?.volume ?? 1;
      onUpdateWare(ware, Math.floor(cap / items.length / vol));
    }
  };

  if (!hasModules && !hasStaff && !hasCargo && !hasCapacity) return null;

  const byRole = {
    manager: npcs.filter(n => n.post === "manager" || n.post === "buildmanager").length,
    defence: npcs.filter(n => n.post === "defence").length,
    engineer: npcs.filter(n => n.post === "engineer").length,
  };
  const other = npcs.length - byRole.manager - byRole.defence - byRole.engineer;

  const staffParts = [
    byRole.manager > 0 && `${byRole.manager} manager${byRole.manager > 1 ? "s" : ""}`,
    byRole.defence > 0 && `${byRole.defence} defence`,
    byRole.engineer > 0 && `${byRole.engineer} engineer${byRole.engineer > 1 ? "s" : ""}`,
    other > 0 && `${other} other`,
  ].filter(Boolean) as string[];

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={6} className="py-2 px-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {hasModules && (
            <>
              <span className="text-muted-foreground font-medium">Modules</span>
              <span>{groupModules(station.modules)}</span>
            </>
          )}
          {hasStaff && staffParts.length > 0 && (
            <>
              <span className="text-muted-foreground font-medium">Staff</span>
              <span className="text-muted-foreground">{staffParts.join(" · ")}</span>
            </>
          )}
          {hasCapacity && !hasCargo && (
            <>
              <span className="text-muted-foreground font-medium">Capacity</span>
              <span>{capacityEntries.map(({ type, cap }) => `${CARGO_TYPE_LABEL[type]} ${cap.toLocaleString()}`).join(" · ")}</span>
            </>
          )}
          {hasCargo && (() => {
            const groups = new Map<string, typeof sortedCargo>();
            for (const item of sortedCargo) {
              const t = wareCargoInfo[item.ware]?.transport ?? "other";
              const g = groups.get(t) ?? [];
              g.push(item);
              groups.set(t, g);
            }
            const typeOrder = ["container", "solid", "liquid", "other"];
            const orderedGroups = typeOrder.flatMap(t => {
              const items = groups.get(t);
              return items ? [{ type: t, items }] : [];
            });
            return (
              <>
                <span className="text-muted-foreground font-medium pt-0.5">Cargo</span>
                <div className="flex flex-col gap-3 w-fit min-w-[360px]">
                  {orderedGroups.map(({ type, items }) => {
                    const capEntry = capacityEntries.find(e => e.type === type);
                    const cap = capEntry?.cap ?? 0;
                    const used = capEntry?.used ?? 0;
                    const pctBar = cap > 0 ? Math.min(Math.round(used / cap * 100), 100) : 0;
                    return (
                      <div key={type}>
                        {/* Type header + capacity bar */}
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 w-16 shrink-0">
                            {CARGO_TYPE_LABEL[type] ?? type}
                          </span>
                          {cap > 0 && (
                            <>
                              <div className="relative h-1.5 w-36 rounded-full bg-muted overflow-hidden">
                                <div className="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-all"
                                  style={{ width: `${pctBar}%` }} />
                              </div>
                              <span className="text-muted-foreground/70 tabular-nums">
                                {used.toLocaleString()} / {cap.toLocaleString()} ({pctBar}%)
                              </span>
                              <button
                                className="text-[10px] text-muted-foreground/50 hover:text-foreground underline underline-offset-2 ml-1"
                                onClick={() => shareEvenly(type)}
                              >
                                share evenly
                              </button>
                            </>
                          )}
                        </div>
                        {/* Ware rows */}
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 items-center">
                          {items.map(({ ware, amount }) => {
                            const info = wareCargoInfo[ware];
                            const cur = effAmount(ware, amount);
                            const maxAmt = maxForWare(ware);
                            const pct = info && cap > 0 ? Math.round(cur * info.volume / cap * 100) : null;
                            return (
                              <Fragment key={ware}>
                                <span className="text-muted-foreground truncate">{wareLabels[ware] ?? ware}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={maxAmt}
                                  value={cur}
                                  onChange={e => {
                                    const v = Math.max(0, Math.min(maxAmt, parseInt(e.target.value, 10) || 0));
                                    onUpdateWare(ware, v);
                                  }}
                                  className="w-28 rounded border border-input bg-background px-1.5 py-0.5 text-right tabular-nums text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                                <button
                                  className="text-[10px] text-muted-foreground/50 hover:text-foreground px-1"
                                  onClick={() => onUpdateWare(ware, maxAmt)}
                                >
                                  MAX
                                </button>
                                <span className="tabular-nums text-muted-foreground/70 w-8 text-right">
                                  {pct !== null ? `${pct}%` : ""}
                                </span>
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function StationsTab({
  data,
  stationSearch,
  setStationSearch,
  sectorNames,
  wareLabels,
  wareCargoInfo,
  moduleCargoIndex,
  editStationCargo,
  updateStationWare,
  onSelectEmployee,
}: StationsTabProps) {
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const npcsByStation = useMemo(() => {
    const map = new Map<string, NpcInfo[]>();
    for (const npc of data.npcs) {
      if (npc.station_code) {
        const list = map.get(npc.station_code) ?? [];
        list.push(npc);
        map.set(npc.station_code, list);
      }
    }
    return map;
  }, [data.npcs]);

  const list = useMemo(() => {
    const q = stationSearch.toLowerCase();
    return data.stations
      .filter(st => {
        if (!q) return true;
        const npcs = npcsByStation.get(st.code) ?? [];
        const managerNames = npcs
          .filter(n => n.post === "manager" || n.post === "buildmanager")
          .map(n => n.name)
          .join(" ");
        return (
          (st.name ?? "").toLowerCase().includes(q) ||
          st.code.toLowerCase().includes(q) ||
          st.faction.toLowerCase().includes(q) ||
          formatSector(st.sector_macro, sectorNames).toLowerCase().includes(q) ||
          managerNames.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const na = a.name ?? a.code;
        const nb = b.name ?? b.code;
        return na.localeCompare(nb);
      });
  }, [data.stations, stationSearch, npcsByStation]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <SearchField
          placeholder="Filter by name, faction, sector or manager…"
          value={stationSearch}
          onValueChange={setStationSearch}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Faction</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Manager(s)</TableHead>
                <TableHead className="text-center">Staff</TableHead>
                <TableHead className="text-muted-foreground font-normal text-center">Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map(station => {
                const npcs = npcsByStation.get(station.code) ?? [];
                const managers = npcs.filter(
                  n => n.post === "manager" || n.post === "buildmanager"
                );
                const isExpanded = expandedCode === station.code;
                return (
                  <Fragment key={station.code}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedCode(isExpanded ? null : station.code)}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">
                          {station.name ?? (
                            <span className="italic text-muted-foreground/50">unnamed</span>
                          )}
                          {station.kind === "buildstorage" && (
                            <span className="inline-block rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0 font-mono text-[9px] text-amber-600 dark:text-amber-400">
                              Build Storage
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm uppercase font-mono text-muted-foreground">
                        {station.faction || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatSector(station.sector_macro, sectorNames)}
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        onClick={e => e.stopPropagation()}
                      >
                        {managerCell(managers, onSelectEmployee)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-sm">
                        {npcs.length > 0 ? npcs.length : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground text-center">
                        {station.code}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <StationDetailRow
                        station={station}
                        npcs={npcs}
                        wareLabels={wareLabels}
                        wareCargoInfo={wareCargoInfo}
                        moduleCargoIndex={moduleCargoIndex}
                        editCargoMap={editStationCargo.get(station.code)}
                        onUpdateWare={(wareId, amount) => updateStationWare(station.code, wareId, amount)}
                      />
                    )}
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
