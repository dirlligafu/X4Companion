import type {
  ShipCatalogItem, ShipSlot,
  EngineCatalogItem, ShieldCatalogItem, ThrusterCatalogItem, WeaponCatalogItem,
} from "@/types/save";

// ── Display helpers ───────────────────────────────────────────────────────────

export const SIZE_LABEL: Record<string, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n
    .toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 })
    .replace(/,/g, " ");
}

export function fmtMN(n: number | null | undefined): string {
  if (n == null) return "—";
  const mn = n / 1_000_000;
  return mn >= 1 ? `${fmt(mn, 1)} MN` : `${fmt(n / 1_000, 0)} kN`;
}

export function diffClass(current: number | null, baseline: number | null, higherIsBetter = true): string {
  if (current == null || baseline == null || current === baseline) return "";
  return (current > baseline) === higherIsBetter ? "text-green-400" : "text-red-400";
}

export function fmtDiff(current: number | null, baseline: number | null, decimals = 1): string {
  if (current == null || baseline == null || current === baseline) return "";
  const delta = current - baseline;
  return ` (${delta > 0 ? "+" : ""}${fmt(delta, decimals)})`;
}

// ── Stat types ────────────────────────────────────────────────────────────────

export type SpeedStats = {
  maxSpeed:          number | null;
  travelSpeed:       number | null;
  acceleration:      number | null;
  maxReverseSpeed:   number | null;
  deceleration:      number | null;
  boostSpeed:        number | null;
  boostAcceleration: number | null;
  boostDuration:     number | null;
  boostRecharge:     number | null;
  boostSpinup:       number | null;
};

export type ShieldStats = {
  totalCapacity: number | null;
  totalRegen:    number | null;
  initialDelay:  number | null;
  fullRecharge:  number | null;
};

export type ManoStats = {
  yaw:         number | null;
  pitch:       number | null;
  roll:        number | null;
  strafeSpeed: number | null;
  strafeAccel: number | null;
};

export type DpsStats = {
  weaponDpsHull:   number | null;
  weaponDpsShield: number | null;
  turretDpsHull:   number | null;
  turretDpsShield: number | null;
};

export const NULL_SPEED: SpeedStats   = { maxSpeed: null, travelSpeed: null, acceleration: null, maxReverseSpeed: null, deceleration: null, boostSpeed: null, boostAcceleration: null, boostDuration: null, boostRecharge: null, boostSpinup: null };
export const NULL_SHIELD: ShieldStats = { totalCapacity: null, totalRegen: null, initialDelay: null, fullRecharge: null };
export const NULL_MANO: ManoStats     = { yaw: null, pitch: null, roll: null, strafeSpeed: null, strafeAccel: null };
export const NULL_DPS: DpsStats       = { weaponDpsHull: null, weaponDpsShield: null, turretDpsHull: null, turretDpsShield: null };

// ── Calc functions ────────────────────────────────────────────────────────────

export function calcSpeedStats(ship: ShipCatalogItem, engines: EngineCatalogItem[]): SpeedStats {
  const dragForward = ship.physics?.drag?.forward ?? null;
  const dragReverse = ship.physics?.drag?.reverse ?? null;
  const mass        = ship.physics?.mass ?? null;
  if (!dragForward || !mass || engines.length === 0) return { ...NULL_SPEED };

  const totalThrust       = engines.reduce((s, e) => s + (e.thrust?.forward ?? 0), 0);
  const totalTravelThrust = engines.reduce((s, e) => s + (e.thrust?.forward ?? 0) * (e.travel?.thrust ?? 0), 0);
  const totalReverse      = engines.reduce((s, e) => s + (e.thrust?.reverse ?? 0), 0);

  const r = (n: number) => Math.round(n * 10) / 10;
  const maxSpeed = r(totalThrust / dragForward);

  const boost = engines[0].boost;
  return {
    maxSpeed,
    travelSpeed:       r(totalTravelThrust / dragForward),
    acceleration:      r(totalThrust / mass),
    maxReverseSpeed:   dragReverse && totalReverse > 0 ? r(totalReverse / dragReverse) : null,
    deceleration:      totalReverse > 0 ? r(totalReverse / mass) : null,
    boostSpeed:        boost?.thrust       != null ? r(maxSpeed * boost.thrust) : null,
    boostAcceleration: boost?.acceleration != null ? r(totalThrust * boost.acceleration / mass) : null,
    boostDuration:     boost?.duration ?? null,
    boostRecharge:     boost?.recharge ?? null,
    boostSpinup:       boost?.attack   ?? null,
  };
}

export function calcShieldStats(shields: ShieldCatalogItem[]): ShieldStats {
  if (shields.length === 0) return { ...NULL_SHIELD };
  const r = (n: number) => Math.round(n * 10) / 10;
  const capacity = r(shields.reduce((s, sh) => s + (sh.recharge?.max  ?? 0), 0));
  const regen    = r(shields.reduce((s, sh) => s + (sh.recharge?.rate ?? 0), 0));
  return {
    totalCapacity: capacity,
    totalRegen:    regen,
    initialDelay:  shields[0].recharge?.delay ?? null,
    fullRecharge:  regen > 0 ? r(capacity / regen) : null,
  };
}

export function calcManoStats(ship: ShipCatalogItem, thruster: ThrusterCatalogItem): ManoStats {
  const drag = ship.physics?.drag;
  const mass = ship.physics?.mass ?? null;
  const t    = thruster.thrust;
  if (!drag || !t) return { ...NULL_MANO };
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    yaw:         drag.yaw        && t.yaw    ? r(t.yaw    / drag.yaw)        : null,
    pitch:       drag.pitch      && t.pitch  ? r(t.pitch  / drag.pitch)      : null,
    roll:        drag.roll       && t.roll   ? r(t.roll   / drag.roll)       : null,
    strafeSpeed: drag.horizontal && t.strafe ? r(t.strafe / drag.horizontal) : null,
    strafeAccel: mass            && t.strafe ? r(t.strafe / mass * (ship.physics?.accfactors?.["horizontal"] ?? 1)) : null,
  };
}

export function calcDpsStats(
  ship: ShipCatalogItem,
  loadout: Record<string, string>,
  weapons: WeaponCatalogItem[],
): DpsStats {
  const weaponSlots = ship.slots.filter(s => s.type === "weapon");
  const turretSlots = ship.slots.filter(s => s.type === "turret");

  const fitted = (slots: ShipSlot[]) =>
    slots.map(s => weapons.find(w => w.macro_id === loadout[s.name])).filter((w): w is WeaponCatalogItem => w != null);

  const sumField = (arr: WeaponCatalogItem[], field: "dps_hull" | "dps_shield"): number | null => {
    const vals = arr.map(w => w[field]).filter((v): v is number => v != null);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };

  const fittedWeapons = fitted(weaponSlots);
  const fittedTurrets = fitted(turretSlots);
  return {
    weaponDpsHull:   sumField(fittedWeapons, "dps_hull"),
    weaponDpsShield: sumField(fittedWeapons, "dps_shield"),
    turretDpsHull:   sumField(fittedTurrets, "dps_hull"),
    turretDpsShield: sumField(fittedTurrets, "dps_shield"),
  };
}
