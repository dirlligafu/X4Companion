import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { invoke } from "@tauri-apps/api/core";
import type { GatesCatalog, SectorsCatalog, ShipInfo, StationsCatalog } from "@/types/save";
import { FACTION_LOGOS } from "@/components/map/faction-colors";
import {
  toPlayerMapCatalog,
  type PlayerMapCatalog,
  type PlayerMapCluster,
  type PlayerMapSector,
} from "./player-map-model";

type PlayerMapProps = {
  catalog: SectorsCatalog;
  knownSectors: string[];
  knownClusters: string[];
  sectorOwners: Record<string, string>;
  clusterOwners: Record<string, string>;
  ships: ShipInfo[];
  shipLabels: Record<string, string>;
};

type SectorLabel = { key: string; x: number; y: number; name: string };
type GateDot = { key: string; cx: number; cy: number; active: boolean; label: string };
type GateConnection = { key: string; x1: number; y1: number; x2: number; y2: number; active: boolean };
type StationDot = { key: string; cx: number; cy: number; icon: string; type: string; owner: string };
type SectorTooltipShip = { code: string; name: string; model: string; size: string };
type SectorTooltipData = { sector: PlayerMapSector; ships: SectorTooltipShip[]; x: number; y: number; containerW: number; containerH: number };
type GateTooltipData = { label: string; active: boolean; x: number; y: number; containerW: number; containerH: number };
type ClusterTooltipData = { cluster: PlayerMapCluster; x: number; y: number; containerW: number; containerH: number };
type StationTooltipData = { type: string; owner: string; x: number; y: number; containerW: number; containerH: number };
type HexInfo = { center: SVGPoint; hexRadius: number };

const GATE_ICON_SIZE = 1.5;
const STATION_ICON_SIZE = 3;
const STATION_TYPE_LABELS: Record<string, string> = {
  shipyard: "Shipyards",
  wharf: "Wharfs",
  equipmentdock: "Equipment Docks",
  tradestation: "Trade Stations",
  defence: "Defence",
  piratebase: "Pirate Bases",
};
const ALL_STATION_TYPES = Object.keys(STATION_TYPE_LABELS);

const PLAYER_MAP_FACTION_COLORS: Record<string, string> = {
  argon: "#3b82f6",
  antigone: "#2563eb",
  boron: "#14b8a6",
  paranid: "#a855f7",
  holyorder: "#7e22ce",
  split: "#ef4444",
  teladi: "#22c55e",
  terran: "#06b6d4",
  segaris: "#0ea5e9",
  pioneer: "#38bdf8",
  scaleplate: "#f97316",
  xenon: "#6b7280",
  khaak: "#ec4899",
  buccaneers: "#f59e0b",
  riptide: "#f43f5e",
  ownerless: "#9ca3af",
};

const PLAYER_MAP_FACTION_LABELS: Record<string, string> = {
  argon: "Argon Federation",
  antigone: "Antigone Republic",
  boron: "Kingdom of Boron",
  paranid: "Paranid Empire",
  holyorder: "Holy Order",
  split: "Split",
  teladi: "Teladi Company",
  terran: "Terran Protectorate",
  segaris: "Segaris Pioneers",
  pioneer: "Pioneers",
  scaleplate: "Scale Plate Pact",
  xenon: "Xenon",
  khaak: "Kha'ak",
  buccaneers: "Buccaneers",
  riptide: "Riptide Rakers",
  ownerless: "Ownerless",
};

const RESOURCE_LABELS: Record<string, string> = {
  hydrogen: "Hydrogen", helium: "Helium", methane: "Methane",
  ore: "Ore", silicon: "Silicon", nividium: "Nividium",
  ice: "Ice", rawscrap: "Raw Scrap",
};
const RESOURCE_LEVEL: Record<string, string> = {
  verylow: "Very Low", low: "Low", medium: "Medium",
  medhigh: "Med-High", high: "High", veryhigh: "Very High",
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** SVG filter id — outer-ring glow (no interior haze); injected into map defs on load */
const PLAYER_MAP_OWNER_GLOW_FILTER_ID = "player-map-owner-glow";

/** Dilate alpha − original alpha = outer band only, then blur → glow follows the hex edge, not the fill */
function injectPlayerMapOwnerGlowFilter(svg: string): string {
  if (svg.includes(`id="${PLAYER_MAP_OWNER_GLOW_FILTER_ID}"`)) return svg;
  const filter = `
    <filter id="${PLAYER_MAP_OWNER_GLOW_FILTER_ID}" x="-70%" y="-70%" width="240%" height="240%" filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="1.25" result="dilated"/>
      <feComposite in="dilated" in2="SourceAlpha" operator="out" result="ring"/>
      <feGaussianBlur in="ring" stdDeviation="1" result="blurred"/>
      <feFlood flood-color="#faf734" flood-opacity="0.92" result="flood"/>
      <feComposite in="flood" in2="blurred" operator="in" result="glow"/>
      <feMerge>
        <feMergeNode in="glow"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>`;
  const replaced = svg.replace(
    /<defs\b[\s\S]*?id="defs1"[\s\S]*?\/>/,
    `<defs id="defs1">${filter}</defs>`
  );
  return replaced.includes(PLAYER_MAP_OWNER_GLOW_FILTER_ID) ? replaced : svg;
}

function svgRootCenter(macro: string, svgEl: SVGSVGElement): SVGPoint | null {
  const el = svgEl.querySelector(`#${macro}`) as SVGGraphicsElement | null;
  if (!el) return null;
  const bbox = el.getBBox();
  const pt = svgEl.createSVGPoint();
  pt.x = bbox.x + bbox.width / 2;
  pt.y = bbox.y + bbox.height / 2;
  const elCTM = el.getScreenCTM();
  const svgCTM = svgEl.getScreenCTM();
  if (!elCTM || !svgCTM) return null;
  return pt.matrixTransform(elCTM).matrixTransform(svgCTM.inverse());
}

function normalizeSectorMacro(macro: string): string {
  return macro.toLowerCase().endsWith("_macro") ? macro.toLowerCase() : `${macro.toLowerCase()}_macro`;
}

function computeTooltipPosition(
  x: number,
  y: number,
  containerW: number,
  containerH: number,
  boxW: number,
  boxH: number
): { left: number; top: number } {
  const OFFSET = 12;
  const xRight = x + OFFSET;
  const xLeft = x - OFFSET - boxW;
  let left: number;
  if (xRight + boxW <= containerW) left = xRight;
  else if (xLeft >= 0) left = xLeft;
  else left = Math.max(0, containerW - boxW);

  const yBelow = y + OFFSET;
  const yAbove = y - OFFSET - boxH;
  let top: number;
  if (yBelow + boxH <= containerH) top = yBelow;
  else if (yAbove >= 0) top = yAbove;
  else top = Math.max(0, containerH - boxH);

  return { left, top };
}

export function PlayerMap({ catalog, knownSectors, knownClusters, sectorOwners, clusterOwners, ships, shipLabels }: PlayerMapProps) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const [svgViewBox, setSvgViewBox] = useState("0 0 610 360");
  const [sectorLabels, setSectorLabels] = useState<SectorLabel[]>([]);
  const [showGates, setShowGates] = useState(false);
  const [showGateConnections, setShowGateConnections] = useState(true);
  const [showTooltips, setShowTooltips] = useState(true);
  const [showOwnerGlow, setShowOwnerGlow] = useState(true);
  const [hideUndiscoveredSectors, setHideUndiscoveredSectors] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [enabledStationTypes, setEnabledStationTypes] = useState<Set<string>>(new Set(ALL_STATION_TYPES));
  const [gatesData, setGatesData] = useState<GatesCatalog | null>(null);
  const [stationsData, setStationsData] = useState<StationsCatalog | null>(null);
  const [gateDots, setGateDots] = useState<GateDot[]>([]);
  const [gateConnections, setGateConnections] = useState<GateConnection[]>([]);
  const [stationDots, setStationDots] = useState<StationDot[]>([]);
  const [sectorTooltip, setSectorTooltip] = useState<SectorTooltipData | null>(null);
  const [gateTooltip, setGateTooltip] = useState<GateTooltipData | null>(null);
  const [clusterTooltip, setClusterTooltip] = useState<ClusterTooltipData | null>(null);
  const [stationTooltip, setStationTooltip] = useState<StationTooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hexInfoCacheRef = useRef<Map<string, HexInfo | null>>(new Map());

  const playerCatalog: PlayerMapCatalog = useMemo(
    () => toPlayerMapCatalog(catalog, { sectorOwners, clusterOwners }),
    [catalog, sectorOwners, clusterOwners]
  );

  const knownSectorSet = useMemo(
    () => new Set((knownSectors ?? []).map(v => v.toLowerCase())),
    [knownSectors]
  );
  const knownClusterSet = useMemo(
    () => new Set((knownClusters ?? []).map(v => v.toLowerCase())),
    [knownClusters]
  );

  const clusterById = useMemo(() => {
    const map = new Map<string, PlayerMapCluster>();
    for (const cluster of playerCatalog.clusters) {
      map.set(cluster.macro, cluster);
      for (const sector of cluster.sectors) map.set(sector.macro, cluster);
    }
    return map;
  }, [playerCatalog]);

  const sectorById = useMemo(() => {
    const map = new Map<string, PlayerMapSector>();
    for (const cluster of playerCatalog.clusters) {
      if (cluster.sectors.length === 1) {
        map.set(cluster.macro, cluster.sectors[0]);
      } else {
        for (const sector of cluster.sectors) map.set(sector.macro, sector);
      }
    }
    return map;
  }, [playerCatalog]);

  const sectorByMacro = useMemo(() => {
    const map = new Map<string, PlayerMapSector>();
    for (const cluster of playerCatalog.clusters) {
      for (const sector of cluster.sectors) {
        map.set(sector.macro, sector);
      }
    }
    return map;
  }, [playerCatalog]);

  const isSectorKnown = (cluster: PlayerMapCluster, sector: PlayerMapSector) => {
    const sectorKey = sector.macro.toLowerCase();
    if (knownSectorSet.has(sectorKey)) return true;
    if (knownClusterSet.has(cluster.macro.toLowerCase())) return true;
    return false;
  };

  const shipsBySector = useMemo(() => {
    const map = new Map<string, SectorTooltipShip[]>();
    for (const ship of ships) {
      const macro = ship.sector_macro;
      if (!macro) continue;
      const key = normalizeSectorMacro(macro);
      const list = map.get(key) ?? [];
      list.push({
        code: ship.code,
        name: ship.name?.trim() || ship.code,
        model: shipLabels[ship.macro_id] ?? ship.hull,
        size: ship.size?.toUpperCase() ?? "?",
      });
      map.set(key, list);
    }
    return map;
  }, [ships, shipLabels]);

  const getHexInfo = (svgEl: SVGSVGElement, id: string): HexInfo | null => {
    const cache = hexInfoCacheRef.current;
    if (cache.has(id)) return cache.get(id)!;
    const center = svgRootCenter(id, svgEl);
    const hexEl = svgEl.querySelector(`#${id}`) as SVGGraphicsElement | null;
    if (!center || !hexEl) {
      cache.set(id, null);
      return null;
    }
    const bbox = hexEl.getBBox();
    const info = { center, hexRadius: Math.min(bbox.width, bbox.height) / 2 * 0.9 };
    cache.set(id, info);
    return info;
  };

  useEffect(() => {
    fetch("/x4_map.svg")
      .then(r => r.text())
      .then(text => {
        setSvgText(injectPlayerMapOwnerGlowFilter(text));
        const m = text.match(/viewBox="([^"]+)"/);
        if (m) setSvgViewBox(m[1]);
      })
      .catch(e => console.error("Impossible de charger x4_map.svg :", e));
  }, []);

  useEffect(() => {
    hexInfoCacheRef.current.clear();
  }, [svgText]);

  useEffect(() => {
    if (!svgText) return;
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    const labels: SectorLabel[] = [];
    for (const cluster of playerCatalog.clusters) {
      const entries = cluster.sectors.length === 1
        ? [{ id: cluster.macro, name: cluster.sectors[0].name }]
        : cluster.sectors.map(s => ({ id: s.macro, name: s.name }));

      for (const { id, name } of entries) {
        const center = svgRootCenter(id, svgEl);
        const el = svgEl.querySelector(`#${id}`) as SVGGraphicsElement | null;
        if (!center || !el) continue;
        const bbox = el.getBBox();
        const hexRadius = Math.min(bbox.width, bbox.height) / 2 * 0.9;
        labels.push({ key: id, x: center.x, y: center.y - hexRadius + 2.5, name });
      }
    }
    setSectorLabels(labels);
  }, [svgText, playerCatalog]);

  useEffect(() => {
    if (!showGates || gatesData) return;
    invoke<GatesCatalog>("get_gates_catalog")
      .then(setGatesData)
      .catch(e => console.error("Impossible de charger gates catalog :", e));
  }, [showGates, gatesData]);

  useEffect(() => {
    if (!showStations || stationsData) return;
    invoke<StationsCatalog>("get_stations_catalog")
      .then(setStationsData)
      .catch(e => console.error("Impossible de charger stations catalog :", e));
  }, [showStations, stationsData]);

  useEffect(() => {
    if (!svgText || !gatesData || !showGates) {
      setGateDots([]);
      setGateConnections([]);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    const sectorIndex = new Map<string, string>();
    const sectorNames = new Map<string, string>();
    for (const cluster of playerCatalog.clusters) {
      if (cluster.sectors.length === 1) {
        sectorIndex.set(cluster.sectors[0].macro, cluster.macro);
        sectorNames.set(cluster.sectors[0].macro, cluster.sectors[0].name);
      } else {
        for (const sector of cluster.sectors) {
          sectorIndex.set(sector.macro, sector.macro);
          sectorNames.set(sector.macro, sector.name);
        }
      }
    }

    const dots: GateDot[] = [];
    const dotByPair = new Map<string, GateDot>();
    const connections: GateConnection[] = [];
    for (const gate of gatesData.gates) {
      if (!gate.destination_sector_macro) continue;
      const srcCluster = clusterById.get(gate.sector_macro);
      const srcSector = sectorByMacro.get(gate.sector_macro);
      const dstCluster = clusterById.get(gate.destination_sector_macro);
      const dstSector = sectorByMacro.get(gate.destination_sector_macro);
      if (!srcCluster || !srcSector || !dstCluster || !dstSector) continue;
      if (hideUndiscoveredSectors && !isSectorKnown(srcCluster, srcSector)) continue;

      const svgId = sectorIndex.get(gate.sector_macro);
      if (!svgId) continue;
      const info = getHexInfo(svgEl, svgId);
      if (!info) continue;

      const scale = info.hexRadius / 250_000;
      let cx = info.center.x + gate.pos_x * scale;
      let cy = info.center.y - gate.pos_z * scale;
      const dx = cx - info.center.x;
      const dy = cy - info.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > info.hexRadius) {
        const f = info.hexRadius / dist;
        cx = info.center.x + dx * f;
        cy = info.center.y + dy * f;
      }

      const active = hideUndiscoveredSectors ? isSectorKnown(dstCluster, dstSector) : true;
      const from = sectorNames.get(gate.sector_macro) ?? gate.sector_macro;
      const to = sectorNames.get(gate.destination_sector_macro) ?? gate.destination_sector_macro;
      const dot: GateDot = { key: gate.name, cx, cy, active, label: `${from} → ${to}` };
      dots.push(dot);

      const reverseKey = `${gate.destination_sector_macro}→${gate.sector_macro}`;
      const paired = dotByPair.get(reverseKey);
      if (paired) {
        connections.push({
          key: `${gate.name}↔${paired.key}`,
          x1: cx, y1: cy, x2: paired.cx, y2: paired.cy,
          active: active && paired.active,
        });
      }
      dotByPair.set(`${gate.sector_macro}→${gate.destination_sector_macro}`, dot);
    }

    setGateDots(dots);
    setGateConnections(connections);
  }, [svgText, gatesData, showGates, playerCatalog, clusterById, sectorByMacro, knownSectorSet, knownClusterSet, hideUndiscoveredSectors]);

  useEffect(() => {
    if (!svgText || !stationsData || !showStations) {
      setStationDots([]);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    const sectorIndex = new Map<string, string>();
    for (const cluster of playerCatalog.clusters) {
      if (cluster.sectors.length === 1) {
        sectorIndex.set(cluster.sectors[0].macro.toLowerCase(), cluster.macro);
      } else {
        for (const sector of cluster.sectors) {
          sectorIndex.set(sector.macro.toLowerCase(), sector.macro);
        }
      }
    }

    const dots: StationDot[] = [];
    for (const st of stationsData.stations) {
      if (!enabledStationTypes.has(st.type)) continue;
      const sector = sectorByMacro.get(st.sector_macro);
      const cluster = clusterById.get(st.sector_macro);
      if (!sector || !cluster) continue;
      if (hideUndiscoveredSectors && !isSectorKnown(cluster, sector)) continue;

      const svgId = sectorIndex.get(st.sector_macro.toLowerCase());
      if (!svgId) continue;
      const info = getHexInfo(svgEl, svgId);
      if (!info) continue;

      const scale = info.hexRadius / 250_000;
      let cx = info.center.x + st.pos_x * scale;
      let cy = info.center.y - st.pos_z * scale;
      const dx = cx - info.center.x, dy = cy - info.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > info.hexRadius) {
        const f = info.hexRadius / dist;
        cx = info.center.x + dx * f;
        cy = info.center.y + dy * f;
      }
      dots.push({ key: st.id, cx, cy, icon: st.icon, type: st.type, owner: st.owner });
    }
    setStationDots(dots);
  }, [svgText, stationsData, showStations, enabledStationTypes, playerCatalog, clusterById, sectorByMacro, knownSectorSet, knownClusterSet, hideUndiscoveredSectors]);

  const styleRules = useMemo(() => {
    const rules: string[] = [];
    for (const cluster of playerCatalog.clusters) {
      if (cluster.sectors.length === 1) {
        const known = isSectorKnown(cluster, cluster.sectors[0]);
        if (known) {
          const owner = cluster.sectors[0].faction ?? cluster.faction ?? "ownerless";
          const color = PLAYER_MAP_FACTION_COLORS[owner] ?? PLAYER_MAP_FACTION_COLORS.ownerless;
          const isPlayerOwned = owner === "player";
          const hasShips = (shipsBySector.get(cluster.sectors[0].macro.toLowerCase())?.length ?? 0) > 0;
          rules.push(
            `#${cluster.macro} { fill: ${hexToRgba(color, 0.3)} !important; stroke: ${color} !important; opacity: 1; ${hasShips ? "stroke-width: 0.55 !important;" : ""} ${showOwnerGlow && isPlayerOwned ? `stroke-width: 0.75 !important; filter: url(#${PLAYER_MAP_OWNER_GLOW_FILTER_ID});` : ""} }`
          );
        } else {
          rules.push(
            hideUndiscoveredSectors
              ? `#${cluster.macro} { fill: transparent !important; stroke: transparent !important; opacity: 0; pointer-events: none; }`
              : `#${cluster.macro} { fill: rgba(31,41,55,0.3) !important; stroke: #1f2937 !important; opacity: 0.35; cursor: default; }`
          );
        }
      } else {
        const hasAnyKnownSector = cluster.sectors.some(s => isSectorKnown(cluster, s));
        if (hideUndiscoveredSectors && !hasAnyKnownSector) {
          rules.push(`#${cluster.macro} { fill: transparent !important; stroke: transparent !important; opacity: 0; pointer-events: none; }`);
          for (const sector of cluster.sectors) {
            rules.push(`#${sector.macro} { fill: transparent !important; stroke: transparent !important; opacity: 0; pointer-events: none; }`);
          }
        } else {
          const factions = [...new Set(cluster.sectors.map(s => s.faction ?? cluster.faction ?? "ownerless"))];
          const contested = factions.length > 1;
          const clusterColor = hasAnyKnownSector
            ? (contested ? "#6b7280" : (PLAYER_MAP_FACTION_COLORS[factions[0]] ?? PLAYER_MAP_FACTION_COLORS.ownerless))
            : "#1f2937";
          const clusterOpacity = hasAnyKnownSector ? 1 : 0.35;
          rules.push(`#${cluster.macro} { fill: ${hexToRgba(clusterColor, 0.3)} !important; stroke: ${clusterColor} !important; opacity: ${clusterOpacity}; }`);
          for (const sector of cluster.sectors) {
            if (isSectorKnown(cluster, sector)) {
              const owner = sector.faction ?? cluster.faction ?? "ownerless";
              const color = PLAYER_MAP_FACTION_COLORS[owner] ?? PLAYER_MAP_FACTION_COLORS.ownerless;
              const isPlayerOwned = owner === "player";
              const hasShips = (shipsBySector.get(sector.macro.toLowerCase())?.length ?? 0) > 0;
              rules.push(
                `#${sector.macro} { fill: ${hexToRgba(color, 0.3)} !important; stroke: ${color} !important; opacity: 1; ${hasShips ? "stroke-width: 0.55 !important;" : ""} ${showOwnerGlow && isPlayerOwned ? `stroke-width: 0.75 !important; filter: url(#${PLAYER_MAP_OWNER_GLOW_FILTER_ID});` : ""} }`
              );
            } else {
              rules.push(
                hideUndiscoveredSectors
                  ? `#${sector.macro} { fill: transparent !important; stroke: transparent !important; opacity: 0; pointer-events: none; }`
                  : `#${sector.macro} { fill: rgba(31,41,55,0.3) !important; stroke: #1f2937 !important; opacity: 0.35; cursor: default; }`
              );
            }
          }
        }
      }
    }
    return rules.join("\n");
  }, [playerCatalog, knownSectorSet, knownClusterSet, shipsBySector, showOwnerGlow, hideUndiscoveredSectors]);

  const visibleFactions = useMemo(() => {
    const seen = new Set<string>();
    for (const cluster of playerCatalog.clusters) {
      for (const sector of cluster.sectors) {
        if (isSectorKnown(cluster, sector)) {
          seen.add(sector.faction ?? cluster.faction ?? "ownerless");
        }
      }
    }
    return Array.from(seen).sort();
  }, [playerCatalog, knownSectorSet, knownClusterSet]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svgText || !showTooltips) return;
    const onEnter = (e: MouseEvent) => {
      const path = (e.target as SVGElement).closest("[id^='Cluster_']");
      if (!path) return;
      const cluster = clusterById.get(path.id);
      const sector = sectorById.get(path.id);
      if (!cluster) return;
      const rect = container.getBoundingClientRect();
      const coords = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        containerW: rect.width,
        containerH: rect.height,
      };
      if (sector) {
        if (!isSectorKnown(cluster, sector)) return;
        setClusterTooltip(null);
        const sectorShips = shipsBySector.get(sector.macro.toLowerCase()) ?? [];
        setSectorTooltip({ sector, ships: sectorShips, ...coords });
      } else {
        const hasKnownSector = cluster.sectors.some(s => isSectorKnown(cluster, s));
        if (!hasKnownSector) return;
        setSectorTooltip(null);
        setClusterTooltip({ cluster, ...coords });
      }
    };
    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      setSectorTooltip(prev => prev ? ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }) : null);
      setClusterTooltip(prev => prev ? ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }) : null);
    };
    const onLeave = (e: MouseEvent) => {
      const path = (e.target as SVGElement).closest("[id^='Cluster_']");
      if (path) {
        setSectorTooltip(null);
        setClusterTooltip(null);
      }
    };
    container.addEventListener("mouseover", onEnter);
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseout", onLeave);
    return () => {
      container.removeEventListener("mouseover", onEnter);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseout", onLeave);
    };
  }, [svgText, showTooltips, clusterById, sectorById, knownSectorSet, knownClusterSet, shipsBySector]);

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-border bg-background">
        {!svgText ? (
          <p className="p-4 text-sm text-muted-foreground">Loading map…</p>
        ) : (
          <div ref={containerRef} className="relative h-full w-full">
            <style>{styleRules}</style>
            <TransformWrapper minScale={1} maxScale={20} wheel={{ step: 0.005 }}>
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: "100%", height: "100%", position: "relative" }}
              >
                <div
                  className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: svgText }}
                />
                {sectorLabels.length > 0 && (
                  <svg
                    viewBox={svgViewBox}
                    preserveAspectRatio="xMidYMid meet"
                    className="absolute inset-0 h-full w-full text-foreground"
                    style={{ pointerEvents: "none" }}
                  >
                    {sectorLabels.map(label => {
                      const cluster = clusterById.get(label.key);
                      const sector = sectorById.get(label.key);
                      const known = cluster && sector ? isSectorKnown(cluster, sector) : false;
                      return (
                        <text
                          key={label.key}
                          x={label.x}
                          y={label.y}
                          textAnchor="middle"
                          fontSize={2}
                          fill="currentColor"
                          fillOpacity={known ? 0.8 : hideUndiscoveredSectors ? 0 : 0.2}
                          fontFamily="sans-serif"
                          fontWeight="500"
                        >
                          {label.name}
                        </text>
                      );
                    })}
                  </svg>
                )}
                {showGates && gateDots.length > 0 && (
                  <svg
                    viewBox={svgViewBox}
                    preserveAspectRatio="xMidYMid meet"
                    className="absolute inset-0 h-full w-full text-foreground"
                    style={{ pointerEvents: "none" }}
                  >
                    {showGateConnections && gateConnections.map(conn => (
                      <line
                        key={conn.key}
                        x1={conn.x1} y1={conn.y1}
                        x2={conn.x2} y2={conn.y2}
                        stroke="currentColor"
                        strokeWidth={0.3}
                        strokeOpacity={conn.active ? 0.4 : 0.15}
                        strokeDasharray={conn.active ? undefined : "0.8 0.5"}
                      />
                    ))}
                    {gateDots.map(dot => (
                      <g
                        key={dot.key}
                        transform={`translate(${dot.cx},${dot.cy})`}
                        opacity={dot.active ? 1 : 0.45}
                        style={{ cursor: "default", filter: dot.active ? undefined : "grayscale(1) brightness(0.6)" }}
                        pointerEvents="auto"
                        onMouseEnter={e => {
                          if (!showTooltips) return;
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setGateTooltip({
                            label: dot.label,
                            active: dot.active,
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                            containerW: rect.width,
                            containerH: rect.height,
                          });
                        }}
                        onMouseMove={e => {
                          if (!showTooltips) return;
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setGateTooltip(prev => prev ? ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }) : null);
                        }}
                        onMouseLeave={() => setGateTooltip(null)}
                      >
                        <image
                          href="/map_objects/mapob_jumpgate.svg"
                          x={-GATE_ICON_SIZE / 2}
                          y={-GATE_ICON_SIZE / 2}
                          width={GATE_ICON_SIZE}
                          height={GATE_ICON_SIZE}
                          className="invert dark:invert-0"
                        />
                      </g>
                    ))}
                  </svg>
                )}
                {showStations && stationDots.length > 0 && (
                  <svg
                    viewBox={svgViewBox}
                    preserveAspectRatio="xMidYMid meet"
                    className="absolute inset-0 h-full w-full"
                    style={{ pointerEvents: "none" }}
                  >
                    {stationDots.map(dot => (
                      <g
                        key={dot.key}
                        transform={`translate(${dot.cx},${dot.cy})`}
                        style={{ cursor: "default" }}
                        pointerEvents="auto"
                        onMouseEnter={e => {
                          if (!showTooltips) return;
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setStationTooltip({
                            type: dot.type,
                            owner: dot.owner,
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                            containerW: rect.width,
                            containerH: rect.height,
                          });
                        }}
                        onMouseMove={e => {
                          if (!showTooltips) return;
                          const rect = containerRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setStationTooltip(prev => prev ? ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }) : null);
                        }}
                        onMouseLeave={() => setStationTooltip(null)}
                      >
                        <image
                          href={`/map_objects/${dot.icon}`}
                          x={-STATION_ICON_SIZE / 2}
                          y={-STATION_ICON_SIZE / 2}
                          width={STATION_ICON_SIZE}
                          height={STATION_ICON_SIZE}
                          className="invert dark:invert-0"
                        />
                      </g>
                    ))}
                  </svg>
                )}
              </TransformComponent>
            </TransformWrapper>
            {showTooltips && clusterTooltip && <PlayerClusterTooltip tooltip={clusterTooltip} />}
            {showTooltips && sectorTooltip && <PlayerSectorTooltip tooltip={sectorTooltip} />}
            {showTooltips && gateTooltip && <PlayerGateTooltip tooltip={gateTooltip} />}
            {showTooltips && stationTooltip && <PlayerStationTooltip tooltip={stationTooltip} />}
          </div>
        )}
      </div>

      <div className="flex w-36 shrink-0 flex-col gap-1 overflow-y-auto">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Factions</p>
        {visibleFactions.map(faction => (
          <div key={faction} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: PLAYER_MAP_FACTION_COLORS[faction] ?? "#666" }} />
            <span className="truncate text-xs">{PLAYER_MAP_FACTION_LABELS[faction] ?? faction}</span>
          </div>
        ))}
        <hr className="my-2 border-border" />
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display</p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showGates}
            onChange={e => setShowGates(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          Show gates
        </label>
        <label className={`flex items-center gap-2 text-xs ${showGates ? "cursor-pointer text-muted-foreground" : "cursor-default opacity-40"}`}>
          <input
            type="checkbox"
            checked={showGateConnections}
            onChange={e => setShowGateConnections(e.target.checked)}
            disabled={!showGates}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          Show connections
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showTooltips}
            onChange={e => setShowTooltips(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Show tooltips
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showOwnerGlow}
            onChange={e => setShowOwnerGlow(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Player sectors
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideUndiscoveredSectors}
            onChange={e => setHideUndiscoveredSectors(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Hide undiscovered sectors
        </label>
        <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showStations}
            onChange={e => setShowStations(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-500"
          />
          Show stations
        </label>
        {ALL_STATION_TYPES.map(type => (
          <label key={type} className={`flex items-center gap-2 pl-4 text-xs ${showStations ? "cursor-pointer text-muted-foreground" : "cursor-default opacity-40"}`}>
            <input
              type="checkbox"
              checked={enabledStationTypes.has(type)}
              onChange={e => {
                setEnabledStationTypes(prev => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(type); else next.delete(type);
                  return next;
                });
              }}
              disabled={!showStations}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            {STATION_TYPE_LABELS[type]}
          </label>
        ))}
      </div>
    </div>
  );
}

function PlayerSectorTooltip({ tooltip }: { tooltip: SectorTooltipData }) {
  const { sector, ships, x, y, containerW, containerH } = tooltip;
  const faction = sector.faction ?? "ownerless";
  const color = PLAYER_MAP_FACTION_COLORS[faction] ?? PLAYER_MAP_FACTION_COLORS.ownerless;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(computeTooltipPosition(x, y, containerW, containerH, el.offsetWidth, el.offsetHeight));
    setVisible(true);
  }, [x, y, containerW, containerH]);
  const logoSrc = FACTION_LOGOS[faction];
  const visibleShips = ships.slice(0, 8);
  const hiddenCount = Math.max(0, ships.length - visibleShips.length);
  const resources = Object.entries(sector.resources ?? {});

  return (
    <div
      ref={ref}
      className="absolute z-10 w-80 rounded border border-border bg-popover px-3 py-2 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="flex items-center gap-2">
        {logoSrc ? (
          <img src={logoSrc} alt={faction} className="h-7 w-7 shrink-0 rounded object-contain" />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded" style={{ background: color }} />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight text-foreground">{sector.name}</div>
          <div className="mt-0.5 text-xs font-medium" style={{ color }}>{PLAYER_MAP_FACTION_LABELS[faction] ?? faction}</div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
        {sector.sunlight != null && (
          <div><span className="text-muted-foreground">Sunlight</span><div className="font-medium">{Math.round(sector.sunlight * 100)}%</div></div>
        )}
        {sector.economy != null && (
          <div><span className="text-muted-foreground">Economy</span><div className="font-medium">{Math.round(sector.economy * 100)}%</div></div>
        )}
        {sector.security != null && (
          <div><span className="text-muted-foreground">Security</span><div className="font-medium">{Math.round(sector.security * 100)}%</div></div>
        )}
      </div>
      {resources.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-xs font-semibold text-foreground">Resources</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {resources.map(([res, level]) => (
              <div key={res} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{RESOURCE_LABELS[res] ?? res}</span>
                <span className="font-medium" style={{ color }}>{RESOURCE_LEVEL[level] ?? level}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ships.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
            Player ships ({ships.length})
          </div>
          <ul className="space-y-0.5 pr-1">
            {visibleShips.map(s => (
              <li key={s.code} className="text-xs text-foreground/90">
                [{s.size}] {s.name}{s.model ? ` — ${s.model}` : ""}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <div className="mt-1 text-[11px] text-muted-foreground">… and {hiddenCount} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerClusterTooltip({ tooltip }: { tooltip: ClusterTooltipData }) {
  const { cluster, x, y, containerW, containerH } = tooltip;
  const faction = cluster.faction ?? "ownerless";
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(computeTooltipPosition(x, y, containerW, containerH, el.offsetWidth, el.offsetHeight));
    setVisible(true);
  }, [x, y, containerW, containerH]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-64 rounded border border-border bg-popover px-3 py-2 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="text-xs font-semibold text-foreground">{cluster.name}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{PLAYER_MAP_FACTION_LABELS[faction] ?? faction}</div>
      {cluster.sectors.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Sectors</div>
          <ul className="space-y-0.5">
            {cluster.sectors.map(s => (
              <li key={s.macro} className="text-xs text-foreground/90">
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PlayerGateTooltip({ tooltip }: { tooltip: GateTooltipData }) {
  const { label, active, x, y, containerW, containerH } = tooltip;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);
  const color = active ? "#fbbf24" : "#9ca3af";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(computeTooltipPosition(x, y, containerW, containerH, el.offsetWidth, el.offsetHeight));
    setVisible(true);
  }, [x, y, containerW, containerH]);

  const [from, to] = label.split(" → ");

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 rounded border border-border bg-popover px-3 py-2 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span style={{ color }}>⬡</span>
        <span className="text-foreground">{from}</span>
        <span className="text-muted-foreground">→</span>
        <span style={{ color }}>{to}</span>
      </div>
      {!active && <div className="mt-1 text-xs text-muted-foreground">Destination not discovered</div>}
    </div>
  );
}

function PlayerStationTooltip({ tooltip }: { tooltip: StationTooltipData }) {
  const { type, owner, x, y, containerW, containerH } = tooltip;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(computeTooltipPosition(x, y, containerW, containerH, el.offsetWidth, el.offsetHeight));
    setVisible(true);
  }, [x, y, containerW, containerH]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 rounded border border-border bg-popover px-3 py-2 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="text-xs font-semibold text-foreground">{STATION_TYPE_LABELS[type] ?? type}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{PLAYER_MAP_FACTION_LABELS[owner] ?? owner}</div>
    </div>
  );
}
