import { useMemo } from "react";
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
import type { PlayerBasics } from "@/types/save";

type DeployablesTabProps = {
  data: PlayerBasics;
  deployableSearch: string;
  setDeployableSearch: (v: string) => void;
  sectorNames: Record<string, string>;
};

const DEPLOYABLE_TYPE: Record<string, string> = {
  satellite: "Satellite",
  resourceprobe: "Resource Probe",
  navbeacon: "Nav Beacon",
  lasertower: "Laser Tower",
  mine: "Mine",
};

/** eq_arg_satellite_02 → "Mk2" */
function deployableTier(macro: string): string {
  const m = macro.match(/_0*(\d+)$/);
  return m ? `Mk${m[1]}` : "";
}

/** cluster_31_sector001 → nom réel ou "C31 · S001" en fallback */
function formatSector(macro: string | null, sectorNames: Record<string, string>): string {
  if (!macro) return "—";
  const real = sectorNames[macro + "_macro"];
  if (real) return real;
  const m = macro.match(/cluster_(\d+)_sector(\d+)/);
  if (m) return `C${m[1]} · S${m[2]}`;
  return macro;
}

export function DeployablesTab({ data, deployableSearch, setDeployableSearch, sectorNames }: DeployablesTabProps) {
  const list = useMemo(() => {
    const q = deployableSearch.toLowerCase();
    return data.deployables
      .filter(d => {
        if (!q) return true;
        const type = DEPLOYABLE_TYPE[d.class] ?? d.class;
        return (
          type.toLowerCase().includes(q) ||
          d.code.toLowerCase().includes(q) ||
          formatSector(d.sector_macro, sectorNames).toLowerCase().includes(q) ||
          d.class.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.class !== b.class) return a.class.localeCompare(b.class);
        return a.code.localeCompare(b.code);
      });
  }, [data.deployables, deployableSearch]);

  // Compteurs par type pour l'en-tête
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data.deployables) {
      map.set(d.class, (map.get(d.class) ?? 0) + 1);
    }
    return map;
  }, [data.deployables]);

  const summary = [...counts.entries()]
    .map(([cls, n]) => `${n} ${DEPLOYABLE_TYPE[cls] ?? cls}${n > 1 ? "s" : ""}`)
    .join(" · ");

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">
        {summary && (
          <p className="text-xs text-muted-foreground shrink-0">{summary}</p>
        )}
        <SearchField
          placeholder="Filter by type, code or sector…"
          value={deployableSearch}
          onValueChange={setDeployableSearch}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Tier</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-muted-foreground font-normal text-center">Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d, i) => (
                <TableRow key={`${d.code}-${i}`}>
                  <TableCell className="font-medium">
                    {DEPLOYABLE_TYPE[d.class] ?? d.class}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {deployableTier(d.macro_id) || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatSector(d.sector_macro, sectorNames)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground text-center">
                    {d.code}
                  </TableCell>
                </TableRow>
              ))}
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground/50 italic py-8">
                    No deployables found.
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
