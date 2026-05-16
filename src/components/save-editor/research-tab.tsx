import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchField } from "@/components/ui/search-field";
import type { ResearchEntry } from "@/types/save";
import { ResearchTreeView } from "./research-tree";

type ViewMode = "table" | "tree";
type Filter = "all" | "completed" | "available" | "locked";

function cleanName(name: string | null): string {
  if (!name) return "—";
  return name
    .replace(/\(same as \{[^}]+\}\)/g, "")
    .replace(/^\([^)]+\)/, "")
    .trim();
}

type ResearchTabProps = {
  researchCatalog: ResearchEntry[];
  completedResearch: Set<string>;
  pendingResearch: Set<string>;
  toggleResearch: (id: string) => void;
  addResearchMaterials: (materials: { ware: string; amount: number }[]) => void;
  wareLabels: Record<string, string>;
};

function formatTime(seconds: number): string {
  if (seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
}

function topoSort(entries: ResearchEntry[]): ResearchEntry[] {
  const ids = new Set(entries.map(e => e.id));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const byId = new Map(entries.map(e => [e.id, e]));

  for (const e of entries) {
    adj.set(e.id, []);
    inDegree.set(e.id, 0);
  }
  for (const e of entries) {
    for (const p of e.prerequisites) {
      if (ids.has(p)) {
        adj.get(p)!.push(e.id);
        inDegree.set(e.id, inDegree.get(e.id)! + 1);
      }
    }
  }

  const queue = entries
    .filter(e => inDegree.get(e.id) === 0)
    .sort((a, b) => (a.sortorder ?? 999) - (b.sortorder ?? 999));
  const result: ResearchEntry[] = [];

  while (queue.length > 0) {
    const e = queue.shift()!;
    result.push(e);
    const deps = (adj.get(e.id) ?? [])
      .map(id => byId.get(id)!)
      .sort((a, b) => (a.sortorder ?? 999) - (b.sortorder ?? 999));
    for (const dep of deps) {
      const d = inDegree.get(dep.id)! - 1;
      inDegree.set(dep.id, d);
      if (d === 0) queue.push(dep);
    }
  }

  return result;
}

function categoryLabel(e: ResearchEntry): string {
  const s = e.sortorder ?? 0;
  if (s >= 100 && s < 200) return "Teleportation";
  if (s >= 200 && s < 300) return "Station Modules";
  if (s >= 300 && s < 400) return "Equipment Mods";
  if (s >= 400 && s < 500) return "Agents & Diplomacy";
  if (s >= 500 && s < 600) return "Ships";
  if (s >= 600 && s < 700) return "Xenon";
  return "System";
}

export function ResearchTab({
  researchCatalog,
  completedResearch,
  pendingResearch,
  toggleResearch,
  addResearchMaterials,
  wareLabels,
}: ResearchTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const allUnlocked = useMemo(
    () => new Set([...completedResearch, ...pendingResearch]),
    [completedResearch, pendingResearch]
  );

  const catalogMap = useMemo(
    () => new Map(researchCatalog.map(e => [e.id, e])),
    [researchCatalog]
  );

  function status(e: ResearchEntry): "completed" | "pending" | "available" | "locked" {
    if (completedResearch.has(e.id)) return "completed";
    if (pendingResearch.has(e.id)) return "pending";
    const blocking = e.prerequisites.filter(p => !catalogMap.get(p)?.missiononly);
    if (blocking.every(p => allUnlocked.has(p))) return "available";
    return "locked";
  }

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const map: Record<string, typeof researchCatalog> = {};

    for (const e of researchCatalog) {
      if (e.missiononly) continue;
      const st = status(e);
      if (filter === "completed" && st !== "completed" && st !== "pending") continue;
      if (filter === "available" && st !== "available") continue;
      if (filter === "locked" && st !== "locked") continue;
      if (q && !e.id.toLowerCase().includes(q) && !(cleanName(e.name)).toLowerCase().includes(q)) continue;

      const cat = categoryLabel(e);
      (map[cat] ??= []).push(e);
    }

    for (const cat of Object.keys(map)) {
      map[cat] = topoSort(map[cat]);
    }

    return map;
  }, [researchCatalog, filter, search, allUnlocked, completedResearch, pendingResearch]);

  const totalVisible = useMemo(
    () => Object.values(groups).reduce((s, v) => s + v.length, 0),
    [groups]
  );

  const completedCount = useMemo(
    () => researchCatalog.filter(e => completedResearch.has(e.id) || pendingResearch.has(e.id)).length,
    [researchCatalog, completedResearch, pendingResearch]
  );

  const CATEGORY_ORDER = ["Teleportation", "Station Modules", "Equipment Mods", "Agents & Diplomacy", "Ships", "Xenon", "System"];

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-md border overflow-hidden text-sm">
            {(["table", "tree"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={[
                  "px-3 py-1.5 transition-colors capitalize",
                  viewMode === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {v === "table" ? "Table" : "Tree"}
              </button>
            ))}
          </div>

          {viewMode === "table" && (
            <SearchField
              className="flex-1 min-w-40"
              placeholder="Filter by name or ID…"
              value={search}
              onValueChange={setSearch}
            />
          )}

          {viewMode === "table" && (
            <div className="flex rounded-md border overflow-hidden text-sm">
              {(["all", "completed", "available", "locked"] as Filter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={[
                    "px-3 py-1.5 transition-colors capitalize",
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          <span className="text-xs text-muted-foreground tabular-nums ml-auto">
            {completedCount} / {researchCatalog.length} completed
          </span>
          {viewMode === "table" && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalVisible} shown
            </span>
          )}
        </div>

        {viewMode === "tree" && (
          <ResearchTreeView
            researchCatalog={researchCatalog}
            completedResearch={completedResearch}
            pendingResearch={pendingResearch}
            toggleResearch={toggleResearch}
          />
        )}

        {viewMode === "table" && <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Research</TableHead>
                <TableHead className="w-20 text-right">Time</TableHead>
                <TableHead className="w-48">Prerequisites</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATEGORY_ORDER.filter(cat => groups[cat]?.length).map(cat => (
                <>
                  <TableRow key={cat} className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30"
                    >
                      {cat}
                      <span className="ml-2 font-normal normal-case tracking-normal">
                        ({groups[cat].length})
                      </span>
                    </TableCell>
                  </TableRow>
                  {groups[cat].map(e => {
                    const st = status(e);
                    const isPending = st === "pending";
                    const isCompleted = st === "completed";
                    const isAvailable = st === "available";
                    const missingPrereqs = e.prerequisites.filter(p => !allUnlocked.has(p));

                    return (
                      <TableRow
                        key={e.id}
                        className={[
                          isPending ? "bg-green-500/5" : "",
                        ].join(" ")}
                      >
                        <TableCell>
                          {isCompleted && <Badge variant="outline" className="border-green-600 text-green-600 dark:text-green-400">Completed</Badge>}
                          {isPending  && <Badge variant="outline" className="border-green-500 text-green-500">+ Pending</Badge>}
                          {isAvailable && <Badge variant="outline" className="border-blue-500 text-blue-500">Available</Badge>}
                          {st === "locked" && <Badge variant="outline" className="text-muted-foreground">Locked</Badge>}
                        </TableCell>

                        <TableCell>
                          <div className="font-medium">{cleanName(e.name) || e.id}</div>
                          {e.dlc !== "vanilla" && (
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              {e.dlc.replace(/_/g, " ")}
                            </span>
                          )}
                          {(e.hidden || e.missiononly) && (
                            <span className="ml-1 text-[10px] text-muted-foreground">{e.missiononly ? "· mission" : "· system"}</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                          {formatTime(e.time)}
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground">
                          {missingPrereqs.length > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400">
                              Needs: {missingPrereqs.map(p => cleanName(researchCatalog.find(r => r.id === p)?.name ?? null) || p).join(", ")}
                            </span>
                          ) : e.prerequisites.length > 0 ? (
                            <span className="text-green-600 dark:text-green-400">✓ Met</span>
                          ) : (
                            <span>—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isCompleted && e.materials.length > 0 && (
                              <button
                                onClick={() => addResearchMaterials(e.materials)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                                title={e.materials.map(m => `${m.amount}× ${wareLabels[m.ware] ?? m.ware}`).join("\n")}
                              >
                                + Materials
                              </button>
                            )}
                            {!isCompleted && (
                              <button
                                onClick={() => toggleResearch(e.id)}
                                disabled={st === "locked" && !isPending}
                                className={[
                                  "text-xs px-2 py-0.5 rounded border transition-colors",
                                  isPending
                                    ? "border-green-500 text-green-600 hover:bg-red-500/10 hover:text-red-500 hover:border-red-400"
                                    : isAvailable
                                    ? "border-blue-400 text-blue-500 hover:bg-blue-500/10"
                                    : "border-muted text-muted-foreground opacity-40 cursor-not-allowed",
                                ].join(" ")}
                              >
                                {isPending ? "Cancel" : "Unlock"}
                              </button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </>
              ))}
              {totalVisible === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No research matches the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>}
      </CardContent>
    </Card>
  );
}
