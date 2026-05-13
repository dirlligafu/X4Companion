import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SearchField } from "@/components/ui/search-field";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ModRecipe, ModRecipesData, ModStat } from "@/types/save";

type Props = { mods: ModStat[]; modRecipes?: ModRecipesData | null };

const CATEGORY_LABELS: Record<string, string> = {
  weapon: "Weapon",
  engine: "Engine",
  ship:   "Ship",
  shield: "Shield",
};

const QUALITY_LABELS: Record<number, string> = {
  1: "Mk1",
  2: "Mk2",
  3: "Mk3",
};

const STAT_LABELS: Record<string, string> = {
  // weapon
  damage:          "Damage",
  cooling:         "Cooling",
  reload:          "Reload rate",
  speed:           "Projectile speed",
  lifetime:        "Projectile lifetime",
  mining:          "Mining multiplier",
  sticktime:       "Sticky time",
  chargetime:      "Charge time",
  beamlength:      "Beam length",
  rotationspeed:   "Rotation speed",
  surfaceelement:  "Surface element",
  // engine
  forwardthrust:      "Forward thrust",
  strafethrust:       "Strafe thrust",
  rotationthrust:     "Rotation thrust",
  boostthrust:        "Boost thrust",
  boostduration:      "Boost duration",
  boostacc:           "Boost acceleration",
  travelthrust:       "Travel thrust",
  travelstartthrust:  "Travel start thrust",
  travelattacktime:   "Travel attack time",
  travelchargetime:   "Travel charge time",
  strafeacc:          "Strafe acceleration",
  // ship
  mass:                    "Mass",
  drag:                    "Drag",
  maxhull:                 "Max hull",
  radarrange:              "Radar range",
  countermeasurecapacity:  "Countermeasure cap.",
  deployablecapacity:      "Deployable cap.",
  missilecapacity:         "Missile cap.",
  unitcapacity:            "Unit cap.",
  radarcloak:              "Radar visibility",
  regiondamage:            "Region damage",
  hidecargochance:         "Cargo concealment",
  // shield
  capacity:     "Capacity",
  rechargedelay: "Recharge delay",
  rechargerate:  "Recharge rate",
};

const ADDITIVE_STATS = new Set([
  "countermeasurecapacity", "deployablecapacity", "missilecapacity", "unitcapacity",
]);

function fmtVal(val: number, stat: string): string {
  if (ADDITIVE_STATS.has(stat)) return val >= 0 ? `+${val}` : `${val}`;
  if (val < 0) return `${(val * 100).toFixed(0)}%`;
  const pct = (val - 1) * 100;
  const sign = pct >= 0 ? "+" : "";
  const dec = Number.isInteger(pct) ? 0 : 1;
  return `${sign}${pct.toFixed(dec)}%`;
}

function fmtRange(min: number, max: number, stat: string): string {
  const lo = fmtVal(min, stat);
  const hi = fmtVal(max, stat);
  return lo === hi ? lo : `${lo} → ${hi}`;
}

const COL_COUNT = 7;

function ModDetail({ mod: m, recipe, ingredientNames }: {
  mod: ModStat;
  recipe?: ModRecipe;
  ingredientNames?: Record<string, string | null>;
}) {
  const hasBonuses = (m.bonuses?.length ?? 0) > 0;
  const hasRecipe  = !!recipe;
  if (!hasBonuses && !hasRecipe) return null;

  const maxCount = hasBonuses ? m.bonuses![0].max_count : 0;
  const plural   = maxCount > 1 ? `up to ${maxCount} of` : "one of";

  return (
    <div className={cn(
      "box-border w-full min-w-0 rounded-lg border border-border/80 bg-muted/25 p-4 text-xs",
      "animate-in fade-in slide-in-from-top-0.5 duration-200 fill-mode-both",
      "flex flex-col gap-4",
    )}>
      {hasBonuses && (
        <div>
          <p className="mb-3 text-muted-foreground">
            Rolls <span className="font-medium text-foreground">{plural}</span> the following bonus effects:
          </p>
          <div className="flex flex-col gap-1.5">
            {m.bonuses!.map((b, i) => (
              <div key={i} className="flex items-baseline gap-3">
                <span className="w-44 shrink-0 text-muted-foreground">
                  {STAT_LABELS[b.stat] ?? b.stat}
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {fmtRange(b.min, b.max, b.stat)}
                </span>
                {b.chance < 1 && (
                  <span className="text-muted-foreground/70">{(b.chance * 100).toFixed(0)}% chance</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasRecipe && (
        <div>
          <p className="mb-2 font-medium text-foreground">Crafting recipe</p>
          <div className="flex flex-col gap-1">
            {recipe!.ingredients.map(ing => (
              <div key={ing.ware} className="flex items-baseline gap-3">
                <span className="w-64 shrink-0 text-muted-foreground">
                  {ing.name ?? ing.ware}
                </span>
                <span className="font-mono tabular-nums text-foreground">× {ing.amount}</span>
              </div>
            ))}
          </div>
          {recipe!.research && (
            <p className="mt-2 text-muted-foreground/70">
              Research required:{" "}
              <span className="text-muted-foreground">
                {ingredientNames?.[recipe!.research] ?? recipe!.research}
              </span>
            </p>
          )}
          {recipe!.noplayerblueprint && (
            <p className="mt-1 italic text-muted-foreground/60">Not available in player blueprint</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ModsBrowser({ mods, modRecipes }: Props) {
  const [search, setSearch]           = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter]   = useState<number | null>(null);
  const [expandedWare, setExpandedWare]     = useState<string | null>(null);

  const recipeIndex = useMemo(() => {
    const idx: Record<string, ModRecipe> = {};
    for (const r of modRecipes?.mods ?? []) idx[r.ware] = r;
    return idx;
  }, [modRecipes]);

  function toggleExpand(ware: string) {
    setExpandedWare(p => p === ware ? null : ware);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return mods.filter(m => {
      if (categoryFilter && m.category !== categoryFilter) return false;
      if (qualityFilter  && m.quality  !== qualityFilter)  return false;
      if (!q) return true;
      return (
        (m.name ?? "").toLowerCase().includes(q) ||
        (STAT_LABELS[m.stat] ?? m.stat).toLowerCase().includes(q) ||
        m.stat.toLowerCase().includes(q) ||
        m.ware.toLowerCase().includes(q)
      );
    });
  }, [mods, search, categoryFilter, qualityFilter]);

  // Group by category for table section headers
  const grouped = useMemo(() => {
    const order = ["weapon", "engine", "ship", "shield"];
    const map: Record<string, ModStat[]> = {};
    for (const m of filtered) {
      (map[m.category] ??= []).push(m);
    }
    return order.filter(c => map[c]?.length).map(c => ({ category: c, items: map[c] }));
  }, [filtered]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          <SearchField
            placeholder="Filter by name, stat…"
            value={search}
            onValueChange={setSearch}
            className="flex-1 min-w-48"
          />
          <div className="flex gap-1">
            {["weapon", "engine", "ship", "shield"].map(cat => (
              <Badge
                key={cat}
                variant={categoryFilter === cat ? "default" : "outline"}
                className="cursor-pointer select-none capitalize"
                onClick={() => setCategoryFilter(p => p === cat ? null : cat)}
              >
                {CATEGORY_LABELS[cat]}
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map(q => (
              <Badge
                key={q}
                variant={qualityFilter === q ? "default" : "outline"}
                className="cursor-pointer select-none"
                onClick={() => setQualityFilter(p => p === q ? null : q)}
              >
                {QUALITY_LABELS[q]}
              </Badge>
            ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {filtered.length} mods
          </span>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-6" />
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Stat</TableHead>
                <TableHead className="w-12 text-center">Mk</TableHead>
                <TableHead className="w-36 text-right">Range</TableHead>
                <TableHead className="w-12 text-center">Bonus</TableHead>
                <TableHead className="w-36 text-right text-muted-foreground/70 font-normal text-[11px]">Ware ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(({ category, items }) => (
                <Fragment key={category}>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COL_COUNT} className="py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {CATEGORY_LABELS[category]} — {items.length}
                    </TableCell>
                  </TableRow>
                  {items.map(m => {
                    const isExpanded = expandedWare === m.ware;
                    const hasBonus   = (m.bonuses?.length ?? 0) > 0;
                    const recipe     = recipeIndex[m.ware];
                    const expandable = hasBonus || !!recipe;
                    return (
                      <Fragment key={m.ware}>
                        <TableRow
                          className={cn("cursor-pointer", !expandable && "cursor-default")}
                          onClick={() => expandable && toggleExpand(m.ware)}
                        >
                          <TableCell className="text-muted-foreground pr-0">
                            {expandable
                              ? isExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                              : null}
                          </TableCell>
                          <TableCell className="font-medium">
                            {m.name ?? <span className="text-muted-foreground italic">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {STAT_LABELS[m.stat] ?? m.stat}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">
                            {QUALITY_LABELS[m.quality]}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmtRange(m.min, m.max, m.stat)}
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {hasBonus ? m.bonuses!.length : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[10px] text-muted-foreground/50">
                            {m.ware}
                          </TableCell>
                        </TableRow>
                        {isExpanded && expandable && (
                          <TableRow className="hover:bg-transparent bg-muted/20">
                            <TableCell className="py-0.5 pr-0 align-top" aria-hidden />
                            <TableCell colSpan={COL_COUNT - 1} className="min-w-0 px-0 py-0.5 align-top whitespace-normal">
                              <ModDetail
                                mod={m}
                                recipe={recipe}
                                ingredientNames={modRecipes?.ingredient_names}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
