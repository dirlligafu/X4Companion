import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import iconCatalogue from "@/data/icon_catalogue.json";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import {
  SIZE_LABEL, fmt, fmtMN, diffClass, fmtDiff,
  calcSpeedStats, calcShieldStats, calcManoStats, calcDpsStats,
} from "@/lib/ship-stats";
import type { SpeedStats, ShieldStats, ManoStats, DpsStats } from "@/lib/ship-stats";
import type {
  ShipCatalogItem,
  ShipSlot,
  EquipmentCatalog,
  EngineCatalogItem,
  ShieldCatalogItem,
  ThrusterCatalogItem,
  WeaponCatalogItem,
} from "@/types/save";

type Props = {
  ships:     ShipCatalogItem[];
  equipment: EquipmentCatalog;
};

// ── helpers ─────────────────────────────────────────────────────────────────

const FACTION_LABEL: Record<string, string> = {
  arg: "Argon", par: "Paranid", tel: "Teladi", spl: "Split", ter: "Terran",
  atf: "ATF",   ant: "Antigone", bor: "Boron",  xen: "Xenon", pir: "Pirate",
  hol: "HOP",   fre: "Free Families", seg: "Segaris", yak: "Yaki",
};
const SLOT_TYPE_LABEL: Record<string, string> = {
  weapon:         "Weapons",
  turret:         "Turrets",
  shield:         "Hull Shields",
  shield_section: "Section Shields",
  engine:         "Engines",
  thruster:       "Thruster",
  missile:        "Missiles",
  deployable:     "Deployables",
  software:       "Software",
};
const SLOT_TYPE_ORDER = ["weapon", "turret", "shield", "shield_section", "engine", "thruster", "missile", "deployable", "software"];

// ── slot grouping ────────────────────────────────────────────────────────────

type SlotEntry = { slot: ShipSlot; effectiveType: string; label: string };

function groupSlotsIndividual(slots: ShipSlot[]): Map<string, SlotEntry[]> {
  const groups = new Map<string, SlotEntry[]>();
  const counters: Record<string, number> = {};

  for (const s of slots) {
    if (!s.type || s.type === "software" || s.type === "deployable") continue;
    const effectiveType = s.type === "shield" && s.tags.includes("hittable") ? "shield_section" : s.type;
    counters[effectiveType] = (counters[effectiveType] ?? 0) + 1;
    const n = counters[effectiveType];
    const label = `${SLOT_TYPE_LABEL[effectiveType] ?? effectiveType} ${String(n).padStart(2, "0")}`;
    if (!groups.has(effectiveType)) groups.set(effectiveType, []);
    groups.get(effectiveType)!.push({ slot: s, effectiveType, label });
  }

  return new Map(
    [...groups.entries()].sort(([a], [b]) => SLOT_TYPE_ORDER.indexOf(a) - SLOT_TYPE_ORDER.indexOf(b))
  );
}

// ── equipment picker ─────────────────────────────────────────────────────────

type ActiveSlot = { name: string; type: string; size: string };

type EquipRow = { macro_id: string; name: string; size: string | null; mk: number | null; faction: string | null; stat: string };

function buildEquipRows(slot: ActiveSlot, eq: EquipmentCatalog): EquipRow[] {
  const size = slot.size === "?" ? null : slot.size;

  function matchSize(item: { size: string | null }) {
    return size == null || item.size?.toLowerCase() === size.toLowerCase();
  }

  switch (slot.type) {
    case "weapon":
      return eq.weapons.filter(w => !w.is_turret && matchSize(w)).map((w: WeaponCatalogItem) => ({
        macro_id: w.macro_id, name: w.name, size: w.size, mk: w.mk, faction: w.faction,
        stat: w.dps_hull != null ? `DPS hull ${fmt(w.dps_hull)}` : "—",
      }));
    case "turret":
      return eq.weapons.filter(w => w.is_turret && matchSize(w)).map((w: WeaponCatalogItem) => ({
        macro_id: w.macro_id, name: w.name, size: w.size, mk: w.mk, faction: w.faction,
        stat: w.dps_hull != null ? `DPS hull ${fmt(w.dps_hull)}` : "—",
      }));
    case "shield":
    case "shield_section":
      return eq.shields.filter(matchSize).map((s: ShieldCatalogItem) => ({
        macro_id: s.macro_id, name: s.name, size: s.size, mk: s.mk, faction: s.faction,
        stat: s.recharge?.max != null ? `Cap ${fmt(s.recharge.max)} MJ` : "—",
      }));
    case "engine":
      return eq.engines.filter(matchSize).map((e: EngineCatalogItem) => ({
        macro_id: e.macro_id, name: e.name, size: e.size, mk: e.mk, faction: e.faction,
        stat: e.thrust?.forward != null ? `Fwd ${fmtMN(e.thrust.forward)}` : "—",
      }));
    case "thruster":
      return eq.thrusters.filter(matchSize).map((t: ThrusterCatalogItem) => ({
        macro_id: t.macro_id, name: t.name, size: t.size, mk: t.mk, faction: t.faction,
        stat: t.thrust?.strafe != null ? `Strafe ${fmtMN(t.thrust.strafe)}` : "—",
      }));
    default:
      return [];
  }
}

// ── sub-components ───────────────────────────────────────────────────────────

function SizeBadge({ size }: { size: string | null }) {
  if (!size) return null;
  return (
    <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
      {SIZE_LABEL[size.toLowerCase()] ?? size.toUpperCase()}
    </span>
  );
}

function MkBadge({ mk }: { mk: number | null }) {
  if (!mk) return null;
  return (
    <span className="rounded bg-secondary px-1 py-0.5 text-[10px] text-secondary-foreground">
      Mk{mk}
    </span>
  );
}

// ── left column: ship selector ───────────────────────────────────────────────

const SIZE_ORDER = ["s", "m", "l", "xl"];

const filterBtn = (active: boolean) =>
  `px-2 py-0.5 rounded text-xs font-medium transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
  }`;

const selectCls = "w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

function ShipList({ ships, selected, onSelect }: {
  ships: ShipCatalogItem[];
  selected: ShipCatalogItem | null;
  onSelect: (s: ShipCatalogItem) => void;
}) {
  const [search,        setSearch]        = useState("");
  const [sizeFilter,    setSizeFilter]    = useState("all");
  const [factionFilter, setFactionFilter] = useState("all");
  const [typeFilter,    setTypeFilter]    = useState("all");

  const availableSizes = useMemo(() =>
    SIZE_ORDER.filter(sz => ships.some(s => s.size?.toLowerCase() === sz)),
    [ships]
  );

  const factions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of ships) {
      if (s.faction && !seen.has(s.faction))
        seen.set(s.faction, FACTION_LABEL[s.faction] ?? s.faction);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ships]);

  const types = useMemo(() => {
    const seen = new Set<string>();
    for (const s of ships) { if (s.ship_type) seen.add(s.ship_type); }
    return [...seen].sort();
  }, [ships]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return ships
      .filter(s =>
        s.size?.toLowerCase() !== "xs" &&
        (sizeFilter    === "all" || s.size?.toLowerCase()  === sizeFilter) &&
        (factionFilter === "all" || s.faction              === factionFilter) &&
        (typeFilter    === "all" || s.ship_type            === typeFilter) &&
        (!q || s.name.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ships, search, sizeFilter, factionFilter, typeFilter]);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Taille */}
      <div className="flex shrink-0 flex-wrap gap-1">
        <button className={filterBtn(sizeFilter === "all")} onClick={() => setSizeFilter("all")}>All</button>
        {availableSizes.map(sz => (
          <button key={sz} className={filterBtn(sizeFilter === sz)} onClick={() => setSizeFilter(sz)}>
            {SIZE_LABEL[sz] ?? sz.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Faction + Type */}
      <select className={selectCls} value={factionFilter} onChange={e => setFactionFilter(e.target.value)}>
        <option value="all">All factions</option>
        {factions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select className={selectCls} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
        <option value="all">All types</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Recherche + reset */}
      <div className="flex shrink-0 items-center gap-1">
        <SearchField value={search} onValueChange={setSearch} placeholder="Search…" className="flex-1" />
        {(sizeFilter !== "all" || factionFilter !== "all" || typeFilter !== "all" || search) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => { setSizeFilter("all"); setFactionFilter("all"); setTypeFilter("all"); setSearch(""); }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto rounded border text-sm">
        {filtered.length === 0
          ? <p className="p-3 text-xs text-muted-foreground">No ships match.</p>
          : filtered.map(ship => (
            <button
              key={ship.macro_id}
              onClick={() => onSelect(ship)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent",
                selected?.macro_id === ship.macro_id && "bg-accent font-medium",
              )}
            >
              <SizeBadge size={ship.size} />
              <span className="flex-1 truncate">{ship.name}</span>
            </button>
          ))
        }
      </div>

      {/* Image vaisseau sélectionné */}
      <div className="aspect-square w-full shrink-0 overflow-hidden rounded border border-border bg-muted/20">
        {selected
          ? <img
              src={(iconCatalogue as Record<string, string>)[selected.macro_id] ?? "/ship_images/notfound.png"}
              alt={selected.name}
              className="h-full w-full object-contain"
            />
          : <div className="flex h-full items-center justify-center text-xs text-muted-foreground/40">no ship selected</div>
        }
      </div>
    </div>
  );
}

// ── center column: slot groups ───────────────────────────────────────────────

function SlotPanel({ ship, active, onActivate, loadout, defaultLoadout, onReset, equipIndex }: {
  ship: ShipCatalogItem;
  active: ActiveSlot | null;
  onActivate: (s: ActiveSlot | null) => void;
  loadout: Record<string, string>;
  defaultLoadout: Record<string, string>;
  onReset: (slotName: string) => void;
  equipIndex: Record<string, string>;
}) {
  const groups = useMemo(() => groupSlotsIndividual(ship.slots), [ship]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 text-sm">
      {/* Ship header */}
      <div className="rounded border bg-card p-3">
        <p className="font-semibold">{ship.name}</p>
        <p className="text-xs text-muted-foreground">
          {ship.size?.toUpperCase()} · {ship.ship_type ?? "—"} · Hull {fmt(ship.hull)}
        </p>
      </div>

      {/* Slots individuels groupés par type */}
      {[...groups.entries()].map(([type, entries]) => (
        <div key={type}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {SLOT_TYPE_LABEL[type] ?? type}
            <span className="ml-1 font-normal normal-case tracking-normal">({entries.length})</span>
          </p>
          <div className="flex flex-col gap-0.5">
            {entries.map(({ slot, label }) => {
              const isActive   = active?.name === slot.name;
              const isModified = loadout[slot.name] != null && loadout[slot.name] !== defaultLoadout[slot.name];
              return (
                <div key={slot.name} className="flex items-center gap-1">
                  <button
                    onClick={() => onActivate(isActive ? null : { name: slot.name, type, size: slot.size ?? "?" })}
                    className={cn(
                      "flex flex-1 items-center gap-2 rounded border px-3 py-1 text-left text-sm hover:bg-accent",
                      isActive && "border-primary bg-accent",
                    )}
                  >
                    <span className={cn("flex-1 truncate text-xs", isModified && "text-amber-400")}>
                      {loadout[slot.name] ? (equipIndex[loadout[slot.name]] ?? loadout[slot.name]) : label}
                    </span>
                    <SizeBadge size={slot.size} />
                  </button>
                  {isModified && (
                    <button
                      onClick={() => onReset(slot.name)}
                      title="Reset to default"
                      className="shrink-0 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ↺
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Thruster — slot virtuel (non présent dans ships.json, extrait du template XML) */}
      {ship.thruster_tags.length > 0 && (() => {
        const size = ship.thruster_tags.find(t => ["extrasmall","small","medium","large","extralarge"].includes(t));
        const sizeLabel = size ? (SIZE_LABEL[size === "extrasmall" ? "xs" : size === "extralarge" ? "xl" : size[0]] ?? size) : "?";
        const macro      = loadout["con_thruster_01"];
        const isActive   = active?.name === "con_thruster_01";
        const isModified = macro != null && macro !== defaultLoadout["con_thruster_01"];
        return (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Thruster</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onActivate(isActive ? null : { name: "con_thruster_01", type: "thruster", size: sizeLabel })}
                className={cn(
                  "flex flex-1 items-center gap-2 rounded border px-3 py-1 text-left text-sm hover:bg-accent",
                  isActive && "border-primary bg-accent",
                )}
              >
                <span className={cn("flex-1 truncate text-xs", isModified && "text-amber-400")}>
                  {macro ? (equipIndex[macro] ?? macro) : "Thruster 01"}
                </span>
                <SizeBadge size={sizeLabel} />
              </button>
              {isModified && (
                <button
                  onClick={() => onReset("con_thruster_01")}
                  title="Reset to default"
                  className="shrink-0 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ↺
                </button>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ── stats panel ──────────────────────────────────────────────────────────────

function StatsPanel({ ship, speedStats, shieldStats, manoStats, dpsStats, baselineSpeedStats, baselineShieldStats, baselineManoStats, baselineDpsStats }: {
  ship: ShipCatalogItem | null;
  speedStats:          SpeedStats;
  shieldStats:         ShieldStats;
  manoStats:           ManoStats;
  dpsStats:            DpsStats;
  baselineSpeedStats:  SpeedStats;
  baselineShieldStats: ShieldStats;
  baselineManoStats:   ManoStats;
  baselineDpsStats:    DpsStats;
}) {
  if (!ship) return null;
  return (
    <div className="flex flex-col gap-2 overflow-y-auto pr-1 text-sm">
      <div className="rounded border bg-muted/30 p-3 text-xs">
        <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Base stats</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span className="text-muted-foreground">Hull</span>     <span>{fmt(ship.hull)}</span>
          <span className="text-muted-foreground">Cargo</span>    <span>{fmt(ship.cargo?.max)} m³</span>
          <span className="text-muted-foreground">Crew cap</span> <span>{fmt(ship.people_capacity)}</span>
          <span className="text-muted-foreground">Radar</span>    <span>{ship.radar_range != null ? `${fmt(ship.radar_range / 1_000, 0)} km` : "—"}</span>
        </div>
      </div>

      {(speedStats.maxSpeed != null) && (
        <div className="rounded border bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Speed</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-muted-foreground">Max speed</span>
            <span className={diffClass(speedStats.maxSpeed, baselineSpeedStats.maxSpeed)}>{fmt(speedStats.maxSpeed, 1)} m/s{fmtDiff(speedStats.maxSpeed, baselineSpeedStats.maxSpeed)}</span>
            <span className="text-muted-foreground">Travel speed</span>
            <span className={diffClass(speedStats.travelSpeed, baselineSpeedStats.travelSpeed)}>{fmt(speedStats.travelSpeed, 1)} m/s{fmtDiff(speedStats.travelSpeed, baselineSpeedStats.travelSpeed)}</span>
            <span className="text-muted-foreground">Acceleration</span>
            <span className={diffClass(speedStats.acceleration, baselineSpeedStats.acceleration)}>
              {fmt(speedStats.acceleration, 1)} m/s²{fmtDiff(speedStats.acceleration, baselineSpeedStats.acceleration)}{speedStats.maxSpeed != null && speedStats.acceleration != null && speedStats.acceleration > 0
                ? ` (${fmt(Math.round(speedStats.maxSpeed / speedStats.acceleration * 10) / 10, 1)}s)`
                : ""}
            </span>
            {speedStats.maxReverseSpeed != null && <>
              <span className="text-muted-foreground">Reverse speed</span>
              <span className={diffClass(speedStats.maxReverseSpeed, baselineSpeedStats.maxReverseSpeed)}>{fmt(speedStats.maxReverseSpeed, 1)} m/s{fmtDiff(speedStats.maxReverseSpeed, baselineSpeedStats.maxReverseSpeed)}</span>
            </>}
            {speedStats.deceleration != null && <>
              <span className="text-muted-foreground">Deceleration</span>
              <span className={diffClass(speedStats.deceleration, baselineSpeedStats.deceleration)}>
                {fmt(speedStats.deceleration, 1)} m/s²{fmtDiff(speedStats.deceleration, baselineSpeedStats.deceleration)}{speedStats.maxSpeed != null && speedStats.deceleration > 0
                  ? ` (${fmt(Math.round(speedStats.maxSpeed / speedStats.deceleration * 10) / 10, 1)}s)`
                  : ""}
              </span>
            </>}
            {speedStats.boostSpeed != null && <>
              <span className="text-muted-foreground">Boost speed</span>
              <span className={diffClass(speedStats.boostSpeed, baselineSpeedStats.boostSpeed)}>{fmt(speedStats.boostSpeed, 1)} m/s{fmtDiff(speedStats.boostSpeed, baselineSpeedStats.boostSpeed)}</span>
              <span className="text-muted-foreground">Boost acceleration</span>
              <span className={diffClass(speedStats.boostAcceleration, baselineSpeedStats.boostAcceleration)}>{fmt(speedStats.boostAcceleration, 1)} m/s²{fmtDiff(speedStats.boostAcceleration, baselineSpeedStats.boostAcceleration)}</span>
              <span className="text-muted-foreground">Boost duration</span>
              <span className={diffClass(speedStats.boostDuration, baselineSpeedStats.boostDuration)}>{fmt(speedStats.boostDuration, 2)} s{fmtDiff(speedStats.boostDuration, baselineSpeedStats.boostDuration, 2)}</span>
              <span className="text-muted-foreground">Boost recharge</span>
              <span className={diffClass(speedStats.boostRecharge, baselineSpeedStats.boostRecharge, false)}>{fmt(speedStats.boostRecharge, 2)} s{fmtDiff(speedStats.boostRecharge, baselineSpeedStats.boostRecharge, 2)}</span>
              <span className="text-muted-foreground">Boost spin-up</span>
              <span className={diffClass(speedStats.boostSpinup, baselineSpeedStats.boostSpinup, false)}>{fmt(speedStats.boostSpinup, 2)} s{fmtDiff(speedStats.boostSpinup, baselineSpeedStats.boostSpinup, 2)}</span>
            </>}
          </div>
        </div>
      )}

      {(shieldStats.totalCapacity != null) && (
        <div className="rounded border bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Shields</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-muted-foreground">Capacity</span>
            <span className={diffClass(shieldStats.totalCapacity, baselineShieldStats.totalCapacity)}>{fmt(shieldStats.totalCapacity, 1)} MJ{fmtDiff(shieldStats.totalCapacity, baselineShieldStats.totalCapacity)}</span>
            <span className="text-muted-foreground">Regen</span>
            <span className={diffClass(shieldStats.totalRegen, baselineShieldStats.totalRegen)}>{fmt(shieldStats.totalRegen, 1)} MJ/s{fmtDiff(shieldStats.totalRegen, baselineShieldStats.totalRegen)}</span>
            {shieldStats.fullRecharge != null && <>
              <span className="text-muted-foreground">Full recharge</span>
              <span className={diffClass(shieldStats.fullRecharge, baselineShieldStats.fullRecharge, false)}>{fmt(shieldStats.fullRecharge, 1)} s{fmtDiff(shieldStats.fullRecharge, baselineShieldStats.fullRecharge)}</span>
            </>}
            {shieldStats.initialDelay != null && shieldStats.initialDelay > 0 && <>
              <span className="text-muted-foreground">Initial delay</span>
              <span className={diffClass(shieldStats.initialDelay, baselineShieldStats.initialDelay, false)}>{fmt(shieldStats.initialDelay, 1)} s{fmtDiff(shieldStats.initialDelay, baselineShieldStats.initialDelay)}</span>
            </>}
          </div>
        </div>
      )}

      {(manoStats.yaw != null) && (
        <div className="rounded border bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Maneuverability</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {manoStats.pitch       != null && <><span className="text-muted-foreground">Pitch</span>         <span className={diffClass(manoStats.pitch,       baselineManoStats.pitch)}>{fmt(manoStats.pitch, 1)} °/s{fmtDiff(manoStats.pitch, baselineManoStats.pitch)}</span></>}
            {manoStats.yaw         != null && <><span className="text-muted-foreground">Yaw</span>           <span className={diffClass(manoStats.yaw,         baselineManoStats.yaw)}>{fmt(manoStats.yaw, 1)} °/s{fmtDiff(manoStats.yaw, baselineManoStats.yaw)}</span></>}
            {manoStats.roll        != null && <><span className="text-muted-foreground">Roll</span>          <span className={diffClass(manoStats.roll,        baselineManoStats.roll)}>{fmt(manoStats.roll, 1)} °/s{fmtDiff(manoStats.roll, baselineManoStats.roll)}</span></>}
            {manoStats.strafeSpeed != null && <><span className="text-muted-foreground">Strafe speed</span> <span className={diffClass(manoStats.strafeSpeed, baselineManoStats.strafeSpeed)}>{fmt(manoStats.strafeSpeed, 1)} m/s{fmtDiff(manoStats.strafeSpeed, baselineManoStats.strafeSpeed)}</span></>}
            {manoStats.strafeAccel != null && <><span className="text-muted-foreground">Strafe accel</span> <span className={diffClass(manoStats.strafeAccel, baselineManoStats.strafeAccel)}>{fmt(manoStats.strafeAccel, 1)} m/s²{fmtDiff(manoStats.strafeAccel, baselineManoStats.strafeAccel)}</span></>}
          </div>
        </div>
      )}

      {(dpsStats.weaponDpsHull != null || dpsStats.turretDpsHull != null) && (
        <div className="rounded border bg-muted/30 p-3 text-xs">
          <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Firepower</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {dpsStats.weaponDpsHull != null && <>
              <span className="text-muted-foreground">Weapons DPS hull</span>
              <span className={diffClass(dpsStats.weaponDpsHull, baselineDpsStats.weaponDpsHull)}>{fmt(dpsStats.weaponDpsHull, 0)}{fmtDiff(dpsStats.weaponDpsHull, baselineDpsStats.weaponDpsHull, 0)}</span>
            </>}
            {dpsStats.weaponDpsShield != null && <>
              <span className="text-muted-foreground">Weapons DPS shield</span>
              <span className={diffClass(dpsStats.weaponDpsShield, baselineDpsStats.weaponDpsShield)}>{fmt(dpsStats.weaponDpsShield, 0)}{fmtDiff(dpsStats.weaponDpsShield, baselineDpsStats.weaponDpsShield, 0)}</span>
            </>}
            {dpsStats.turretDpsHull != null && <>
              <span className="text-muted-foreground">Turrets DPS hull</span>
              <span className={diffClass(dpsStats.turretDpsHull, baselineDpsStats.turretDpsHull)}>{fmt(dpsStats.turretDpsHull, 0)}{fmtDiff(dpsStats.turretDpsHull, baselineDpsStats.turretDpsHull, 0)}</span>
            </>}
            {dpsStats.turretDpsShield != null && <>
              <span className="text-muted-foreground">Turrets DPS shield</span>
              <span className={diffClass(dpsStats.turretDpsShield, baselineDpsStats.turretDpsShield)}>{fmt(dpsStats.turretDpsShield, 0)}{fmtDiff(dpsStats.turretDpsShield, baselineDpsStats.turretDpsShield, 0)}</span>
            </>}
          </div>
        </div>
      )}

      {(() => {
        const sizeOrder = ["xs", "s", "m", "l", "xl"];
        const hangarEntries = sizeOrder.filter(sz => (ship.hangar_storage[sz] ?? 0) > 0);
        const padEntries    = sizeOrder.filter(sz => (ship.docking_pads[sz]    ?? 0) > 0);
        if (hangarEntries.length === 0 && padEntries.length === 0) return null;
        return (
          <div className="rounded border bg-muted/30 p-3 text-xs">
            <p className="mb-1 font-semibold text-muted-foreground uppercase tracking-wide text-[11px]">Docking</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {hangarEntries.map(sz => (
                <><span key={`hl-${sz}`} className="text-muted-foreground">Hangar ({SIZE_LABEL[sz]})</span>
                <span key={`hv-${sz}`}>{ship.hangar_storage[sz]}</span></>
              ))}
              {padEntries.map(sz => (
                <><span key={`pl-${sz}`} className="text-muted-foreground">Pads ({SIZE_LABEL[sz]})</span>
                <span key={`pv-${sz}`}>{ship.docking_pads[sz]}</span></>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── right column: equipment picker ───────────────────────────────────────────

function EquipPicker({ slot, equipment, selectedMacroId, onSelect }: {
  slot: ActiveSlot;
  equipment: EquipmentCatalog;
  selectedMacroId: string | null;
  onSelect: (macro_id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => buildEquipRows(slot, equipment), [slot, equipment]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {SLOT_TYPE_LABEL[slot.type] ?? slot.type} — {SIZE_LABEL[slot.size] ?? slot.size}
        <span className="ml-1 font-normal normal-case">({rows.length})</span>
      </p>
      <SearchField value={search} onValueChange={setSearch} placeholder="Filter…" className="shrink-0" />
      <div className="flex-1 overflow-y-auto rounded border text-sm">
        {filtered.length === 0
          ? <p className="p-3 text-xs text-muted-foreground">No compatible equipment found.</p>
          : filtered.map(r => (
            <button
              key={r.macro_id}
              onClick={() => onSelect(r.macro_id)}
              className={cn(
                "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-accent",
                selectedMacroId === r.macro_id && "bg-accent",
              )}
            >
              <span className="flex items-center gap-1.5">
                <SizeBadge size={r.size} />
                <MkBadge mk={r.mk} />
                <span className="flex-1 truncate font-medium">{r.name}</span>
              </span>
              <span className="flex gap-2 text-xs text-muted-foreground">
                <span>{r.faction ? (FACTION_LABEL[r.faction] ?? r.faction) : "—"}</span>
                <span className="ml-auto">{r.stat}</span>
              </span>
            </button>
          ))
        }
      </div>
    </div>
  );
}

// ── root component ───────────────────────────────────────────────────────────

export function FittingMockup({ ships, equipment }: Props) {
  const [selectedShip,   setSelectedShip]   = useState<ShipCatalogItem | null>(null);
  const [activeSlot,     setActiveSlot]     = useState<ActiveSlot | null>(null);
  const [loadout,        setLoadout]        = useState<Record<string, string>>({});
  const [defaultLoadout, setDefaultLoadout] = useState<Record<string, string>>({});

  const shieldStats = useMemo((): ShieldStats => {
    if (!selectedShip) return { totalCapacity: null, totalRegen: null, initialDelay: null, fullRecharge: null };
    const fittedShields = selectedShip.slots
      .filter(s => s.type === "shield" && !s.tags.includes("hittable"))
      .map(s => equipment.shields.find(sh => sh.macro_id === loadout[s.name]))
      .filter((sh): sh is ShieldCatalogItem => sh != null);
    return calcShieldStats(fittedShields);
  }, [selectedShip, loadout, equipment]);

  const speedStats = useMemo((): SpeedStats => {
    if (!selectedShip) return { maxSpeed: null, travelSpeed: null, acceleration: null, maxReverseSpeed: null, deceleration: null, boostSpeed: null, boostAcceleration: null, boostDuration: null, boostRecharge: null, boostSpinup: null };
    const fittedEngines = selectedShip.slots
      .filter(s => s.type === "engine")
      .map(s => equipment.engines.find(e => e.macro_id === loadout[s.name]))
      .filter((e): e is EngineCatalogItem => e != null);
    return calcSpeedStats(selectedShip, fittedEngines);
  }, [selectedShip, loadout, equipment]);

  const manoStats = useMemo((): ManoStats => {
    if (!selectedShip) return { yaw: null, pitch: null, roll: null, strafeSpeed: null, strafeAccel: null };
    const thruster = equipment.thrusters.find(t => t.macro_id === loadout["con_thruster_01"]);
    if (!thruster) return { yaw: null, pitch: null, roll: null, strafeSpeed: null, strafeAccel: null };
    return calcManoStats(selectedShip, thruster);
  }, [selectedShip, loadout, equipment]);

  const baselineShieldStats = useMemo((): ShieldStats => {
    if (!selectedShip) return { totalCapacity: null, totalRegen: null, initialDelay: null, fullRecharge: null };
    const fittedShields = selectedShip.slots
      .filter(s => s.type === "shield" && !s.tags.includes("hittable"))
      .map(s => equipment.shields.find(sh => sh.macro_id === defaultLoadout[s.name]))
      .filter((sh): sh is ShieldCatalogItem => sh != null);
    return calcShieldStats(fittedShields);
  }, [selectedShip, defaultLoadout, equipment]);

  const baselineSpeedStats = useMemo((): SpeedStats => {
    if (!selectedShip) return { maxSpeed: null, travelSpeed: null, acceleration: null, maxReverseSpeed: null, deceleration: null, boostSpeed: null, boostAcceleration: null, boostDuration: null, boostRecharge: null, boostSpinup: null };
    const fittedEngines = selectedShip.slots
      .filter(s => s.type === "engine")
      .map(s => equipment.engines.find(e => e.macro_id === defaultLoadout[s.name]))
      .filter((e): e is EngineCatalogItem => e != null);
    return calcSpeedStats(selectedShip, fittedEngines);
  }, [selectedShip, defaultLoadout, equipment]);

  const baselineManoStats = useMemo((): ManoStats => {
    if (!selectedShip) return { yaw: null, pitch: null, roll: null, strafeSpeed: null, strafeAccel: null };
    const thruster = equipment.thrusters.find(t => t.macro_id === defaultLoadout["con_thruster_01"]);
    if (!thruster) return { yaw: null, pitch: null, roll: null, strafeSpeed: null, strafeAccel: null };
    return calcManoStats(selectedShip, thruster);
  }, [selectedShip, defaultLoadout, equipment]);

  const dpsStats = useMemo((): DpsStats => {
    if (!selectedShip) return { weaponDpsHull: null, weaponDpsShield: null, turretDpsHull: null, turretDpsShield: null };
    return calcDpsStats(selectedShip, loadout, equipment.weapons);
  }, [selectedShip, loadout, equipment]);

  const baselineDpsStats = useMemo((): DpsStats => {
    if (!selectedShip) return { weaponDpsHull: null, weaponDpsShield: null, turretDpsHull: null, turretDpsShield: null };
    return calcDpsStats(selectedShip, defaultLoadout, equipment.weapons);
  }, [selectedShip, defaultLoadout, equipment]);

  const equipIndex = useMemo(() => {
    const idx: Record<string, string> = {};
    for (const arr of [equipment.engines, equipment.shields, equipment.thrusters, equipment.weapons]) {
      for (const item of arr) idx[item.macro_id] = item.name;
    }
    return idx;
  }, [equipment]);

  const hasModifications = useMemo(
    () => Object.keys(loadout).some(slot => loadout[slot] !== defaultLoadout[slot]),
    [loadout, defaultLoadout],
  );

  async function handleLoadFitting() {
    const fittingsDir = await invoke<string>("ensure_fittings_dir");
    const path = await openDialog({
      filters: [{ name: "XML", extensions: ["xml"] }],
      defaultPath: fittingsDir,
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    const { ship_macro, loadout: imported } = await invoke<{ ship_macro: string; loadout: Record<string, string> }>(
      "load_fitting_from_path", { path }
    );
    const match = ships.find(s => s.macro_id === ship_macro);
    if (match) setSelectedShip(match);
    setLoadout(imported);
    setDefaultLoadout(imported);
    setActiveSlot(null);
  }

  async function handleSaveFitting() {
    if (!selectedShip) return;
    const fittingsDir = await invoke<string>("ensure_fittings_dir");
    const defaultPath = `${fittingsDir}/${selectedShip.name}.xml`;
    const path = await saveDialog({
      filters: [{ name: "XML", extensions: ["xml"] }],
      defaultPath,
    });
    if (!path) return;
    await invoke("save_fitting", {
      size:           selectedShip.size ?? "s",
      shipMacro:      selectedShip.macro_id,
      loadout,
      defaultLoadout,
      savePath:       path,
    });
  }

  function handleSelectShip(ship: ShipCatalogItem) {
    setSelectedShip(ship);
    setActiveSlot(null);
    setLoadout({});
    invoke<Record<string, string>>("get_template_loadout", {
      size:      ship.size ?? "s",
      macroName: ship.macro_id,
    }).then(l => { setLoadout(l); setDefaultLoadout(l); }).catch(() => { setLoadout({}); setDefaultLoadout({}); });
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      {/* Left — ship selector */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden">
        <ShipList ships={ships} selected={selectedShip} onSelect={handleSelectShip} />
      </div>

      {/* Center — boutons + (slots 60% | stats 40%) */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        {/* Boutons pleine largeur */}
        <div className="flex shrink-0 justify-end gap-2">
          <button
            onClick={handleLoadFitting}
            className="rounded border px-3 py-1 text-xs font-medium transition-colors hover:bg-accent"
          >
            Open fitting…
          </button>
          {selectedShip && (
            <button
              onClick={handleSaveFitting}
              disabled={!hasModifications}
              className="rounded border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent"
            >
              Save fitting…
            </button>
          )}
        </div>

        {/* Slots + Stats côte à côte */}
        <div className="flex min-w-0 flex-1 gap-4 overflow-hidden">
          {/* Slots column */}
          <div className="flex min-w-0 flex-[3] flex-col overflow-hidden">
            {selectedShip
              ? <SlotPanel
                  ship={selectedShip}
                  active={activeSlot}
                  onActivate={setActiveSlot}
                  loadout={loadout}
                  defaultLoadout={defaultLoadout}
                  onReset={(slotName) => setLoadout(prev => ({ ...prev, [slotName]: defaultLoadout[slotName] }))}
                  equipIndex={equipIndex}
                />
              : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a ship to begin fitting
                </div>
              )
            }
          </div>

          {/* Stats column */}
          <div className="flex min-w-0 flex-[2] flex-col overflow-hidden">
            <StatsPanel
              ship={selectedShip}
              speedStats={speedStats}
              shieldStats={shieldStats}
              manoStats={manoStats}
              dpsStats={dpsStats}
              baselineSpeedStats={baselineSpeedStats}
              baselineShieldStats={baselineShieldStats}
              baselineManoStats={baselineManoStats}
              baselineDpsStats={baselineDpsStats}
            />
          </div>
        </div>
      </div>

      {/* Right — equipment picker */}
      <div className="flex w-80 shrink-0 flex-col overflow-hidden">
        {activeSlot
          ? <EquipPicker
              slot={activeSlot}
              equipment={equipment}
              selectedMacroId={loadout[activeSlot.name] ?? null}
              onSelect={(id) => setLoadout(prev => ({ ...prev, [activeSlot.name]: id }))}
            />
          : (
            <div className="flex h-full items-center justify-center rounded border text-sm text-muted-foreground">
              Click a slot group to browse equipment
            </div>
          )
        }
      </div>
    </div>
  );
}
