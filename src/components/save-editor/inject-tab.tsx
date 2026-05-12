import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { ShipCatalogItem } from "@/types/save";

type Props = { savePath: string };

type TemplateEntry = {
  key: string;
  macro: string;
  size: string;
  label: string;
  factionId: string | null;
  shipType: string | null;
};

type QueueEntry = TemplateEntry & { fittingPath?: string };

const SIZE_ABBR: Record<string, string> = {
  small: "S",
  medium: "M",
  large: "L",
  "x-large": "XL",
};

function buildEntry(
  key: string,
  size: string,
  catalog: ShipCatalogItem[],
  factionNames: Record<string, string>
): TemplateEntry {
  const macro = key.includes("/") ? key.split("/")[1] : key;
  const item = catalog.find(s => s.macro_id === `${macro}_macro`);
  if (!item) return { key, macro, size, label: macro, factionId: null, shipType: null };
  const factionLabel = item.faction ? (factionNames[item.faction] ?? item.faction) : null;
  const suffix = item.ship_type ? ` (${item.ship_type})` : "";
  const label = factionLabel ? `${factionLabel} — ${item.name}${suffix}` : `${item.name}${suffix}`;
  return { key, macro, size, label, factionId: item.faction ?? null, shipType: item.ship_type ?? null };
}

export function InjectTab({ savePath }: Props) {
  const [templates, setTemplates] = useState<Record<string, string[]>>({});
  const [catalog, setCatalog] = useState<ShipCatalogItem[]>([]);
  const [factionNames, setFactionNames] = useState<Record<string, string>>({});
  const [sizeFilter, setSizeFilter] = useState("all");
  const [factionFilter, setFactionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState<{ macro: string; x: number; y: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    invoke<Record<string, string[]>>("list_ship_templates")
      .then(setTemplates)
      .catch(() => setTemplates({}));
    invoke<ShipCatalogItem[]>("get_ships_catalog")
      .then(setCatalog)
      .catch(() => setCatalog([]));
    invoke<Record<string, string>>("get_faction_names")
      .then(setFactionNames)
      .catch(() => setFactionNames({}));
  }, []);

  const allEntries = useMemo<TemplateEntry[]>(() => {
    const entries: TemplateEntry[] = [];
    for (const [size, keys] of Object.entries(templates)) {
      for (const key of keys) {
        entries.push(buildEntry(key, size, catalog, factionNames));
      }
    }
    return entries;
  }, [templates, catalog, factionNames]);

  const availableSizes = useMemo(
    () => ["small", "medium", "large", "x-large"].filter(s => (templates[s] ?? []).length > 0),
    [templates]
  );

  const factions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of allEntries) {
      if (e.factionId && !seen.has(e.factionId)) {
        seen.set(e.factionId, factionNames[e.factionId] ?? e.factionId);
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allEntries, factionNames]);

  const types = useMemo(() => {
    const seen = new Set<string>();
    for (const e of allEntries) {
      if (e.shipType) seen.add(e.shipType);
    }
    return [...seen].sort();
  }, [allEntries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allEntries.filter(e =>
      (sizeFilter === "all" || e.size === sizeFilter) &&
      (factionFilter === "all" || e.factionId === factionFilter) &&
      (typeFilter === "all" || e.shipType === typeFilter) &&
      (q === "" || e.label.toLowerCase().includes(q))
    );
  }, [allEntries, sizeFilter, factionFilter, typeFilter, search]);

  function addToQueue(entry: TemplateEntry) {
    setQueue(q => [...q, entry]);
  }

  function removeFromQueue(index: number) {
    setQueue(q => q.filter((_, i) => i !== index));
  }

  async function pickFitting(index: number) {
    const path = await openDialog({
      title: "Load custom fitting",
      filters: [{ name: "Fitting XML", extensions: ["xml"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    setQueue(q => q.map((e, i) => i === index ? { ...e, fittingPath: path } : e));
  }

  function clearFitting(index: number) {
    setQueue(q => q.map((e, i) => i === index ? { ...e, fittingPath: undefined } : e));
  }

  async function addFittingDirect() {
    const path = await openDialog({
      title: "Inject custom fitting",
      filters: [{ name: "Fitting XML", extensions: ["xml"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    try {
      const loaded = await invoke<{ ship_macro: string; loadout: Record<string, string> }>(
        "load_fitting_from_path", { path }
      );
      const macroId = loaded.ship_macro.endsWith("_macro") ? loaded.ship_macro : loaded.ship_macro + "_macro";
      const item = catalog.find(s => s.macro_id === macroId);
      const size = item?.size ?? "medium";
      const sizeKey = size === "s" ? "small" : size === "m" ? "medium" : size === "l" ? "large" : size === "xl" ? "x-large" : "medium";
      const label = item ? (item.faction ? `${factionNames[item.faction] ?? item.faction} — ${item.name}` : item.name) : loaded.ship_macro;
      const macro = loaded.ship_macro.replace(/_macro$/, "");
      setQueue(q => [...q, { key: sizeKey + "/" + macro, macro, size: sizeKey, label, factionId: item?.faction ?? null, shipType: item?.ship_type ?? null, fittingPath: path }]);
    } catch (e) {
      setStatus({ ok: false, msg: `Fitting load error: ${String(e)}` });
    }
  }

  async function handleInjectAll() {
    if (queue.length === 0 || !savePath.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      const codes = await invoke<string[]>("inject_ships", {
        savePath,
        templateNames: queue.map(e => e.fittingPath ?? e.key),
      });
      setStatus({ ok: true, msg: `${codes.length} vaisseau(x) injecté(s) — codes : ${codes.join(", ")}` });
      setQueue([]);
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const filterBtn = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
    }`;

  const selectCls = "rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="flex flex-col h-full p-4 gap-3">

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Preview toggle */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none mr-1">
          <input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} className="cursor-pointer" />
          Preview
        </label>

        {/* Taille */}
        <div className="flex gap-1">
          <button className={filterBtn(sizeFilter === "all")} onClick={() => setSizeFilter("all")}>All</button>
          {availableSizes.map(s => (
            <button key={s} className={filterBtn(sizeFilter === s)} onClick={() => setSizeFilter(s)}>
              {SIZE_ABBR[s]}
            </button>
          ))}
        </div>

        {/* Faction */}
        <select className={selectCls} value={factionFilter} onChange={e => setFactionFilter(e.target.value)}>
          <option value="all">All factions</option>
          {factions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>

        {/* Type */}
        <select className={selectCls} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {types.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Recherche */}
        <input
          className={`${selectCls} flex-1 min-w-0`}
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Custom fitting direct */}
        <button
          className="text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0 font-medium"
          onClick={addFittingDirect}
        >
          + Custom fitting…
        </button>

        {/* Reset filtres */}
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          onClick={() => { setSizeFilter("all"); setFactionFilter("all"); setTypeFilter("all"); setSearch(""); }}
        >
          Reset
        </button>
      </div>

      {/* Listes */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* Catalogue */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">
            Catalog <span className="text-foreground font-medium">({filtered.length})</span>
          </div>
          <div className="flex-1 min-h-0 rounded-md border border-input overflow-y-auto">
            {filtered.length === 0
              ? <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No results</div>
              : filtered.map(e => (
                  <button
                    key={e.key}
                    onClick={() => addToQueue(e)}
                    onMouseEnter={ev => showPreview && setHovered({ macro: e.macro, x: ev.clientX, y: ev.clientY })}
                    onMouseMove={ev => showPreview && setHovered(h => h ? { ...h, x: ev.clientX, y: ev.clientY } : null)}
                    onMouseLeave={() => setHovered(null)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left gap-2"
                  >
                    <span className="truncate">{e.label}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{SIZE_ABBR[e.size]}</span>
                  </button>
                ))
            }
          </div>
        </div>

        {/* Queue */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">
            Queue <span className="text-foreground font-medium">({queue.length})</span>
          </div>
          <div className="flex-1 min-h-0 rounded-md border border-input overflow-y-auto">
            {queue.length === 0
              ? <div className="flex items-center justify-center h-full text-xs text-muted-foreground">Empty</div>
              : queue.map((e, i) => (
                  <div key={i} className="flex flex-col px-3 py-1.5 gap-0.5 border-b border-border last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{e.label}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">{SIZE_ABBR[e.size]}</span>
                        <button
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => removeFromQueue(i)}
                        >×</button>
                      </div>
                    </div>
                    {e.fittingPath ? (
                      <div className="flex items-center gap-1 text-[11px] text-green-500">
                        <span className="truncate">{e.fittingPath.split(/[\\/]/).pop()}</span>
                        <button
                          className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => clearFitting(i)}
                        >×</button>
                      </div>
                    ) : (
                      <button
                        className="text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => pickFitting(i)}
                      >
                        + Custom fitting…
                      </button>
                    )}
                  </div>
                ))
            }
          </div>
        </div>

      </div>

      {/* Tooltip image vaisseau */}
      {hovered && (() => {
        const size = 192;
        const gap = 16;
        const x = hovered.x + gap + size > window.innerWidth ? hovered.x - gap - size : hovered.x + gap;
        const y = Math.max(0, Math.min(hovered.y - size / 2, window.innerHeight - size));
        return (
          <div
            className="fixed z-50 pointer-events-none rounded-md overflow-hidden shadow-xl border border-border bg-background"
            style={{ left: x, top: y, width: size, height: size }}
          >
            <img
              src={`/ship_images/${hovered.macro}_macro.png`}
              onError={e => { (e.target as HTMLImageElement).src = "/ship_images/notfound.png"; }}
              width={size}
              height={size}
              className="block"
            />
          </div>
        );
      })()}

      {/* Pied fixe */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        {status && (
          <div className={`rounded-md border px-3 py-2 text-sm font-mono ${status.ok ? "border-green-600 text-green-600" : "border-destructive text-destructive"}`}>
            {status.msg}
          </div>
        )}
        <Button onClick={handleInjectAll} disabled={queue.length === 0 || !savePath.trim() || loading}>
          {loading ? "Injection…" : `Inject (${queue.length})`}
        </Button>
      </div>

    </div>
  );
}
