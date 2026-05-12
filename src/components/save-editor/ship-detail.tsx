import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import iconCatalogue from "@/data/icon_catalogue.json";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupEquip, softwareLabel } from "@/lib/ship-display";
import type { EquipmentCatalog, ShipMod } from "@/types/save";

type ModEntry = { name: string | null; quality: number };
type ModIndex = Record<string, ModEntry>;
import type {
  ControlPostLine,
  ShipInspect,
  ShipOrderLine,
  ShipPersonLine,
} from "@/types/ship-inspect";
import { cn } from "@/lib/utils";

type ShipDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savePath: string;
  shipCode: string | null;
  /** Libellé affiché dans le titre (ex. modèle) */
  shipLabel?: string;
  equipIndex?: Record<string, string>;
  equipmentCatalog?: EquipmentCatalog;
  mods?: ShipMod[];
  modIndex?: ModIndex;
};

function macroShort(m: string): string {
  return m.replace(/_macro$/, "");
}

function skillsHint(p: ShipPersonLine): string {
  const parts: string[] = [];
  if (p.piloting) parts.push(`P${p.piloting}`);
  if (p.management) parts.push(`M${p.management}`);
  if (p.morale) parts.push(`Mo${p.morale}`);
  if (p.engineering) parts.push(`E${p.engineering}`);
  if (p.boarding) parts.push(`B${p.boarding}`);
  return parts.length ? parts.join(" · ") : "—";
}

function Section({
  title,
  defaultOpen,
  children,
  empty: _empty,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen ?? false} className="rounded-md border border-border bg-card">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium",
          "hover:bg-muted/50",
        )}
      >
        {title}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-2 text-sm">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function kvGrid(rows: { k: string; v: React.ReactNode }[]) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(({ k, v }) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground font-medium">{k}</span>
      <span className="min-w-0 break-all font-mono text-[11px]">{v}</span>
    </>
  );
}

function ordersBlock(orders: ShipOrderLine[]) {
  if (orders.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="list-inside list-disc space-y-1 font-mono text-[11px]">
      {orders.map((o, i) => (
        <li key={`${o.order}-${i}`}>
          {o.order}
          {o.state != null && o.state !== "" ? (
            <span className="text-muted-foreground"> ({o.state})</span>
          ) : null}
          {o.default ? <span className="text-muted-foreground"> · default</span> : null}
        </li>
      ))}
    </ul>
  );
}

function controlPostsBlock(posts: ControlPostLine[]) {
  if (posts.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-1 font-mono text-[11px]">
      {posts.map(p => (
        <li key={p.id}>
          <span className="text-foreground">{p.id}</span>
          {p.name != null ? (
            <span className="text-muted-foreground"> → {p.name}</span>
          ) : p.component != null && p.component !== "" ? (
            <span className="text-muted-foreground"> → {macroShort(p.component)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LoadoutDetails({ data, catalog, mods, modIndex }: {
  data: ShipInspect;
  catalog: EquipmentCatalog;
  mods?: ShipMod[];
  modIndex?: ModIndex;
}) {
  const modsByScope = (mods ?? []).reduce<Record<string, ShipMod[]>>((acc, mod) => {
    if (mod.scope === "paint") return acc;
    (acc[mod.scope] ??= []).push(mod);
    return acc;
  }, {});
  const modLabel = (mod: ShipMod) => {
    const entry = modIndex?.[mod.ware];
    return (entry?.name ?? mod.ware) + (entry ? ` Mk${entry.quality}` : "");
  };

  const allItems = [...catalog.weapons, ...catalog.engines, ...catalog.shields, ...catalog.thrusters];
  const nameOf = (macro: string) => {
    const key = macro.replace(/_macro$/, "");
    return allItems.find(i => i.macro_id.replace(/_macro$/, "") === key)?.name ?? key;
  };
  const toLines = (macros: string[]) => {
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const m of macros) {
      const lbl = nameOf(m);
      if (!counts.has(lbl)) order.push(lbl);
      counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
    }
    return order.map(lbl => counts.get(lbl)! > 1 ? `${counts.get(lbl)}× ${lbl}` : lbl);
  };

  const shipMods = modsByScope["ship"] ?? [];

  const categories = [
    { label: "Shields",  macros: data.shields,  modScope: "shield" },
    { label: "Weapons",  macros: data.weapons,  modScope: "weapon" },
    { label: "Turrets",  macros: data.turrets,  modScope: "turret" },
    { label: "Engines",  macros: data.engines,  modScope: "engine" },
    ...(data.thruster ? [{ label: "Thruster", macros: [data.thruster], modScope: "thruster" }] : []),
  ].filter(c => c.macros.length > 0 || (modsByScope[c.modScope]?.length ?? 0) > 0);

  return (
    <div className="space-y-3">
      {categories.map(({ label, macros, modScope }) => (
        <div key={label}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label} ({macros.length})
          </div>
          <ul className="space-y-0.5 text-xs">
            {toLines(macros).map(line => <li key={line}>{line}</li>)}
            {(modsByScope[modScope] ?? []).map((mod, i) => (
              <li key={`mod-${i}`} className="text-orange-400">{modLabel(mod)}</li>
            ))}
          </ul>
        </div>
      ))}
      {shipMods.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ship</div>
          <ul className="space-y-0.5 text-xs">
            {shipMods.map((mod, i) => (
              <li key={i} className="text-orange-400">{modLabel(mod)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Groupe les macros par nom résolu (equipIndex → fallback heuristique) */
function groupEquipNamed(macros: string[], equipIndex?: Record<string, string>): string {
  if (macros.length === 0) return "—";
  const counts = new Map<string, number>();
  for (const m of macros) {
    const key = m.replace(/_macro$/, "");
    const lbl = equipIndex?.[key] ?? groupEquip([m]);
    counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([lbl, n]) => (n > 1 ? `${n}× ${lbl}` : lbl))
    .join(", ");
}

export function ShipDetailDialog({
  open,
  onOpenChange,
  savePath,
  shipCode,
  shipLabel,
  equipIndex,
  equipmentCatalog,
  mods,
  modIndex,
}: ShipDetailDialogProps) {
  const [data, setData] = useState<ShipInspect | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imgScale, setImgScale] = useState(1);

  useEffect(() => {
    if (!open || !shipCode || !savePath.trim()) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    invoke<ShipInspect>("inspect_player_ship", { path: savePath, code: shipCode })
      .then(inspect => {
        if (!cancelled) setData(inspect);
      })
      .catch(e => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, savePath, shipCode]);

  useEffect(() => { setImgScale(1); }, [data?.macro]);

  const roleEntries =
    data != null
      ? Object.entries(data.people_by_role).sort(([a], [b]) => a.localeCompare(b))
      : [];

  const hasMods = (mods ?? []).some(m => m.scope !== "paint");
  const hasLoadout =
    data != null &&
    (data.shields.length > 0 ||
      data.weapons.length > 0 ||
      data.turrets.length > 0 ||
      data.engines.length > 0 ||
      data.thruster != null ||
      hasMods);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,900px)] w-[min(96vw,56rem)] max-w-[min(96vw,56rem)] flex-col gap-3 sm:max-w-[min(96vw,56rem)]"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>
            Ship details — {shipCode}
            {shipLabel ? (
              <span className="ml-2 font-normal text-muted-foreground">({shipLabel})</span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Structured view from the save (crew, loadout, software, orders). Noise like render and
            listeners is omitted.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : data ? (
            <ScrollArea className="h-[min(70vh,640px)]">
              <div className="flex flex-col gap-2 p-3">
                <div className="flex gap-3">
                  <div className="w-1/2 rounded-md border border-border bg-card p-3">
                    {kvGrid([
                      { k: "Code", v: data.code },
                      { k: "Name", v: data.name ?? "—" },
                      { k: "Macro", v: macroShort(data.macro) },
                      { k: "Class", v: data.class },
                      { k: "State", v: data.state ?? "—" },
                      { k: "Connection", v: data.connection ?? "—" },
                    ])}
                  </div>
                  <div
                    className="flex w-1/2 cursor-zoom-in items-center justify-center overflow-hidden rounded-md border border-border bg-card p-2"
                    onWheel={e => {
                      e.stopPropagation();
                      setImgScale(s => Math.min(4, Math.max(0.5, s - e.deltaY * 0.001)));
                    }}
                    onDoubleClick={() => setImgScale(1)}
                    title="Scroll to zoom · double-click to reset"
                  >
                    <img
                      src={(iconCatalogue as Record<string, string>)[data.macro.endsWith("_macro") ? data.macro : data.macro + "_macro"] ?? "/ship_images/notfound.png"}
                      alt={macroShort(data.macro)}
                      className="max-h-44 max-w-full object-contain opacity-90 transition-transform duration-100"
                      style={{ transform: `scale(${imgScale})` }}
                    />
                  </div>
                </div>

                <Section title={`Crew by role (${data.people.length})`}>
                  {roleEntries.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-3">
                      {roleEntries.map(([role, list]) => (
                        <div key={role}>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {role}
                          </div>
                          <ul className="space-y-1.5 border-l-2 border-border pl-2">
                            {list.map((p, i) => (
                              <li key={`${p.macro}-${i}`} className="font-mono text-[11px]">
                                <span className="text-foreground">{macroShort(p.macro)}</span>
                                <span className="ml-2 text-muted-foreground">{skillsHint(p)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Loadout" defaultOpen empty={!hasLoadout}>
                  {!hasLoadout ? (
                    <span className="text-muted-foreground">—</span>
                  ) : equipmentCatalog ? (
                    <LoadoutDetails data={data} catalog={equipmentCatalog} mods={mods} modIndex={modIndex} />
                  ) : (
                    kvGrid([
                      { k: "Shields", v: groupEquipNamed(data.shields, equipIndex) },
                      { k: "Weapons", v: groupEquipNamed(data.weapons, equipIndex) },
                      { k: "Turrets", v: groupEquipNamed(data.turrets, equipIndex) },
                      { k: "Engines", v: groupEquipNamed(data.engines, equipIndex) },
                      ...(data.thruster != null ? [{
                        k: "Thruster",
                        v: equipIndex?.[data.thruster.replace(/_macro$/, "")] ?? macroShort(data.thruster),
                      }] : []),
                    ])
                  )}
                </Section>

                <Section title={`Software (${data.software.length})`} empty={data.software.length === 0}>
                  {data.software.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {data.software.map(s => (
                        <span
                          key={s}
                          className="inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {softwareLabel(s)}
                        </span>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title={`Orders (${data.orders.length})`} empty={data.orders.length === 0}>
                  {ordersBlock(data.orders)}
                </Section>

                <Section
                  title={`Control posts (${data.control_posts.length})`}
                  empty={data.control_posts.length === 0}
                >
                  {controlPostsBlock(data.control_posts)}
                </Section>

                <Section
                  title={`Other components (${data.other_components.length})`}
                  empty={data.other_components.length === 0}
                >
                  {data.other_components.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]">
                      {data.other_components.map((c, i) => (
                        <li key={`${c.class}-${c.macro}-${i}`}>
                          <span className="text-muted-foreground">{c.class}</span>{" "}
                          <span>{macroShort(c.macro)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            </ScrollArea>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">—</div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
