import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StatEntry } from "@/types/save";

type StatsTabProps = {
  path: string;
};

type StatMap = Map<string, number>;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNumber(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function fmtCredits(v: number): string {
  return `${Math.round(v).toLocaleString("en-US")} Cr`;
}

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function fmtPercent(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtDistance(meters: number): string {
  const km = meters / 1000;
  if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(1)}M km`;
  if (km >= 1_000) return `${Math.round(km / 1_000).toLocaleString("en-US")}k km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

// ── Config des stats à afficher ───────────────────────────────────────────────

type Formatter = (v: number) => string;

interface StatDef {
  id: string;
  label: string;
  fmt: Formatter;
}

interface Category {
  name: string;
  stats: StatDef[];
}

const CATEGORIES: Category[] = [
  {
    name: "Ranks",
    stats: [
      { id: "trade_rank", label: "Trade rank", fmt: fmtNumber },
      { id: "fight_rank", label: "Fight rank", fmt: fmtNumber },
    ],
  },
  {
    name: "Finances",
    stats: [
      { id: "money_player", label: "Current funds", fmt: fmtCredits },
      { id: "trade_value",  label: "Total trade value", fmt: fmtCredits },
      { id: "trade_score",  label: "Trade score", fmt: fmtNumber },
      { id: "trades_executed", label: "Trades executed", fmt: fmtNumber },
    ],
  },
  {
    name: "Empire",
    stats: [
      { id: "ships_owned",    label: "Ships owned", fmt: fmtNumber },
      { id: "stations_owned", label: "Stations owned", fmt: fmtNumber },
    ],
  },
  {
    name: "Combat",
    stats: [
      { id: "ships_destroyed",       label: "Ships destroyed", fmt: fmtNumber },
      { id: "xenon_ships_destroyed", label: "Xenon destroyed", fmt: fmtNumber },
      { id: "bullets_fired",         label: "Shots fired", fmt: fmtNumber },
      { id: "bullets_hit_percent",   label: "Hit rate", fmt: fmtPercent },
    ],
  },
  {
    name: "Exploration",
    stats: [
      { id: "sectors_discovered", label: "Sectors discovered", fmt: fmtNumber },
      { id: "gates_traversed",    label: "Gates traversed", fmt: fmtNumber },
      { id: "distance_walked",    label: "Distance travelled", fmt: fmtDistance },
    ],
  },
  {
    name: "Time",
    stats: [
      { id: "time_total",      label: "Total play time", fmt: fmtTime },
      { id: "time_playership", label: "At the helm", fmt: fmtTime },
      { id: "time_autopilot",  label: "On autopilot", fmt: fmtTime },
    ],
  },
];

// ── Composant ─────────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-1 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums">{value}</span>
    </div>
  );
}

function CategoryBlock({ cat, stats }: { cat: Category; stats: StatMap }) {
  const rows = cat.stats.filter(s => stats.has(s.id));
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {cat.name}
      </h3>
      <div className="rounded-md border border-border px-3 py-1 mb-4">
        {rows.map(s => (
          <StatRow key={s.id} label={s.label} value={s.fmt(stats.get(s.id)!)} />
        ))}
      </div>
    </div>
  );
}

export function StatsTab({ path }: StatsTabProps) {
  const [stats, setStats] = useState<StatMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStats(null);
    setError("");
    setLoading(true);
    invoke<StatEntry[]>("parse_player_stats", { path })
      .then(entries => {
        setStats(new Map(entries.map(e => [e.id, e.value])));
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [path]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden pt-4">
        {loading && (
          <p className="text-sm text-muted-foreground italic">Loading statistics…</p>
        )}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {stats && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 pr-2">
              {CATEGORIES.map(cat => (
                <CategoryBlock key={cat.name} cat={cat} stats={stats} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
