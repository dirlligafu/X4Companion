import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { PlayerBasics } from "@/types/save";

type OverviewTabProps = {
  data: PlayerBasics;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editMoney: number;
  setEditMoney: (v: number) => void;
  editModified: boolean;
  setEditModified: (v: boolean) => void;
};

export function OverviewTab({
  data,
  busy,
  editName,
  setEditName,
  editMoney,
  setEditMoney,
  editModified,
  setEditModified,
}: OverviewTabProps) {
  return (
    <Card className="shrink-0">
      <CardContent className="pt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label>Player</Label>
          <Input value={editName} onChange={e => setEditName(e.target.value)} disabled={busy} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label className="text-muted-foreground">Save</Label>
          <span className="text-sm">{data.summary.save_name}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label className="text-muted-foreground">Date</Label>
          <span className="text-sm">{fmtDate(data.summary.save_date)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label className="text-muted-foreground">Location</Label>
          <span className="text-sm font-mono text-muted-foreground break-all">{data.summary.location}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label className="text-muted-foreground">Version</Label>
          <span className="text-sm text-muted-foreground">
            {data.summary.game_version} (build {data.summary.game_build})
          </span>
        </div>
        {(() => {
          const dlcs = data.summary.patches.filter(p => p.extension.startsWith("ego_dlc"));
          const mods = data.summary.patches.filter(p => !p.extension.startsWith("ego_dlc"));
          return (
            <>
              {dlcs.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-start">
                  <Label className="text-muted-foreground">DLCs</Label>
                  <div className="flex flex-wrap gap-1">
                    {dlcs.map(p => (
                      <span
                        key={p.extension}
                        className="inline-block rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {p.name || p.extension}
                        {p.version && <span className="ml-1 opacity-50">v{p.version}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {mods.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-start">
                  <Label className="text-muted-foreground">Mods</Label>
                  <div className="flex flex-wrap gap-1">
                    {mods.map(p => (
                      <span
                        key={p.extension}
                        className="inline-block rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {p.name || p.extension}
                        {p.version && <span className="ml-1 opacity-50">v{p.version}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        <Separator />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-center">
          <Label>Money (cr)</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="number"
              min={0}
              value={editMoney}
              onChange={e => setEditMoney(Math.max(0, parseInt(e.target.value, 10) || 0))}
              disabled={busy}
              className="w-44 font-mono"
            />
            <span className="text-sm text-muted-foreground">{fmtNumber(editMoney)} cr</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[min(160px,40%)_1fr] sm:items-start">
          <Label htmlFor="modified">Modified flag</Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="modified"
              checked={editModified}
              onCheckedChange={v => setEditModified(!!v)}
              disabled={busy}
            />
            <span className="text-xs text-muted-foreground">
              {editModified ? "yes — visible in game" : "no — looks legitimate"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
