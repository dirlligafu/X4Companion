import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import {
  SIZE_LABEL, fmt, diffClass, fmtDiff,
  calcSpeedStats, calcShieldStats, calcManoStats, calcDpsStats,
  NULL_MANO,
} from "@/lib/ship-stats";
import type { SpeedStats, ShieldStats, ManoStats, DpsStats } from "@/lib/ship-stats";
import type {
  ShipCatalogItem,
  EngineCatalogItem, ShieldCatalogItem, ThrusterCatalogItem,
} from "@/types/save";
import { useShipsCatalog }     from "@/hooks/useShipsCatalog";
import { useEquipmentCatalog } from "@/hooks/useEquipmentCatalog";

type CompareColumn = {
  ship:    ShipCatalogItem | null;
  loadout: Record<string, string>;
};

type ColStats = {
  speed:  SpeedStats;
  shield: ShieldStats;
  mano:   ManoStats;
  dps:    DpsStats;
};

const FACTION_LABEL: Record<string, string> = {
  arg: "Argon", par: "Paranid", tel: "Teladi", spl: "Split", ter: "Terran",
  atf: "ATF",   ant: "Antigone", bor: "Boron",  xen: "Xenon", pir: "Pirate",
  hol: "HOP",   fre: "Free Families", seg: "Segaris", yak: "Yaki",
};

function emptyCol(): CompareColumn {
  return { ship: null, loadout: {} };
}

// ── Ship picker popover ───────────────────────────────────────────────────────

function ShipPicker({ ships, onSelect, onClose }: {
  ships:    ShipCatalogItem[];
  onSelect: (ship: ShipCatalogItem) => void;
  onClose:  () => void;
}) {
  const [search,     setSearch]     = useState("");
  const [sizeFilter, setSizeFilter] = useState("all");

  const availableSizes = useMemo(() => {
    const order = ["xs", "s", "m", "l", "xl"];
    return order.filter(sz => ships.some(s => s.size?.toLowerCase() === sz && s.player_usable));
  }, [ships]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return ships
      .filter(s =>
        s.player_usable &&
        (sizeFilter === "all" || s.size?.toLowerCase() === sizeFilter) &&
        (!q || s.name.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ships, search, sizeFilter]);

  const btnCls = (active: boolean) =>
    `px-2 py-0.5 rounded text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
    }`;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded border bg-background shadow-lg">
        <div className="flex flex-col gap-1.5 border-b p-2">
          <SearchField value={search} onValueChange={setSearch} placeholder="Search…" />
          <div className="flex flex-wrap gap-1">
            <button className={btnCls(sizeFilter === "all")} onClick={() => setSizeFilter("all")}>All</button>
            {availableSizes.map(sz => (
              <button key={sz} className={btnCls(sizeFilter === sz)} onClick={() => setSizeFilter(sz)}>
                {SIZE_LABEL[sz] ?? sz.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0
            ? <p className="p-3 text-xs text-muted-foreground">No ships match.</p>
            : filtered.map(ship => (
              <button
                key={ship.macro_id}
                onClick={() => { onSelect(ship); onClose(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                  {SIZE_LABEL[ship.size?.toLowerCase() ?? ""] ?? ship.size?.toUpperCase() ?? "?"}
                </span>
                <span className="flex-1 truncate">{ship.name}</span>
              </button>
            ))
          }
        </div>
      </div>
    </>
  );
}

// ── Column header cell ────────────────────────────────────────────────────────

function ColumnHeader({ col, isRef, onSetRef, onPick, onRemove, onLoadFitting, ships }: {
  col:           CompareColumn;
  isRef:         boolean;
  onSetRef:      () => void;
  onPick:        (ship: ShipCatalogItem) => void;
  onRemove:      () => void;
  onLoadFitting: () => void;
  ships:         ShipCatalogItem[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <th className="relative min-w-[180px] border-l border-border px-3 py-2 text-left align-top font-normal">
      <div className="mb-1 flex items-start gap-2">
        <input
          type="radio"
          checked={isRef}
          onChange={onSetRef}
          title="Set as reference"
          className="mt-0.5 cursor-pointer accent-primary"
        />
        <span className="flex-1 font-semibold text-sm leading-tight">
          {col.ship
            ? col.ship.name
            : <span className="italic text-muted-foreground">Empty</span>
          }
        </span>
        <button
          onClick={onRemove}
          title="Remove column"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >×</button>
      </div>

      {col.ship && (
        <p className="mb-1.5 text-[11px] text-muted-foreground">
          {col.ship.size?.toUpperCase()} · {col.ship.ship_type ?? "—"} · {FACTION_LABEL[col.ship.faction ?? ""] ?? col.ship.faction ?? "—"}
        </p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        <div className="relative">
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="text-primary/80 hover:text-primary transition-colors"
          >
            {col.ship ? "Change…" : "Pick a ship…"}
          </button>
          {pickerOpen && (
            <ShipPicker ships={ships} onSelect={onPick} onClose={() => setPickerOpen(false)} />
          )}
        </div>
        {col.ship && (
          <button
            onClick={onLoadFitting}
            className="text-primary/80 hover:text-primary transition-colors"
          >
            Load fitting…
          </button>
        )}
      </div>
    </th>
  );
}

// ── Stat row helpers ──────────────────────────────────────────────────────────

function CategoryRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pb-0.5 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

type GetFn = (cs: ColStats) => number | null;

function StatRow({ label, get, unit = "", decimals = 0, higherIsBetter = true, colStats, refIdx }: {
  label:          string;
  get:            GetFn;
  unit?:          string;
  decimals?:      number;
  higherIsBetter?: boolean;
  colStats:       (ColStats | null)[];
  refIdx:         number;
}) {
  const refVal  = colStats[refIdx] ? get(colStats[refIdx]!) : null;
  const anyData = colStats.some(cs => cs != null && get(cs) != null);
  if (!anyData) return null;

  return (
    <tr className="border-t border-border/30">
      <td className="py-0.5 pr-4 text-muted-foreground">{label}</td>
      {colStats.map((cs, i) => {
        const val   = cs ? get(cs) : null;
        const isRef = i === refIdx;
        return (
          <td key={i} className={cn(
            "border-l border-border/30 px-3 py-0.5 tabular-nums",
            !isRef && diffClass(val, refVal, higherIsBetter),
          )}>
            {val != null ? `${fmt(val, decimals)}${unit}` : "—"}
            {!isRef && fmtDiff(val, refVal, decimals)}
          </td>
        );
      })}
    </tr>
  );
}

function BaseRow({ label, vals, unit = "", decimals = 0, higherIsBetter = true, refIdx }: {
  label:           string;
  vals:            (number | null)[];
  unit?:           string;
  decimals?:       number;
  higherIsBetter?: boolean;
  refIdx:          number;
}) {
  const refVal  = vals[refIdx];
  const anyData = vals.some(v => v != null);
  if (!anyData) return null;

  return (
    <tr className="border-t border-border/30">
      <td className="py-0.5 pr-4 text-muted-foreground">{label}</td>
      {vals.map((v, i) => {
        const isRef = i === refIdx;
        return (
          <td key={i} className={cn(
            "border-l border-border/30 px-3 py-0.5 tabular-nums",
            !isRef && diffClass(v, refVal, higherIsBetter),
          )}>
            {v != null ? `${fmt(v, decimals)}${unit}` : "—"}
            {!isRef && fmtDiff(v, refVal, decimals)}
          </td>
        );
      })}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShipComparator() {
  const ships     = useShipsCatalog();
  const equipment = useEquipmentCatalog();
  const [columns, setColumns] = useState<CompareColumn[]>([emptyCol(), emptyCol()]);
  const [refIdx,  setRefIdx]  = useState(0);

  const colStats = useMemo((): (ColStats | null)[] =>
    columns.map(col => {
      if (!col.ship) return null;
      const engines = col.ship.slots
        .filter(s => s.type === "engine")
        .map(s => equipment.engines.find(e => e.macro_id === col.loadout[s.name]))
        .filter((e): e is EngineCatalogItem => e != null);
      const shields = col.ship.slots
        .filter(s => s.type === "shield" && !s.tags.includes("hittable"))
        .map(s => equipment.shields.find(sh => sh.macro_id === col.loadout[s.name]))
        .filter((sh): sh is ShieldCatalogItem => sh != null);
      const thruster = equipment.thrusters.find(t => t.macro_id === col.loadout["con_thruster_01"]) as ThrusterCatalogItem | undefined;
      return {
        speed:  calcSpeedStats(col.ship, engines),
        shield: calcShieldStats(shields),
        mano:   thruster ? calcManoStats(col.ship, thruster) : { ...NULL_MANO },
        dps:    calcDpsStats(col.ship, col.loadout, equipment.weapons),
      };
    }),
    [columns, equipment],
  );

  async function selectShip(idx: number, ship: ShipCatalogItem) {
    const loadout = await invoke<Record<string, string>>("get_template_loadout", {
      size:      ship.size ?? "s",
      macroName: ship.macro_id,
    }).catch(() => ({}));
    setColumns(prev => prev.map((col, i) => i === idx ? { ship, loadout } : col));
  }

  async function loadFitting(idx: number) {
    const fittingsDir = await invoke<string>("ensure_fittings_dir");
    const path = await openDialog({
      filters: [{ name: "XML", extensions: ["xml"] }],
      defaultPath: fittingsDir,
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    const { ship_macro, loadout } = await invoke<{ ship_macro: string; loadout: Record<string, string> }>(
      "load_fitting_from_path", { path }
    );
    const ship = ships.find(s => s.macro_id === ship_macro) ?? null;
    setColumns(prev => prev.map((col, i) => i === idx ? { ship, loadout } : col));
  }

  function removeColumn(idx: number) {
    if (columns.length <= 2) {
      // Keep 2 columns minimum — just clear the slot
      setColumns(prev => prev.map((col, i) => i === idx ? emptyCol() : col));
    } else {
      setColumns(prev => prev.filter((_, i) => i !== idx));
      setRefIdx(r => (r > idx ? r - 1 : r >= columns.length - 1 ? 0 : r));
    }
  }

  // Derived: which docking sizes appear across all ships
  const sizeOrder   = ["xs", "s", "m", "l", "xl"];
  const hangarSizes = sizeOrder.filter(sz => columns.some(col => (col.ship?.hangar_storage[sz] ?? 0) > 0));
  const padSizes    = sizeOrder.filter(sz => columns.some(col => (col.ship?.docking_pads[sz]    ?? 0) > 0));

  const hasSpeed  = colStats.some(cs => cs?.speed.maxSpeed  != null);
  const hasShield = colStats.some(cs => cs?.shield.totalCapacity != null);
  const hasMano   = colStats.some(cs => cs?.mano.yaw        != null);
  const hasDps    = colStats.some(cs => cs?.dps.weaponDpsHull != null || cs?.dps.turretDpsHull != null);
  const hasDock   = hangarSizes.length > 0 || padSizes.length > 0;

  if (ships.length === 0) return <p className="text-sm text-muted-foreground">Loading catalog…</p>;

  const rowProps = { colStats, refIdx };
  const colSpan  = columns.length + 1;  // label + N data columns

  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">

        {/* ── Sticky header ── */}
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border">
            <th className="w-40 py-2" />
            {columns.map((col, idx) => (
              <ColumnHeader
                key={idx}
                col={col}
                isRef={refIdx === idx}
                onSetRef={() => setRefIdx(idx)}
                onPick={ship => selectShip(idx, ship)}
                onRemove={() => removeColumn(idx)}
                onLoadFitting={() => loadFitting(idx)}
                ships={ships}
              />
            ))}
            {columns.length < 4 && (
              <th className="border-l border-border px-3 py-2 align-top">
                <button
                  onClick={() => setColumns(prev => [...prev, emptyCol()])}
                  className="rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  + Add ship
                </button>
              </th>
            )}
          </tr>
        </thead>

        {/* ── Stat rows ── */}
        <tbody>

          {/* Base stats — always shown once at least one ship is selected */}
          {columns.some(c => c.ship) && <>
            <CategoryRow label="Base stats" colSpan={colSpan} />
            <BaseRow label="Hull"     vals={columns.map(c => c.ship?.hull             ?? null)} unit=""     refIdx={refIdx} />
            <BaseRow label="Cargo"    vals={columns.map(c => c.ship?.cargo?.max       ?? null)} unit=" m³"  refIdx={refIdx} />
            <BaseRow label="Crew cap" vals={columns.map(c => c.ship?.people_capacity  ?? null)} unit=""     refIdx={refIdx} />
            <BaseRow label="Radar"    vals={columns.map(c => c.ship?.radar_range != null ? c.ship.radar_range / 1000 : null)} unit=" km" refIdx={refIdx} />
          </>}

          {hasSpeed && <>
            <CategoryRow label="Speed" colSpan={colSpan} />
            <StatRow label="Max speed"      get={cs => cs.speed.maxSpeed}          unit=" m/s"  decimals={1} {...rowProps} />
            <StatRow label="Travel speed"   get={cs => cs.speed.travelSpeed}       unit=" m/s"  decimals={1} {...rowProps} />
            <StatRow label="Acceleration"   get={cs => cs.speed.acceleration}      unit=" m/s²" decimals={1} {...rowProps} />
            <StatRow label="Reverse speed"  get={cs => cs.speed.maxReverseSpeed}   unit=" m/s"  decimals={1} {...rowProps} />
            <StatRow label="Deceleration"   get={cs => cs.speed.deceleration}      unit=" m/s²" decimals={1} {...rowProps} />
            <StatRow label="Boost speed"    get={cs => cs.speed.boostSpeed}        unit=" m/s"  decimals={1} {...rowProps} />
            <StatRow label="Boost accel"    get={cs => cs.speed.boostAcceleration} unit=" m/s²" decimals={1} {...rowProps} />
            <StatRow label="Boost duration" get={cs => cs.speed.boostDuration}     unit=" s"    decimals={2} {...rowProps} />
            <StatRow label="Boost recharge" get={cs => cs.speed.boostRecharge}     unit=" s"    decimals={2} higherIsBetter={false} {...rowProps} />
          </>}

          {hasShield && <>
            <CategoryRow label="Shields" colSpan={colSpan} />
            <StatRow label="Capacity"      get={cs => cs.shield.totalCapacity} unit=" MJ"   decimals={1} {...rowProps} />
            <StatRow label="Regen"         get={cs => cs.shield.totalRegen}    unit=" MJ/s" decimals={1} {...rowProps} />
            <StatRow label="Full recharge" get={cs => cs.shield.fullRecharge}  unit=" s"    decimals={1} higherIsBetter={false} {...rowProps} />
            <StatRow label="Initial delay" get={cs => cs.shield.initialDelay}  unit=" s"    decimals={1} higherIsBetter={false} {...rowProps} />
          </>}

          {hasMano && <>
            <CategoryRow label="Maneuverability" colSpan={colSpan} />
            <StatRow label="Pitch"        get={cs => cs.mano.pitch}       unit=" °/s"  decimals={1} {...rowProps} />
            <StatRow label="Yaw"          get={cs => cs.mano.yaw}         unit=" °/s"  decimals={1} {...rowProps} />
            <StatRow label="Roll"         get={cs => cs.mano.roll}        unit=" °/s"  decimals={1} {...rowProps} />
            <StatRow label="Strafe speed" get={cs => cs.mano.strafeSpeed} unit=" m/s"  decimals={1} {...rowProps} />
            <StatRow label="Strafe accel" get={cs => cs.mano.strafeAccel} unit=" m/s²" decimals={1} {...rowProps} />
          </>}

          {hasDps && <>
            <CategoryRow label="Firepower" colSpan={colSpan} />
            <StatRow label="Weapons DPS hull"   get={cs => cs.dps.weaponDpsHull}   {...rowProps} />
            <StatRow label="Weapons DPS shield" get={cs => cs.dps.weaponDpsShield} {...rowProps} />
            <StatRow label="Turrets DPS hull"   get={cs => cs.dps.turretDpsHull}   {...rowProps} />
            <StatRow label="Turrets DPS shield" get={cs => cs.dps.turretDpsShield} {...rowProps} />
          </>}

          {hasDock && <>
            <CategoryRow label="Docking" colSpan={colSpan} />
            {hangarSizes.map(sz => (
              <BaseRow
                key={`h-${sz}`}
                label={`Hangar (${SIZE_LABEL[sz]})`}
                vals={columns.map(col => col.ship?.hangar_storage[sz] ?? null)}
                refIdx={refIdx}
              />
            ))}
            {padSizes.map(sz => (
              <BaseRow
                key={`p-${sz}`}
                label={`Pads (${SIZE_LABEL[sz]})`}
                vals={columns.map(col => col.ship?.docking_pads[sz] ?? null)}
                refIdx={refIdx}
              />
            ))}
          </>}

        </tbody>
      </table>
    </div>
  );
}
