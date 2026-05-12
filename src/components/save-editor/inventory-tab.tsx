import { Fragment, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { capitalize } from "@/lib/format";
import type { InventoryCatalogItem, InventoryItem } from "@/types/save";

type InventoryTabProps = {
  editInventory: InventoryItem[];
  wareLabels: Record<string, string>;
  busy: boolean;
  onUpdateWareAmount: (index: number, amount: number) => void;
  onAddItem: (ware: string, amount: number) => void;
  inventoryCatalog: InventoryCatalogItem[];
  inventorySearch: string;
  setInventorySearch: (v: string) => void;
};

const GROUP_LABELS: Record<string, string> = {
  generalitem:    "General",
  hardware:       "Hardware",
  luxuryitem:     "Luxury",
  curiosity:      "Curiosity",
  contraband:     "Contraband",
  satellite:      "Satellite",
  navbeacon:      "Nav Beacon",
  resourceprobe:  "Resource Probe",
  countermeasure: "Countermeasure",
  lasertower:     "Laser Tower",
};

export function InventoryTab({
  editInventory,
  wareLabels,
  busy,
  onUpdateWareAmount,
  onAddItem,
  inventoryCatalog,
  inventorySearch,
  setInventorySearch,
}: InventoryTabProps) {
  // ── Lookup group_id par ware ───────────────────────────────────────────────
  const wareGroupId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const item of inventoryCatalog) m[item.id] = item.group_id ?? "other";
    return m;
  }, [inventoryCatalog]);

  // ── Inventaire groupé + filtré ─────────────────────────────────────────────
  const inventoryGroups = useMemo(() => {
    const q = inventorySearch.toLowerCase();
    const groups: Record<string, { item: InventoryItem; index: number; lbl: string }[]> = {};
    editInventory.forEach((item, index) => {
      const lbl = wareLabels[item.ware] ?? item.ware;
      if (q && !lbl.toLowerCase().includes(q) && !item.ware.toLowerCase().includes(q)) return;
      const g = wareGroupId[item.ware] ?? "other";
      (groups[g] ??= []).push({ item, index, lbl });
    });
    for (const entries of Object.values(groups)) {
      entries.sort((a, b) => a.lbl.localeCompare(b.lbl));
    }
    return groups;
  }, [editInventory, inventorySearch, wareLabels, wareGroupId]);

  // ── État panneau d'ajout ───────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState("");
  const [addQty, setAddQty]         = useState(1);

  // Catalogue filtré : on retire les items déjà dans l'inventaire
  const ownedIds = useMemo(() => new Set(editInventory.map(i => i.ware)), [editInventory]);

  const catalogByGroup = useMemo(() => {
    const available = inventoryCatalog.filter(i => !ownedIds.has(i.id));
    const groups: Record<string, InventoryCatalogItem[]> = {};
    for (const item of available) {
      const g = item.group_id ?? "other";
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }
    for (const items of Object.values(groups)) {
      items.sort((a, b) => (wareLabels[a.id] ?? a.id).localeCompare(wareLabels[b.id] ?? b.id));
    }
    return groups;
  }, [inventoryCatalog, ownedIds, wareLabels]);

  function handleAdd() {
    if (!selectedId) return;
    onAddItem(selectedId, Math.max(1, addQty));
    setSelectedId("");
    setAddQty(1);
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-4">

        {/* ── Panneau d'ajout ── */}
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            disabled={busy || inventoryCatalog.length === 0}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Select item to add —</option>
            {Object.entries(catalogByGroup).sort(([a], [b]) => a.localeCompare(b)).map(([group, items]) => (
              <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.price ? ` (${item.price.toLocaleString()} cr)` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Input
            type="number"
            min={1}
            value={addQty}
            onChange={e => setAddQty(parseInt(e.target.value, 10) || 1)}
            disabled={busy}
            className="w-20 text-center font-mono"
          />
          <Button
            onClick={handleAdd}
            disabled={busy || !selectedId}
            size="sm"
          >
            Add
          </Button>
        </div>

        {/* ── Filtre inventaire ── */}
        <SearchField
          placeholder="Filter by item name or ware ID…"
          value={inventorySearch}
          onValueChange={setInventorySearch}
        />

        {/* ── Table inventaire (overflow natif + stickyRoot : même schéma que ships-browser) ── */}
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table stickyRoot className="min-w-full">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-sm [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-muted-foreground font-normal min-w-48 max-w-xl">
                  ID
                </TableHead>
                <TableHead className="w-28 text-center">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(inventoryGroups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([group, entries]) => (
                  <Fragment key={group}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={3}
                        className="py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30"
                      >
                        {GROUP_LABELS[group] ?? capitalize(group)}
                        <span className="ml-2 font-normal normal-case tracking-normal">
                          ({entries.length})
                        </span>
                      </TableCell>
                    </TableRow>
                    {entries.map(({ item, index, lbl }) => (
                      <TableRow key={`${item.ware}-${index}`}>
                        <TableCell className="font-medium">{lbl}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.ware}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={1}
                            value={item.amount}
                            onChange={e =>
                              onUpdateWareAmount(index, parseInt(e.target.value, 10) || 1)
                            }
                            disabled={busy}
                            className="w-20 text-center ml-auto font-mono"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
