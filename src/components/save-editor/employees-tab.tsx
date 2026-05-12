import { useMemo } from "react";
import { Star } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { NpcTraitKey } from "@/hooks/useSaveEditor";
import type { NpcInfo, PlayerBasics } from "@/types/save";

type EmployeesTabProps = {
  data: PlayerBasics;
  editNpcs: NpcInfo[];
  busy: boolean;
  updateNpcTrait: (code: string, key: NpcTraitKey, value: number) => void;
  employeeSearch: string;
  setEmployeeSearch: (v: string) => void;
  shipLabels: Record<string, string>;
  onSelectShip?: (code: string) => void;
  onSelectStation?: (code: string) => void;
};

const POST_LABEL: Record<string, string> = {
  aipilot:      "Pilot",
  manager:      "Manager",
  buildmanager: "Build Mgr",
  engineer:     "Engineer",
};

function postLabel(post: string) {
  return POST_LABEL[post] ?? post;
}

function postBadgeClass(post: string) {
  const map: Record<string, string> = {
    aipilot:
      "bg-blue-100 text-blue-900 border-blue-300/90 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
    manager:
      "bg-purple-100 text-purple-900 border-purple-300/90 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800",
    buildmanager:
      "bg-orange-100 text-orange-900 border-orange-300/90 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800",
  };
  return map[post] ?? "bg-muted text-muted-foreground border-border";
}

/** Affichage : 0–15 → 0–5 étoiles (~3 points par palier, arrondi). Clic : paliers 0, 3, 6, 9, 12, 15 uniquement. */
function traitScoreToFilledStars(score15: number): number {
  return Math.min(5, Math.max(0, Math.round(score15 / 3)));
}

/**
 * Clic sur l'étoile d'index i (0 = gauche) : fixe le score à (i+1)×3 (3…15).
 * Re-clic sur l'étoile du palier actuellement actif : descend d'un cran ((i)×3), donc 3→0, 6→3, …, 15→12.
 */
function TraitStarRating({
  value,
  traitLabel,
  busy,
  onChange,
}: {
  value: number;
  traitLabel: string;
  busy: boolean;
  onChange: (v: number) => void;
}) {
  const score = Math.min(15, Math.max(0, Math.round(value)));
  const filled = traitScoreToFilledStars(score);

  return (
    <div
      className="inline-flex flex-col items-center gap-0.5 py-0.5"
      role="group"
      aria-label={`${traitLabel}, score ${score}/15, ${filled} of 5 stars. Click a star for tiers 3–15; same star again steps down (3→0, 6→3, …).`}
    >
      <span className="sr-only">
        {traitLabel}, {score} out of 15, {filled} of 5 stars. Discrete steps 0, 3, 6, 9, 12, 15.
      </span>
      <div className="inline-flex justify-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const isFilled = i < filled;
          const target = (i + 1) * 3;
          const isActiveTier = score === target;
          const tip = `${traitLabel}: ${target}/15 (${i + 1} star${i > 0 ? "s" : ""})${score === target ? " — click again to step down" : ""}`;
          return (
            <button
              key={i}
              type="button"
              disabled={busy}
              title={tip}
              aria-label={`${traitLabel} star ${i + 1} of 5, sets ${(i + 1) * 3} of 15`}
              className={cn(
                "rounded p-0.5 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                busy && "cursor-not-allowed opacity-50",
                !busy && "cursor-pointer hover:opacity-90",
              )}
              onClick={() => {
                if (busy) return;
                if (score === target) {
                  onChange(i * 3);
                } else {
                  onChange(target);
                }
              }}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5 shrink-0 stroke-[1.15]",
                  isFilled
                    ? "fill-amber-500 text-amber-500 stroke-amber-600/40 dark:fill-amber-400 dark:text-amber-400 dark:stroke-amber-500/50"
                    : "fill-none text-amber-400/25 stroke-amber-500/50 dark:text-amber-400/20 dark:stroke-amber-400/45",
                  isActiveTier && isFilled && "ring-1 ring-amber-600/50 rounded-sm dark:ring-amber-400/40",
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function shipLocationParts(
  npc: NpcInfo,
  shipByCode: Map<string, PlayerBasics["ships"][number]>,
  shipLabels: Record<string, string>
): { line: string; title: string } {
  const code = npc.ship_code ?? "";
  if (!code) return { line: "", title: "" };
  const ship = shipByCode.get(code);
  const model = ship ? shipLabels[ship.macro_id] ?? ship.hull : "";
  if (npc.ship_name) {
    return {
      line: npc.ship_name,
      title: model ? `${npc.ship_name} · ${model} · ${code}` : `${npc.ship_name} · ${code}`,
    };
  }
  const line = model || code;
  return {
    line,
    title: model && model !== code ? `${line} · ${code}` : code,
  };
}

export function EmployeesTab({
  data,
  editNpcs,
  busy,
  updateNpcTrait,
  employeeSearch,
  setEmployeeSearch,
  shipLabels,
  onSelectShip,
  onSelectStation,
}: EmployeesTabProps) {
  const applyAllNpcTraits = (value: number) => {
    for (const npc of editNpcs) {
      updateNpcTrait(npc.code, "piloting", value);
      updateNpcTrait(npc.code, "management", value);
      updateNpcTrait(npc.code, "morale", value);
      updateNpcTrait(npc.code, "engineering", value);
      updateNpcTrait(npc.code, "boarding", value);
    }
  };

  const handleAllFiveAllNpcs = () => {
    if (busy || editNpcs.length === 0) return;
    if (!window.confirm(`Set all 5 skills to max (5 stars) for ${editNpcs.length} NPCs?`)) return;
    applyAllNpcTraits(15);
  };

  const handleAllZeroAllNpcs = () => {
    if (busy || editNpcs.length === 0) return;
    if (!window.confirm(`Set all 5 skills to 0 for ${editNpcs.length} NPCs?`)) return;
    applyAllNpcTraits(0);
  };

  const shipByCode = useMemo(() => {
    const m = new Map<string, PlayerBasics["ships"][number]>();
    for (const s of data.ships) m.set(s.code, s);
    return m;
  }, [data.ships]);

  const list = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    return editNpcs
      .filter(npc => {
        if (!q) return true;
        const { line: shipLine } = shipLocationParts(npc, shipByCode, shipLabels);
        const ship = npc.ship_code ? shipByCode.get(npc.ship_code) : undefined;
        const modelStr = ship ? (shipLabels[ship.macro_id] ?? ship.hull).toLowerCase() : "";
        return (
          npc.name.toLowerCase().includes(q) ||
          npc.code.toLowerCase().includes(q) ||
          npc.id.toLowerCase().includes(q) ||
          npc.race.toLowerCase().includes(q) ||
          postLabel(npc.post).toLowerCase().includes(q) ||
          (npc.ship_name ?? "").toLowerCase().includes(q) ||
          (npc.ship_code ?? "").toLowerCase().includes(q) ||
          shipLine.toLowerCase().includes(q) ||
          modelStr.includes(q) ||
          (npc.station_name ?? "").toLowerCase().includes(q) ||
          (npc.station_code ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const order = ["aipilot", "manager", "buildmanager"];
        const oa = order.indexOf(a.post);
        const ob = order.indexOf(b.post);
        if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
        return a.name.localeCompare(b.name);
      });
  }, [editNpcs, employeeSearch, shipByCode, shipLabels]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchField
              placeholder="Filter by name, race, role or ship…"
              value={employeeSearch}
              onValueChange={setEmployeeSearch}
            />
          </div>
          <button
            type="button"
            disabled={busy || editNpcs.length === 0}
            className={cn(
              "shrink-0 inline-flex items-center rounded border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
              (busy || editNpcs.length === 0)
                ? "cursor-not-allowed opacity-50"
                : "hover:border-foreground hover:text-foreground",
            )}
            title={`Set all 5 skills to max for all ${editNpcs.length} NPCs`}
            onClick={handleAllFiveAllNpcs}
          >
            All 5 (all NPCs)
          </button>
          <button
            type="button"
            disabled={busy || editNpcs.length === 0}
            className={cn(
              "shrink-0 inline-flex items-center rounded border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
              (busy || editNpcs.length === 0)
                ? "cursor-not-allowed opacity-50"
                : "hover:border-foreground hover:text-foreground",
            )}
            title={`Set all 5 skills to 0 for all ${editNpcs.length} NPCs`}
            onClick={handleAllZeroAllNpcs}
          >
            All 0 (all NPCs)
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Race</TableHead>
                <TableHead className="text-center">Post</TableHead>
                <TableHead className="text-center">Piloting</TableHead>
                <TableHead className="text-center">Management</TableHead>
                <TableHead className="text-center">Morale</TableHead>
                <TableHead className="text-center">Engineering</TableHead>
                <TableHead className="text-center">Boarding</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((npc, i) => {
                const shipLoc = npc.ship_code
                  ? shipLocationParts(npc, shipByCode, shipLabels)
                  : null;
                const setAllFive = () => {
                  updateNpcTrait(npc.code, "piloting", 15);
                  updateNpcTrait(npc.code, "management", 15);
                  updateNpcTrait(npc.code, "morale", 15);
                  updateNpcTrait(npc.code, "engineering", 15);
                  updateNpcTrait(npc.code, "boarding", 15);
                };
                const setAllZero = () => {
                  updateNpcTrait(npc.code, "piloting", 0);
                  updateNpcTrait(npc.code, "management", 0);
                  updateNpcTrait(npc.code, "morale", 0);
                  updateNpcTrait(npc.code, "engineering", 0);
                  updateNpcTrait(npc.code, "boarding", 0);
                };
                return (
                  <TableRow key={`${npc.code}-${i}`}>
                    <TableCell className="font-medium">
                      <div>{npc.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {npc.code}{npc.id ? <span className="ml-1.5">{npc.id}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm capitalize text-muted-foreground">{npc.race}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${postBadgeClass(npc.post)}`}>
                        {postLabel(npc.post)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm align-middle">
                      <TraitStarRating
                        value={npc.piloting}
                        traitLabel={`${npc.name} piloting`}
                        busy={busy}
                        onChange={v => updateNpcTrait(npc.code, "piloting", v)}
                      />
                    </TableCell>
                    <TableCell className="text-center text-sm align-middle">
                      <TraitStarRating
                        value={npc.management}
                        traitLabel={`${npc.name} management`}
                        busy={busy}
                        onChange={v => updateNpcTrait(npc.code, "management", v)}
                      />
                    </TableCell>
                    <TableCell className="text-center text-sm align-middle">
                      <TraitStarRating
                        value={npc.morale}
                        traitLabel={`${npc.name} morale`}
                        busy={busy}
                        onChange={v => updateNpcTrait(npc.code, "morale", v)}
                      />
                    </TableCell>
                    <TableCell className="text-center text-sm align-middle">
                      <TraitStarRating
                        value={npc.engineering}
                        traitLabel={`${npc.name} engineering`}
                        busy={busy}
                        onChange={v => updateNpcTrait(npc.code, "engineering", v)}
                      />
                    </TableCell>
                    <TableCell className="text-center text-sm align-middle">
                      <TraitStarRating
                        value={npc.boarding}
                        traitLabel={`${npc.name} boarding`}
                        busy={busy}
                        onChange={v => updateNpcTrait(npc.code, "boarding", v)}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {npc.ship_code && shipLoc ? (
                        <span
                          className="cursor-pointer font-medium text-foreground hover:underline"
                          title={shipLoc.title}
                          onClick={() => onSelectShip?.(npc.ship_code!)}
                        >
                          {shipLoc.line}
                        </span>
                      ) : npc.station_code ? (
                        <span
                          className="cursor-pointer text-amber-800/90 hover:text-amber-950 dark:text-amber-400/80 dark:hover:text-amber-300"
                          title={npc.station_name ?? npc.station_code}
                          onClick={() => onSelectStation?.(npc.station_code!)}
                        >
                          {npc.station_name ?? npc.station_code}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center align-middle">
                      <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(
                          "inline-flex items-center rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
                          busy
                            ? "cursor-not-allowed opacity-50"
                            : "hover:border-foreground hover:text-foreground",
                        )}
                        title="Set all NPC skills to 5 stars"
                        onClick={setAllFive}
                      >
                        All 5
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className={cn(
                          "inline-flex items-center rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
                          busy
                            ? "cursor-not-allowed opacity-50"
                            : "hover:border-foreground hover:text-foreground",
                        )}
                        title="Set all NPC skills to 0"
                        onClick={setAllZero}
                      >
                        All 0
                      </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
