import { Fragment, useState, useMemo } from "react";
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
import { repBadge, repRank, maxEditableRank } from "@/lib/reputation";
import type { PlayerBasics } from "@/types/save";

type ReputationsTabProps = {
  data: PlayerBasics;
  factionNames: Record<string, string>;
  editReputations: Map<string, number>;
  updateReputation: (factionId: string, rank: number) => void;
  busy: boolean;
};

const LICENCE_LABELS: Record<string, string> = {
  capitalequipment:        "Cap. Equip",
  capitalship:             "Cap. Ship",
  militaryequipment:       "Mil. Equip",
  militaryship:            "Mil. Ship",
  police:                  "Police",
  station_gen_basic:       "Stn Basic",
  station_gen_intermediate:"Stn Mid",
  station_gen_advanced:    "Stn Adv",
  station_equip_sm:        "Stn Equip S/M",
  station_equip_lxl:       "Stn Equip L/XL",
  station_illegal:         "Stn Illegal",
  innercore_access:        "Inner Core",
  outercore_access:        "Outer Core",
  ceremonyally:            "Ceremony Ally",
  ceremonyfriend:          "Ceremony Friend",
  shipsalecontract:        "Ship Sale",
  subgroupfriend:          "Subgroup",
  tradesubscription:       "Trade Sub",
  generaluseequipment:     "Gen. Equip",
  generaluseship:          "Gen. Ship",
};

const NOTABLE = new Set([
  "capitalequipment", "capitalship", "militaryequipment", "militaryship",
  "police", "station_gen_advanced", "station_equip_lxl", "station_illegal",
  "innercore_access", "outercore_access", "shipsalecontract",
]);

export function ReputationsTab({
  data,
  factionNames,
  editReputations,
  updateReputation,
  busy,
}: ReputationsTabProps) {
  const [repSearch, setRepSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Factions that have an existing relation in the save (can be edited)
  const existingFactions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data.reputations) set.add(r.faction_id);
    return set;
  }, [data.reputations]);

  // Original rank per faction (sum of all relation/booster entries)
  const originalRanks = useMemo(() => {
    const sums = new Map<string, number>();
    for (const r of data.reputations) {
      sums.set(r.faction_id, (sums.get(r.faction_id) ?? 0) + r.relation);
    }
    const ranks = new Map<string, number>();
    for (const [fid, sum] of sums) ranks.set(fid, repRank(sum));
    return ranks;
  }, [data.reputations]);

  const licencesByFaction = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of data.licences) {
      for (const factionId of entry.factions) {
        const list = map.get(factionId) ?? [];
        list.push(entry.licence_type);
        map.set(factionId, list);
      }
    }
    return map;
  }, [data.licences]);

  const allFactions = useMemo(() => {
    return Object.entries(factionNames).map(([id, name]) => ({
      id,
      name,
      hasRelation: existingFactions.has(id),
    }));
  }, [factionNames, existingFactions]);

  const rows = useMemo(() => {
    const q = repSearch.toLowerCase();
    return allFactions
      .filter(
        ({ name, id }) => !q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        // Sort by ORIGINAL rank (stable during editing — avoids slider jumping)
        const ra = originalRanks.get(a.id) ?? null;
        const rb = originalRanks.get(b.id) ?? null;
        if (ra === null && rb === null) return a.name.localeCompare(b.name);
        if (ra === null) return 1;
        if (rb === null) return -1;
        return rb - ra;
      });
  }, [allFactions, repSearch, originalRanks]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <SearchField
          placeholder="Filter by faction name…"
          value={repSearch}
          onValueChange={setRepSearch}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Faction</TableHead>
                <TableHead className="w-52">Reputation</TableHead>
                <TableHead className="text-center w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ id, name, hasRelation }) => {
                const rank = editReputations.get(id) ?? null;
                const badge =
                  rank !== null
                    ? repBadge(rank)
                    : { label: "Unknown", className: "bg-muted/50 text-muted-foreground border-border opacity-60" };
                const isExpanded = expandedId === id;
                const licences = licencesByFaction.get(id) ?? [];
                const notable = licences.filter(l => NOTABLE.has(l));

                return (
                  <Fragment key={id}>
                    <TableRow
                      className={`${rank === null ? "opacity-50" : ""} ${licences.length > 0 ? "cursor-pointer" : ""}`}
                      onClick={() => licences.length > 0 && setExpandedId(isExpanded ? null : id)}
                    >
                      <TableCell className="font-medium">
                        {name}
                        {notable.length > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground/60">
                            {notable.length} licence{notable.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasRelation && rank !== null ? (() => {
                          const origRank = originalRanks.get(id) ?? 0;
                          const maxRank  = maxEditableRank(origRank);
                          const isTrigger = rank === maxRank && (maxRank === 9 || maxRank === 19);
                          return (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="range"
                                min={-30}
                                max={maxRank}
                                step={1}
                                value={rank}
                                disabled={busy}
                                onChange={e => updateReputation(id, Number(e.target.value))}
                                className="w-36 cursor-pointer accent-current disabled:opacity-50"
                              />
                              <span className="w-7 text-right tabular-nums text-xs text-muted-foreground">
                                {rank > 0 ? `+${rank}` : rank}
                              </span>
                              {isTrigger && (
                                <span className="text-xs text-amber-500 whitespace-nowrap">
                                  {maxRank === 9 ? "→ Friend" : "→ Ally"}
                                </span>
                              )}
                            </div>
                          );
                        })() : null}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${badge.className}`}>
                          {badge.label}
                        </span>
                      </TableCell>
                    </TableRow>
                    {isExpanded && licences.length > 0 && (
                      <TableRow key={`${id}-licences`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={3} className="py-2 px-4">
                          <div className="flex flex-wrap gap-1">
                            {licences.map(lt => (
                              <span
                                key={lt}
                                className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                  NOTABLE.has(lt)
                                    ? "border-border text-foreground"
                                    : "border-border/40 text-muted-foreground"
                                }`}
                              >
                                {LICENCE_LABELS[lt] ?? lt}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
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
