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
import { Button } from "@/components/ui/button";
import { ShipDetailDialog } from "@/components/save-editor/ship-detail";
import { FLEET_SIZE_ORDER, shipSizeBadgeClass } from "@/lib/fleet-styles";
import { groupEquip, softwareLabel } from "@/lib/ship-display";
import { useEquipmentCatalog } from "@/hooks/useEquipmentCatalog";
import type { EquipmentCatalog, NpcInfo, PlayerBasics, ShipInfo, ShipMod } from "@/types/save";

type ModEntry = { name: string | null; quality: number };
type ModIndex = Record<string, ModEntry>;


type FleetTabProps = {
  data: PlayerBasics;
  fleetSearch: string;
  setFleetSearch: (v: string) => void;
  editShipNames: Map<string, string>;
  updateShipName: (code: string, name: string) => void;
  shipLabels: Record<string, string>;
  sectorNames: Record<string, string>;
  savePath: string;
  onSelectEmployee?: (name: string) => void;
  modIndex?: ModIndex;
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

/** Sous-texte type collection-ships PHP : cluster + zone raccourcis */
function formatGeoHint(cluster: string | null | undefined, zone: string | null | undefined): string {
  const parts: string[] = [];
  if (cluster) {
    const c = cluster.match(/cluster_(\d+)/);
    parts.push(c ? `C${c[1]}` : cluster);
  }
  if (zone) {
    const z = zone.match(/^zone(\d+)_/);
    parts.push(z ? `Z${z[1]}` : zone.replace(/_macro$/, ""));
  }
  return parts.join(" · ");
}

function pilotCell(pilot: NpcInfo | undefined) {
  if (!pilot) return <span className="italic text-muted-foreground/50">no pilot</span>;
  return (
    <span>
      {pilot.name}
      {pilot.piloting > 0 && (
        <span className="ml-1.5 text-xs text-muted-foreground">★{pilot.piloting}</span>
      )}
    </span>
  );
}

function LoadoutRow({ ship, equipmentCatalog, modIndex }: { ship: ShipInfo; equipmentCatalog?: EquipmentCatalog; modIndex?: ModIndex }) {
  const modsByScope = (ship.mods ?? []).reduce<Record<string, typeof ship.mods>>((acc, mod) => {
    if (mod.scope === "paint") return acc;
    (acc[mod.scope] ??= []).push(mod);
    return acc;
  }, {});

  const shipMods = modsByScope["ship"] ?? [];

  const hasLoadout =
    ship.shields.length > 0 ||
    ship.weapons.length > 0 ||
    ship.turrets.length > 0 ||
    ship.engines.length > 0 ||
    ship.thruster != null ||
    ship.software.length > 0 ||
    ship.current_order != null ||
    Object.keys(modsByScope).length > 0;

  if (!hasLoadout) return null;

  const allItems = equipmentCatalog
    ? [...equipmentCatalog.weapons, ...equipmentCatalog.engines, ...equipmentCatalog.shields, ...equipmentCatalog.thrusters]
    : [];
  const nameOf = (macro: string) => {
    const key = macro.replace(/_macro$/, "");
    return allItems.find(i => i.macro_id.replace(/_macro$/, "") === key)?.name ?? groupEquip([macro]);
  };
  const toLines = (macros: string[]) => {
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const m of macros) {
      const lbl = nameOf(m);
      if (!counts.has(lbl)) order.push(lbl);
      counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
    }
    return order.map(lbl => counts.get(lbl)! > 1 ? `${counts.get(lbl)}× ${lbl}` : lbl);
  };
  const modLabel = (mod: { ware: string }) => {
    const entry = modIndex?.[mod.ware];
    return (entry?.name ?? mod.ware) + (entry ? ` Mk${entry.quality}` : "");
  };

  const equipCategories = [
    { label: "Shields",  macros: ship.shields,  modScope: "shield" },
    { label: "Weapons",  macros: ship.weapons,  modScope: "weapon" },
    { label: "Turrets",  macros: ship.turrets,  modScope: "turret" },
    { label: "Engines",  macros: ship.engines,  modScope: "engine" },
    ...(ship.thruster ? [{ label: "Thruster", macros: [ship.thruster], modScope: "thruster" }] : []),
  ].filter(c => c.macros.length > 0 || (modsByScope[c.modScope]?.length ?? 0) > 0);

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={8} className="py-2 px-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
          {equipCategories.map(({ label, macros, modScope }) => (
            <div key={label}>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
              <ul className="space-y-0.5">
                {toLines(macros).map(line => <li key={line}>{line}</li>)}
                {(modsByScope[modScope] ?? []).map((mod, i) => (
                  <li key={`mod-${i}`} className="text-orange-400 dark:text-orange-400">
                    {modLabel(mod)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {shipMods.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ship</div>
              <ul className="space-y-0.5">
                {shipMods.map((mod, i) => (
                  <li key={i} className="text-orange-400 dark:text-orange-400">{modLabel(mod)}</li>
                ))}
              </ul>
            </div>
          )}
          {ship.software.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Software</div>
              <div className="flex flex-wrap gap-1">
                {ship.software.map(s => (
                  <span key={s} className="inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {softwareLabel(s)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ship.current_order != null && (
            <div>
              <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Order</div>
              <span className="text-muted-foreground">{ship.current_order}</span>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function FormationMembersRow({
  formation,
  shipById,
  pilotByShip,
  shipLabels,
  sectorNames,
  savePath,
  equipmentCatalog,
  modIndex,
  onDetail,
  depth = 0,
}: {
  formation: { shape: string; member_ids: string[] };
  shipById: Map<string, ShipInfo>;
  pilotByShip: Map<string, NpcInfo>;
  shipLabels: Record<string, string>;
  sectorNames: Record<string, string>;
  savePath: string;
  equipmentCatalog?: EquipmentCatalog;
  modIndex?: ModIndex;
  onDetail: (code: string, label: string) => void;
  depth?: number;
}) {
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const { shape } = formation;
  const memberShips = formation.member_ids
    .map(id => shipById.get(id))
    .filter((s): s is ShipInfo => s != null && s.wingman_leader != null);

  const indent = 28 + depth * 20; // px, base 28 (~pl-7), +20 per level

  return (
    <>
      <TableRow className="bg-muted/20 hover:bg-muted/20 pointer-events-none">
        <TableCell colSpan={8} className="py-1.5" style={{ paddingLeft: `${indent}px` }}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Formation · <span className="font-mono normal-case">{shape}</span> · {memberShips.length} members
          </span>
        </TableCell>
      </TableRow>
      {memberShips.map(ship => {
        const modelLabel = shipLabels[ship.macro_id] ?? ship.hull;
        const pilot = pilotByShip.get(ship.code);
        const isExpanded = expandedCode === ship.code;
        const isWreck = (ship.state ?? "normal").toLowerCase() === "wreck";
        const geoHint = formatGeoHint(ship.cluster_macro ?? null, ship.zone_macro ?? null);
        const hasSubFormation = ship.formation != null && ship.formation.member_ids.length > 0;
        return (
          <Fragment key={ship.code}>
            <TableRow
              className="cursor-pointer bg-muted/10"
              onClick={() => setExpandedCode(isExpanded ? null : ship.code)}
            >
              <TableCell className="font-medium text-muted-foreground" style={{ paddingLeft: `${indent}px` }}>
                <span className="mr-1.5 opacity-40">↳</span>
                {modelLabel}
                {hasSubFormation && (
                  <span className="ml-1.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">
                    {ship.fleet_name ?? `Fleet · ${ship.formation!.member_ids.length - 1}`}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {ship.name ?? <span className="italic opacity-50">unnamed</span>}
              </TableCell>
              <TableCell className="text-center">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border uppercase font-mono ${shipSizeBadgeClass(ship.size)}`}>
                  {ship.size}
                </span>
              </TableCell>
              <TableCell className="text-center">
                {isWreck ? (
                  <span className="text-xs text-red-800 dark:text-red-400">Wreck</span>
                ) : ship.is_docked ? (
                  <span className="text-xs text-muted-foreground">Docked</span>
                ) : (
                  <span className="text-xs text-green-800 dark:text-green-400">In space</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground" title={[ship.cluster_macro, ship.zone_macro].filter(Boolean).join("\n") || undefined}>
                <div className="flex flex-col gap-0.5">
                  <span>{formatSector(ship.sector_macro, sectorNames)}</span>
                  {geoHint && <span className="text-[10px] text-muted-foreground/75 font-mono">{geoHint}</span>}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {pilot ? (
                  <span>
                    {pilot.name}
                    {pilot.piloting > 0 && <span className="ml-1.5 text-xs text-muted-foreground">★{pilot.piloting}</span>}
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/50">no pilot</span>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground text-center">{ship.code}</TableCell>
              <TableCell className="text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!savePath.trim()}
                  onClick={e => { e.stopPropagation(); onDetail(ship.code, modelLabel); }}
                >
                  Details
                </Button>
              </TableCell>
            </TableRow>
            {isExpanded && <LoadoutRow ship={ship} equipmentCatalog={equipmentCatalog} modIndex={modIndex} />}
            {isExpanded && hasSubFormation && (
              <FormationMembersRow
                formation={ship.formation!}
                shipById={shipById}
                pilotByShip={pilotByShip}
                shipLabels={shipLabels}
                sectorNames={sectorNames}
                savePath={savePath}
                equipmentCatalog={equipmentCatalog}
                modIndex={modIndex}
                onDetail={onDetail}
                depth={depth + 1}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export function FleetTab({
  data,
  fleetSearch,
  setFleetSearch,
  editShipNames,
  updateShipName,
  shipLabels,
  sectorNames,
  savePath,
  onSelectEmployee,
  modIndex,
}: FleetTabProps) {
  const equipmentCatalog = useEquipmentCatalog();
  const equipIndex = useMemo(() => {
    const idx: Record<string, string> = {};
    for (const cat of [equipmentCatalog.weapons, equipmentCatalog.engines, equipmentCatalog.shields, equipmentCatalog.thrusters]) {
      for (const item of cat) idx[item.macro_id.replace(/_macro$/, "")] = item.name;
    }
    return idx;
  }, [equipmentCatalog]);

  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [detailShip, setDetailShip] = useState<{ code: string; label: string } | null>(null);

  const shipModsByCode = useMemo(() => {
    const m: Record<string, ShipMod[]> = {};
    for (const s of data.ships) if (s.mods?.length) m[s.code] = s.mods;
    return m;
  }, [data.ships]);

  const pilotByShip = useMemo(() => {
    const map = new Map<string, NpcInfo>();
    for (const npc of data.npcs) {
      if (npc.post === "aipilot" && npc.ship_code) {
        map.set(npc.ship_code, npc);
      }
    }
    return map;
  }, [data.npcs]);

  const shipById = useMemo(() => {
    const map = new Map<string, ShipInfo>();
    for (const ship of data.ships) {
      if (ship.id) map.set(ship.id, ship);
    }
    return map;
  }, [data.ships]);

  // IDs of ships that are wingmen — hidden from the flat list, shown under their leader
  const memberIds = useMemo(() => {
    const set = new Set<string>();
    for (const ship of data.ships) {
      if (ship.wingman_leader && ship.id) set.add(ship.id);
    }
    return set;
  }, [data.ships]);

  const fleetList = useMemo(() => {
    const q = fleetSearch.toLowerCase();
    return data.ships
      .filter(ship => {
        // always hide wingmen from the flat list (they appear under their leader)
        if (memberIds.has(ship.id)) return false;
        if (!q) return true;
        const lbl = shipLabels[ship.macro_id] ?? ship.hull;
        const pilot = pilotByShip.get(ship.code);
        const geoHint = formatGeoHint(ship.cluster_macro ?? null, ship.zone_macro ?? null);
        return (
          lbl.toLowerCase().includes(q) ||
          (ship.name ?? "").toLowerCase().includes(q) ||
          ship.code.toLowerCase().includes(q) ||
          ship.hull.toLowerCase().includes(q) ||
          (pilot?.name ?? "").toLowerCase().includes(q) ||
          formatSector(ship.sector_macro, sectorNames).toLowerCase().includes(q) ||
          geoHint.toLowerCase().includes(q) ||
          (ship.state ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const sa = FLEET_SIZE_ORDER[a.size] ?? 99;
        const sb = FLEET_SIZE_ORDER[b.size] ?? 99;
        if (sa !== sb) return sa - sb;
        const la = shipLabels[a.macro_id] ?? a.hull;
        const lb = shipLabels[b.macro_id] ?? b.hull;
        return la.localeCompare(lb);
      });
  }, [data.ships, fleetSearch, shipLabels, pilotByShip, sectorNames, memberIds]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ShipDetailDialog
        open={detailShip != null}
        onOpenChange={open => !open && setDetailShip(null)}
        savePath={savePath}
        shipCode={detailShip?.code ?? null}
        shipLabel={detailShip?.label}
        equipIndex={equipIndex}
        equipmentCatalog={equipmentCatalog}
        mods={detailShip ? (shipModsByCode[detailShip.code] ?? []) : []}
        modIndex={modIndex}
      />
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <SearchField
          placeholder="Filter by name, model, pilot or sector…"
          value={fleetSearch}
          onValueChange={setFleetSearch}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Model</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-center">Sz</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Pilot</TableHead>
                <TableHead className="text-muted-foreground font-normal text-center">Code</TableHead>
                <TableHead className="w-28 text-center text-muted-foreground font-normal">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fleetList.map(ship => {
                const modelLabel = shipLabels[ship.macro_id] ?? ship.hull;
                const pilot = pilotByShip.get(ship.code);
                const isExpanded = expandedCode === ship.code;
                const isWreck = (ship.state ?? "normal").toLowerCase() === "wreck";
                const geoHint = formatGeoHint(ship.cluster_macro ?? null, ship.zone_macro ?? null);
                const hasFormation = ship.formation != null && ship.formation.member_ids.length > 0;
                return (
                  <Fragment key={ship.code}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedCode(isExpanded ? null : ship.code)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>{modelLabel}</span>
                          {hasFormation && (
                            <span className="text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 flex-shrink-0">
                              {ship.fleet_name ?? `Fleet · ${ship.formation!.member_ids.length - 1}`}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <input
                          className="w-full bg-transparent text-sm outline-none placeholder:italic placeholder:text-muted-foreground/50"
                          value={editShipNames.has(ship.code) ? editShipNames.get(ship.code)! : (ship.name ?? "")}
                          placeholder="unnamed"
                          onChange={e => updateShipName(ship.code, e.target.value)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border uppercase font-mono ${shipSizeBadgeClass(ship.size)}`}>
                          {ship.size}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {isWreck ? (
                          <span className="text-xs text-red-800 dark:text-red-400">Wreck</span>
                        ) : ship.is_docked ? (
                          <span className="text-xs text-muted-foreground">Docked</span>
                        ) : (
                          <span className="text-xs text-green-800 dark:text-green-400">In space</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={
                          [ship.cluster_macro, ship.zone_macro].filter(Boolean).join("\n") || undefined
                        }
                      >
                        <div className="flex flex-col gap-0.5">
                          <span>{formatSector(ship.sector_macro, sectorNames)}</span>
                          {geoHint ? (
                            <span className="text-[10px] text-muted-foreground/75 font-mono">{geoHint}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-sm cursor-pointer hover:text-foreground"
                        onClick={e => {
                          e.stopPropagation();
                          pilot && onSelectEmployee?.(pilot.name);
                        }}
                      >
                        {pilotCell(pilot)}
                        {ship.crew_count > 0 && (
                          <span className="ml-1.5 text-xs text-muted-foreground/60">
                            +{ship.crew_count}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground text-center">
                        {ship.code}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!savePath.trim()}
                          onClick={e => {
                            e.stopPropagation();
                            setDetailShip({ code: ship.code, label: modelLabel });
                          }}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && <LoadoutRow ship={ship} equipmentCatalog={equipmentCatalog} modIndex={modIndex} />}
                    {isExpanded && hasFormation && (
                      <FormationMembersRow
                        formation={ship.formation!}
                        shipById={shipById}
                        pilotByShip={pilotByShip}
                        shipLabels={shipLabels}
                        sectorNames={sectorNames}
                        savePath={savePath}
                        equipmentCatalog={equipmentCatalog}
                        modIndex={modIndex}
                        onDetail={(code, label) => setDetailShip({ code, label })}
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
