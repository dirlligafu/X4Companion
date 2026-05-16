import { Fragment, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { capitalize } from "@/lib/format";
import type { BlueprintInfo, PlayerBasics } from "@/types/save";

type Filter = "owned" | "missing" | "all";

type BlueprintsTabProps = {
  data: PlayerBasics;
  blueprintInfos: Record<string, BlueprintInfo>;
  pendingBlueprints: Set<string>;
  toggleBlueprint: (ware: string) => void;
  toggleBlueprintCategory: (wares: string[], setOwned: boolean) => void;
};

export function BlueprintsTab({
  data,
  blueprintInfos,
  pendingBlueprints,
  toggleBlueprint,
  toggleBlueprintCategory,
}: BlueprintsTabProps) {
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("owned");

  const originalSet = useMemo(() => new Set(data.blueprints), [data.blueprints]);

  const pendingAdd    = useMemo(() => [...pendingBlueprints].filter(w => !originalSet.has(w)), [pendingBlueprints, originalSet]);
  const pendingRemove = useMemo(() => [...originalSet].filter(w => !pendingBlueprints.has(w)), [pendingBlueprints, originalSet]);
  const pendingCount  = pendingAdd.length + pendingRemove.length;

  const blueprintGroups = useMemo(() => {
    const q = blueprintSearch.toLowerCase();
    const groups: Record<string, { ware: string; label: string; owned: boolean; changed: boolean }[]> = {};

    for (const [ware, info] of Object.entries(blueprintInfos)) {
      const owned   = pendingBlueprints.has(ware);
      const changed = owned !== originalSet.has(ware);

      if (filter === "owned"   && !owned)  continue;
      if (filter === "missing" && owned)   continue;

      if (q) {
        const lbl = info.label ?? ware;
        if (!ware.toLowerCase().includes(q) && !lbl.toLowerCase().includes(q)) continue;
      }

      const cat = info.category ?? "other";
      (groups[cat] ??= []).push({ ware, label: info.label ?? ware, owned, changed });
    }

    // Sort entries within each category
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => a.label.localeCompare(b.label));
    }

    return groups;
  }, [blueprintInfos, blueprintSearch, filter, pendingBlueprints, originalSet]);

  const totalVisible = useMemo(
    () => Object.values(blueprintGroups).reduce((s, v) => s + v.length, 0),
    [blueprintGroups]
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <SearchField
            className="flex-1 min-w-40"
            placeholder="Filter by name or ID…"
            value={blueprintSearch}
            onValueChange={setBlueprintSearch}
          />

          {/* Segmented filter */}
          <div className="flex rounded-md border overflow-hidden text-sm">
            {(["owned", "missing", "all"] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={[
                  "px-3 py-1.5 transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {f === "owned" ? "Owned" : f === "missing" ? "Missing" : "All"}
              </button>
            ))}
          </div>

          {/* Pending changes badge */}
          {pendingCount > 0 && (
            <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 tabular-nums">
              {pendingAdd.length > 0 && `+${pendingAdd.length}`}
              {pendingAdd.length > 0 && pendingRemove.length > 0 && " "}
              {pendingRemove.length > 0 && `-${pendingRemove.length}`}
              {" pending"}
            </Badge>
          )}

          <span className="text-xs text-muted-foreground tabular-nums ml-auto">
            {totalVisible} shown
          </span>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8 pr-0">
                  <span className="sr-only">Owned</span>
                </TableHead>
                <TableHead>Blueprint</TableHead>
                <TableHead className="text-muted-foreground font-normal font-mono text-xs">Ware ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(blueprintGroups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cat, items]) => (
                  <Fragment key={cat}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={3}
                        className="py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30"
                      >
                        <div className="flex items-center justify-between">
                          <span>
                            {capitalize(cat)}
                            <span className="ml-2 font-normal normal-case tracking-normal">
                              ({items.length})
                            </span>
                          </span>
                          {(() => {
                            const allOwned = items.every(i => i.owned);
                            return (
                              <button
                                className="font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground transition-colors"
                                onClick={e => { e.stopPropagation(); toggleBlueprintCategory(items.map(i => i.ware), !allOwned); }}
                              >
                                {allOwned ? "Deselect all" : "Select all"}
                              </button>
                            );
                          })()}
                        </div>
                      </TableCell>
                    </TableRow>
                    {items.map(({ ware, label, owned, changed }) => (
                      <TableRow
                        key={ware}
                        className={[
                          "cursor-pointer",
                          changed && owned   ? "bg-green-500/5 hover:bg-green-500/10" : "",
                          changed && !owned  ? "bg-red-500/5 hover:bg-red-500/10"   : "",
                        ].join(" ")}
                        onClick={() => toggleBlueprint(ware)}
                      >
                        <TableCell className="w-8 pr-0">
                          <Checkbox
                            checked={owned}
                            onCheckedChange={() => toggleBlueprint(ware)}
                            onClick={e => e.stopPropagation()}
                            className={changed ? (owned ? "border-green-500 data-[state=checked]:bg-green-600" : "border-red-400") : ""}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {label}
                          {changed && (
                            <span className={[
                              "ml-2 text-xs font-normal",
                              owned ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400",
                            ].join(" ")}>
                              {owned ? "· will add" : "· will remove"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{ware}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              {totalVisible === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    No blueprints match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
