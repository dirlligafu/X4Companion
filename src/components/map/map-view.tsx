import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { invoke } from "@tauri-apps/api/core";
import type { ClusterCatalogItem, GatesCatalog, SectorCatalogItem, SectorsCatalog, StationsCatalog } from "@/types/save";
import { FACTION_COLORS, FACTION_LABELS, FACTION_LOGOS } from "./faction-colors";

const DLC_LABELS: Record<string, string> = {
  base:      "Base Game",
  terran:    "Cradle of Humanity",
  split:     "Split Vendetta",
  pirate:    "Tides of Avarice",
  boron:     "Kingdom End",
  timelines: "Timelines",
  mini01:    "Hyperion Pack",
  mini02:    "Envoy Pack",
};

const ALL_DLCS = Object.keys(DLC_LABELS);

type Props = {
  catalog: SectorsCatalog;
  compact?: boolean;
};

type TooltipData = {
  cluster: ClusterCatalogItem;
  x: number;
  y: number;
  containerW: number;
  containerH: number;
};

type GateTooltipData = {
  label: string;
  active: boolean;
  x: number;
  y: number;
  containerW: number;
  containerH: number;
};

type StationTooltipData = {
  type: string;
  owner: string;
  x: number;
  y: number;
  containerW: number;
  containerH: number;
};

type SectorTooltipData = {
  sector: SectorCatalogItem;
  x: number;
  y: number;
  containerW: number;
  containerH: number;
};

const GATE_ICON_SIZE    = 1.5;
const STATION_ICON_SIZE = 3;

const STATION_TYPE_LABELS: Record<string, string> = {
  shipyard:     "Shipyards",
  wharf:        "Wharfs",
  equipmentdock:"Equipment Docks",
  tradestation: "Trade Stations",
  defence:      "Defence",
  piratebase:   "Pirate Bases",
};
const ALL_STATION_TYPES = Object.keys(STATION_TYPE_LABELS);

type GateDot = { key: string; cx: number; cy: number; active: boolean; label: string; sector_macro: string; destination_sector_macro: string };
type GateConnection = { key: string; x1: number; y1: number; x2: number; y2: number; active: boolean };
type SectorLabel = { key: string; x: number; y: number; name: string; dlc: string };
type StationDot = { key: string; cx: number; cy: number; icon: string; type: string; label: string };
// [TEST SECHIGHWAYS — en attente de screenshots in-game pour valider les coordonnées]
// type SechighwayLine = { key: string; x1: number; y1: number; x2: number; y2: number };

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
  // Both in screen-pixel space → CSS transforms cancel → result in SVG viewBox coords
  return pt.matrixTransform(elCTM).matrixTransform(svgCTM.inverse());
}

export function MapView({ catalog, compact = false }: Props) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const [svgViewBox, setSvgViewBox] = useState("0 0 610 360");
  const [enabledDlcs, setEnabledDlcs] = useState<Set<string>>(new Set(["base"]));
  const [showGates, setShowGates] = useState(false);
  const [showGateConnections, setShowGateConnections] = useState(true);
  const [showTooltips, setShowTooltips] = useState(true);
  const [gatesData, setGatesData] = useState<GatesCatalog | null>(null);
  const [showStations, setShowStations] = useState(false);
  const [enabledStationTypes, setEnabledStationTypes] = useState<Set<string>>(new Set(ALL_STATION_TYPES));
  const [stationsData, setStationsData] = useState<StationsCatalog | null>(null);
  const [stationDots, setStationDots] = useState<StationDot[]>([]);
  const [stationTooltip, setStationTooltip] = useState<StationTooltipData | null>(null);
  const [gateDots, setGateDots] = useState<GateDot[]>([]);
  const [gateConnections, setGateConnections] = useState<GateConnection[]>([]);
  // [TEST SECHIGHWAYS]
  // const [sechighwayLines, setSechighwayLines] = useState<SechighwayLine[]>([]);
  const [sectorLabels, setSectorLabels] = useState<SectorLabel[]>([]);
  const [gateTooltip, setGateTooltip] = useState<GateTooltipData | null>(null);
  const [sectorTooltip, setSectorTooltip] = useState<SectorTooltipData | null>(null);
  const [detailedTooltip, setDetailedTooltip] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/x4_map.svg")
      .then(r => r.text())
      .then(text => {
        setSvgText(text);
        const m = text.match(/viewBox="([^"]+)"/);
        if (m) setSvgViewBox(m[1]);
      })
      .catch(e => console.error("Impossible de charger x4_map.svg :", e));
  }, []);

  // Calcul des labels de secteurs (une seule fois quand le SVG est chargé)
  useEffect(() => {
    if (!svgText) return;
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    const labels: SectorLabel[] = [];
    for (const cluster of catalog.clusters) {
      const entries = cluster.sectors.length === 1
        ? [{ id: cluster.macro, name: cluster.sectors[0].name }]
        : cluster.sectors.map(s => ({ id: s.macro, name: s.name }));

      for (const { id, name } of entries) {
        const center = svgRootCenter(id, svgEl);
        const el = svgEl.querySelector(`#${id}`) as SVGGraphicsElement | null;
        if (!center || !el) continue;
        const bbox = el.getBBox();
        const hexRadius = Math.min(bbox.width, bbox.height) / 2 * 0.9;
        labels.push({ key: id, x: center.x, y: center.y - hexRadius + 2.5, name, dlc: cluster.dlc });
      }
    }
    setSectorLabels(labels);
  }, [svgText, catalog]);

  // Chargement lazy de gates.json
  useEffect(() => {
    if (!showGates || gatesData) return;
    invoke<GatesCatalog>("get_gates_catalog")
      .then(setGatesData)
      .catch(e => console.error("Impossible de charger gates catalog :", e));
  }, [showGates, gatesData]);

  // Chargement lazy de stations.json
  useEffect(() => {
    if (!showStations || stationsData) return;
    invoke<StationsCatalog>("get_stations_catalog")
      .then(setStationsData)
      .catch(e => console.error("Impossible de charger stations catalog :", e));
  }, [showStations, stationsData]);

  // Calcul des positions SVG des stations
  useEffect(() => {
    if (!svgText || !stationsData || !showStations) { setStationDots([]); return; }
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    const sectorIndex = new Map<string, string>();
    const sectorDlc   = new Map<string, string>();
    for (const cluster of catalog.clusters) {
      if (cluster.sectors.length === 1) {
        const key = cluster.sectors[0].macro.toLowerCase();
        sectorIndex.set(key, cluster.macro);
        sectorDlc.set(key, cluster.dlc);
      } else {
        for (const sector of cluster.sectors) {
          const key = sector.macro.toLowerCase();
          sectorIndex.set(key, sector.macro);
          sectorDlc.set(key, cluster.dlc);
        }
      }
    }

    const clusterCache = new Map<string, { center: SVGPoint; hexRadius: number } | null>();
    const getClusterInfo = (svgId: string) => {
      if (clusterCache.has(svgId)) return clusterCache.get(svgId)!;
      const center = svgRootCenter(svgId, svgEl);
      const hexEl  = svgEl.querySelector(`#${svgId}`) as SVGGraphicsElement | null;
      if (!center || !hexEl) { clusterCache.set(svgId, null); return null; }
      const bbox      = hexEl.getBBox();
      const hexRadius = Math.min(bbox.width, bbox.height) / 2 * 0.9;
      clusterCache.set(svgId, { center, hexRadius });
      return clusterCache.get(svgId)!;
    };

    const dots: StationDot[] = [];
    for (const st of stationsData.stations) {
      if (!enabledStationTypes.has(st.type)) continue;
      const sectorKey = st.sector_macro.toLowerCase();
      if (!enabledDlcs.has(sectorDlc.get(sectorKey) ?? "")) continue;
      const svgId = sectorIndex.get(sectorKey);
      if (!svgId) continue;
      const info = getClusterInfo(svgId);
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

      dots.push({ key: st.id, cx, cy, icon: st.icon, type: st.type, label: `${st.owner} — ${STATION_TYPE_LABELS[st.type] ?? st.type}` });
    }
    setStationDots(dots);
  }, [svgText, stationsData, showStations, catalog, enabledDlcs, enabledStationTypes]);

  // Calcul des positions SVG des gates (tous secteurs)
  useEffect(() => {
    if (!svgText || !gatesData || !showGates) return;
    const container = containerRef.current;
    if (!container) return;
    const svgEl = container.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) return;

    // Lookups depuis le catalog
    const sectorNames = new Map<string, string>();
    const sectorDlc   = new Map<string, string>();
    for (const cluster of catalog.clusters)
      for (const sector of cluster.sectors) {
        sectorNames.set(sector.macro, sector.name);
        sectorDlc.set(sector.macro, cluster.dlc);
      }

    // Index : sector_macro → svgId
    // Mono-secteur : svgId = cluster.macro (élément SVG existant)
    // Multi-secteur : svgId = sector.macro (élément SVG ajouté manuellement)
    const sectorIndex = new Map<string, string>();
    for (const cluster of catalog.clusters) {
      if (cluster.sectors.length === 1) {
        sectorIndex.set(cluster.sectors[0].macro, cluster.macro);
      } else {
        for (const sector of cluster.sectors) {
          sectorIndex.set(sector.macro, sector.macro);
        }
      }
    }

    // Cache centre + rayon SVG par cluster
    const clusterCache = new Map<string, { center: SVGPoint; hexRadius: number } | null>();
    const getClusterInfo = (macro: string) => {
      if (clusterCache.has(macro)) return clusterCache.get(macro)!;
      const center = svgRootCenter(macro, svgEl);
      const hexEl  = svgEl.querySelector(`#${macro}`) as SVGGraphicsElement | null;
      if (!center || !hexEl) { clusterCache.set(macro, null); return null; }
      const bbox      = hexEl.getBBox();
      const hexRadius = Math.min(bbox.width, bbox.height) / 2 * 0.9;
      clusterCache.set(macro, { center, hexRadius });
      return clusterCache.get(macro)!;
    };

    const dots: GateDot[] = [];
    const dotByPair = new Map<string, GateDot>(); // "src→dest" → dot
    const connections: GateConnection[] = [];

    for (const gate of gatesData.gates) {
      if (!gate.destination_sector_macro) continue;
      if (!enabledDlcs.has(sectorDlc.get(gate.sector_macro) ?? "")) continue;
      const clusterMacro = sectorIndex.get(gate.sector_macro);
      if (!clusterMacro) continue;
      const info = getClusterInfo(clusterMacro);
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
      const from = sectorNames.get(gate.sector_macro) ?? gate.sector_macro;
      const to   = sectorNames.get(gate.destination_sector_macro) ?? gate.destination_sector_macro;
      const destDlc = sectorDlc.get(gate.destination_sector_macro) ?? "";
      const active  = enabledDlcs.has(destDlc);
      const dot: GateDot = { key: gate.name, cx, cy, active, label: `${from} → ${to}`, sector_macro: gate.sector_macro, destination_sector_macro: gate.destination_sector_macro };
      dots.push(dot);

      // Cherche la gate inverse pour former une connexion
      const reverseKey = `${gate.destination_sector_macro}→${gate.sector_macro}`;
      const paired = dotByPair.get(reverseKey);
      if (paired) {
        connections.push({ key: `${gate.name}↔${paired.key}`, x1: cx, y1: cy, x2: paired.cx, y2: paired.cy, active: active && paired.active });
      }
      dotByPair.set(`${gate.sector_macro}→${gate.destination_sector_macro}`, dot);
    }

    setGateDots(dots);
    setGateConnections(connections);

    // [TEST SECHIGHWAYS — décommenté quand on aura des screenshots in-game]
    // const CLUSTER_32_HW = [
    //   {
    //     key: "c32_hw",
    //     sA: "Cluster_32_Sector001_macro", xA: (-140511 + -130501) / 2, zA: 200000,
    //     sB: "Cluster_32_Sector002_macro", xB: ( 40115  +  50000 ) / 2, zB: -200000,
    //   },
    // ];
    // const slines: SechighwayLine[] = [];
    // for (const { key, sA, xA, zA, sB, xB, zB } of CLUSTER_32_HW) {
    //   const infoA = getClusterInfo(sA);
    //   const infoB = getClusterInfo(sB);
    //   if (!infoA || !infoB) continue;
    //   const scaleA = infoA.hexRadius / 250_000;
    //   const scaleB = infoB.hexRadius / 250_000;
    //   slines.push({
    //     key,
    //     x1: infoA.center.x + xA * scaleA,
    //     y1: infoA.center.y - zA * scaleA,
    //     x2: infoB.center.x + xB * scaleB,
    //     y2: infoB.center.y - zB * scaleB,
    //   });
    // }
    // setSechighwayLines(slines);
  }, [svgText, gatesData, showGates, catalog, enabledDlcs]);

  const clusterById = useMemo(() => {
    const map = new Map<string, ClusterCatalogItem>();
    for (const cluster of catalog.clusters) {
      map.set(cluster.macro, cluster);
      for (const sector of cluster.sectors) map.set(sector.macro, cluster);
    }
    return map;
  }, [catalog]);

  // Mapping svgId → secteur pour tous les clusters
  // Mono-secteur : cluster.macro → sector  |  Multi-secteur : sector.macro → sector
  const sectorById = useMemo(() => {
    const map = new Map<string, SectorCatalogItem>();
    for (const cluster of catalog.clusters) {
      if (cluster.sectors.length === 1) {
        map.set(cluster.macro, cluster.sectors[0]);
      } else {
        for (const sector of cluster.sectors) map.set(sector.macro, sector);
      }
    }
    return map;
  }, [catalog]);

  const styleRules = useMemo(() => {
    const rules: string[] = [];
    for (const cluster of catalog.clusters) {
      if (enabledDlcs.has(cluster.dlc)) {
        if (cluster.sectors.length === 1) {
          const color = FACTION_COLORS[cluster.faction ?? "ownerless"] ?? FACTION_COLORS.ownerless;
          rules.push(`#${cluster.macro} { fill: ${hexToRgba(color, 0.3)} !important; stroke: ${color} !important; opacity: 1; cursor: pointer; }`);
        } else {
          const factions = [...new Set(cluster.sectors.map(s => s.faction ?? cluster.faction ?? "ownerless"))];
          const contested = factions.length > 1;
          const clusterColor = contested ? "#6b7280" : (FACTION_COLORS[factions[0]] ?? FACTION_COLORS.ownerless);
          rules.push(`#${cluster.macro} { fill: ${hexToRgba(clusterColor, 0.3)} !important; stroke: ${clusterColor} !important; opacity: 1; }`);
          for (const sector of cluster.sectors) {
            const color = FACTION_COLORS[sector.faction ?? cluster.faction ?? "ownerless"] ?? FACTION_COLORS.ownerless;
            rules.push(`#${sector.macro} { fill: ${hexToRgba(color, 0.3)} !important; stroke: ${color} !important; opacity: 1; cursor: pointer; }`);
          }
        }
      } else {
        const ids = [cluster.macro, ...cluster.sectors.filter(_ => cluster.sectors.length > 1).map(s => s.macro)];
        for (const id of ids)
          rules.push(`#${id} { fill: rgba(31,41,55,0.3) !important; stroke: #1f2937 !important; opacity: 0.35; cursor: default; }`);
      }
    }
    return rules.join("\n");
  }, [catalog, enabledDlcs]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svgText) return;

    const handleMouseEnter = (e: MouseEvent) => {
      const path = (e.target as SVGElement).closest("[id^='Cluster_']");
      if (!path) return;
      const cluster = clusterById.get(path.id);
      if (!cluster || !enabledDlcs.has(cluster.dlc)) return;
      const sector = sectorById.get(path.id);
      const rect = container.getBoundingClientRect();
      const coords = { x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height };
      if (sector) setSectorTooltip({ sector, ...coords });
      else setTooltip({ cluster, ...coords });
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const coords = { x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height };
      setTooltip(prev => prev ? { ...prev, ...coords } : null);
      setSectorTooltip(prev => prev ? { ...prev, ...coords } : null);
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const path = (e.target as SVGElement).closest("[id^='Cluster_']");
      if (path) { setTooltip(null); setSectorTooltip(null); }
    };

    container.addEventListener("mouseover", handleMouseEnter);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseout", handleMouseLeave);
    return () => {
      container.removeEventListener("mouseover", handleMouseEnter);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseout", handleMouseLeave);
    };
  }, [svgText, clusterById, enabledDlcs, sectorById]);

  const toggleDlc = (dlc: string) => {
    setEnabledDlcs(prev => {
      const next = new Set(prev);
      if (next.has(dlc)) next.delete(dlc);
      else next.add(dlc);
      return next;
    });
  };

  const visibleFactions = useMemo(() => {
    const seen = new Set<string>();
    for (const cluster of catalog.clusters) {
      if (enabledDlcs.has(cluster.dlc)) seen.add(cluster.faction ?? "ownerless");
    }
    return Array.from(seen).sort();
  }, [catalog, enabledDlcs]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* Filters */}
      <div className="flex shrink-0 flex-wrap gap-2">
        {ALL_DLCS.map(dlc => {
          const count = catalog.clusters.filter(c => c.dlc === dlc).length;
          if (count === 0) return null;
          const active = enabledDlcs.has(dlc);
          return (
            <button
              key={dlc}
              onClick={() => toggleDlc(dlc)}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground"
              }`}
            >
              {DLC_LABELS[dlc]} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* SVG map */}
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
                      {sectorLabels.map(label => (
                        <text
                          key={label.key}
                          x={label.x}
                          y={label.y}
                          textAnchor="middle"
                          fontSize={2}
                          fill="currentColor"
                          fillOpacity={enabledDlcs.has(label.dlc) ? 0.8 : 0.2}
                          fontFamily="sans-serif"
                          fontWeight="500"
                        >
                          {label.name}
                        </text>
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
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            setStationTooltip({ type: dot.type, owner: dot.label.split(" — ")[0], x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height });
                          }}
                          onMouseMove={e => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            setStationTooltip(prev => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
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
                  {showGates && gateDots.length > 0 && (
                    <svg
                      viewBox={svgViewBox}
                      preserveAspectRatio="xMidYMid meet"
                      className="absolute inset-0 h-full w-full text-foreground"
                      style={{ pointerEvents: "none" }}
                    >
                      {/* [TEST SECHIGHWAYS — décommenté quand on aura des screenshots in-game]
                      {sechighwayLines.map(l => (
                        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                          stroke="#FF8B00" strokeWidth={0.5} strokeOpacity={0.7}
                        />
                      ))}
                      */}
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
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            setGateTooltip({ label: dot.label, active: dot.active, x: e.clientX - rect.left, y: e.clientY - rect.top, containerW: rect.width, containerH: rect.height });
                          }}
                          onMouseMove={e => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            setGateTooltip(prev => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
                          }}
                          onMouseLeave={() => setGateTooltip(null)}
                        >
                          <image
                            href="/map_objects/mapob_jumpgate.svg"
                            x={-GATE_ICON_SIZE / 2} y={-GATE_ICON_SIZE / 2} width={GATE_ICON_SIZE} height={GATE_ICON_SIZE}
                            className="invert dark:invert-0"
                          />
                        </g>
                      ))}
                    </svg>
                  )}
                </TransformComponent>
              </TransformWrapper>
              {showTooltips && tooltip && <ClusterTooltip tooltip={tooltip} detailed={detailedTooltip} />}
              {showTooltips && sectorTooltip && <SectorTooltip tooltip={sectorTooltip} detailed={detailedTooltip} />}
              {showTooltips && gateTooltip && <GateTooltip tooltip={gateTooltip} />}
              {showTooltips && stationTooltip && <StationTooltip tooltip={stationTooltip} />}
            </div>
          )}
        </div>

        {/* Faction legend + display options */}
        <div className={`flex shrink-0 flex-col gap-1 overflow-y-auto ${compact ? "w-36" : "w-44"}`}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Factions</p>
          {visibleFactions.map(faction => (
            <div key={faction} className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: FACTION_COLORS[faction] ?? "#666" }}
              />
              <span className="truncate text-xs">{FACTION_LABELS[faction] ?? faction}</span>
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
          <label className={`flex items-center gap-2 text-xs ${showTooltips ? "cursor-pointer text-muted-foreground" : "cursor-default opacity-40"}`}>
            <input
              type="checkbox"
              checked={detailedTooltip}
              onChange={e => setDetailedTooltip(e.target.checked)}
              disabled={!showTooltips}
              className="h-3.5 w-3.5 accent-primary"
            />
            Detailed tooltips
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground mt-1">
            <input
              type="checkbox"
              checked={showStations}
              onChange={e => setShowStations(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            Show stations
          </label>
          {ALL_STATION_TYPES.map(type => (
            <label key={type} className={`flex items-center gap-2 text-xs pl-4 ${showStations ? "cursor-pointer text-muted-foreground" : "cursor-default opacity-40"}`}>
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
    </div>
  );
}

const RESOURCE_LABELS: Record<string, string> = {
  hydrogen: "Hydrogen", helium: "Helium", methane: "Methane",
  ore: "Ore", silicon: "Silicon", nividium: "Nividium",
  ice: "Ice", rawscrap: "Raw Scrap",
};
const RESOURCE_LEVEL: Record<string, string> = {
  verylow: "Very Low", low: "Low", medium: "Medium",
  medhigh: "Med-High", high: "High", veryhigh: "Very High",
};

function SectorTooltip({ tooltip, detailed }: { tooltip: SectorTooltipData; detailed: boolean }) {
  const { sector, x, y, containerW, containerH } = tooltip;
  const faction = sector.faction ?? "ownerless";
  const color = FACTION_COLORS[faction] ?? FACTION_COLORS.ownerless;
  const logoSrc = FACTION_LOGOS[faction];
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const OFFSET = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const xRight = x + OFFSET;
    const xLeft  = x - OFFSET - w;
    let left: number;
    if (xRight + w <= containerW) left = xRight;
    else if (xLeft >= 0)          left = xLeft;
    else                          left = Math.max(0, containerW - w);
    const yBelow = y + OFFSET;
    const yAbove = y - OFFSET - h;
    let top: number;
    if (yBelow + h <= containerH) top = yBelow;
    else if (yAbove >= 0)         top = yAbove;
    else                          top = Math.max(0, containerH - h);
    setPos({ left, top });
    setVisible(true);
  }, [x, y, containerW, containerH]);

  const resources = Object.entries(sector.resources ?? {});

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-72 rounded border border-border bg-popover p-3 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="flex items-center gap-3">
        {logoSrc
          ? <img src={logoSrc} alt={faction} className="h-10 w-10 shrink-0 rounded object-contain" />
          : <span className="h-10 w-10 shrink-0 rounded" style={{ background: color, opacity: 0.85 }} />
        }
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight">{sector.name}</div>
          <div className="mt-0.5 text-xs font-medium" style={{ color }}>{FACTION_LABELS[faction] ?? faction}</div>
        </div>
      </div>

      {detailed && sector.description && (
        <div className="mt-2.5 space-y-1.5">
          {sector.description.split("\\n\\n").map((para, i) => (
            <p key={i} className="text-xs leading-relaxed text-muted-foreground">{para}</p>
          ))}
        </div>
      )}

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
    </div>
  );
}

function StationTooltip({ tooltip }: { tooltip: StationTooltipData }) {
  const { type, owner, x, y, containerW, containerH } = tooltip;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const OFFSET = 12;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = x + OFFSET + w <= containerW ? x + OFFSET : Math.max(0, x - OFFSET - w);
    const top  = y + OFFSET + h <= containerH ? y + OFFSET : Math.max(0, y - OFFSET - h);
    setPos({ left, top });
    setVisible(true);
  }, [x, y, containerW, containerH]);

  const factionLabel = FACTION_LABELS[owner] ?? owner;
  const typeLabel    = STATION_TYPE_LABELS[type] ?? type;

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 rounded border border-border bg-popover px-3 py-2 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      <div className="text-xs font-semibold text-foreground">{typeLabel}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{factionLabel}</div>
    </div>
  );
}

function GateTooltip({ tooltip }: { tooltip: GateTooltipData }) {
  const { label, active, x, y, containerW, containerH } = tooltip;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);
  const color = active ? "#fbbf24" : "#9ca3af";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const OFFSET = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const xRight = x + OFFSET;
    const xLeft  = x - OFFSET - w;
    let left: number;
    if (xRight + w <= containerW) left = xRight;
    else if (xLeft >= 0)          left = xLeft;
    else                          left = Math.max(0, containerW - w);
    const yBelow = y + OFFSET;
    const yAbove = y - OFFSET - h;
    let top: number;
    if (yBelow + h <= containerH) top = yBelow;
    else if (yAbove >= 0)         top = yAbove;
    else                          top = Math.max(0, containerH - h);
    setPos({ left, top });
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
      {!active && (
        <div className="mt-1 text-xs text-muted-foreground">DLC not active</div>
      )}
    </div>
  );
}

function ClusterTooltip({ tooltip, detailed }: { tooltip: TooltipData; detailed: boolean }) {
  const { cluster, x, y, containerW, containerH } = tooltip;
  const faction = cluster.faction ?? "ownerless";
  const factionLabel = FACTION_LABELS[faction] ?? faction;
  const color = FACTION_COLORS[faction] ?? "#666";
  const logoSrc = FACTION_LOGOS[faction];
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 12, top: y + 12 });
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const OFFSET = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // Horizontal : droite si ça tient, sinon gauche, sinon clamp
    const xRight = x + OFFSET;
    const xLeft  = x - OFFSET - w;
    let left: number;
    if (xRight + w <= containerW) left = xRight;
    else if (xLeft >= 0)          left = xLeft;
    else                          left = Math.max(0, containerW - w);

    // Vertical : bas si ça tient, sinon haut, sinon clamp
    const yBelow = y + OFFSET;
    const yAbove = y - OFFSET - h;
    let top: number;
    if (yBelow + h <= containerH) top = yBelow;
    else if (yAbove >= 0)         top = yAbove;
    else                          top = Math.max(0, containerH - h);

    setPos({ left, top });
    setVisible(true);
  }, [x, y, containerW, containerH]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 w-72 rounded border border-border bg-popover p-3 shadow-lg"
      style={{ ...pos, visibility: visible ? "visible" : "hidden" }}
    >
      {/* Header : icône + nom + faction */}
      <div className="flex items-center gap-3">
        {logoSrc ? (
          <img src={logoSrc} alt={factionLabel} className="h-10 w-10 shrink-0 rounded object-contain" />
        ) : (
          <span className="h-10 w-10 shrink-0 rounded" style={{ background: color, opacity: 0.85 }} />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight">{cluster.name}</div>
          <div className="mt-0.5 text-xs font-medium" style={{ color }}>{factionLabel}</div>
        </div>
      </div>

      {/* Description */}
      {detailed && cluster.description && (
        <div className="mt-2.5 space-y-1.5">
          {cluster.description.split("\\n\\n").map((para, i) => (
            <p key={i} className="text-xs leading-relaxed text-muted-foreground">{para}</p>
          ))}
        </div>
      )}

      {/* Secteurs */}
      {cluster.sectors.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-xs font-semibold text-foreground">Contains sectors:</div>
          <ul className="space-y-0.5">
            {cluster.sectors.map(s => {
              const sColor = FACTION_COLORS[s.faction ?? faction] ?? color;
              return (
                <li key={s.macro} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: sColor }}>
                  <span className="shrink-0">▪</span>
                  {s.name}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
