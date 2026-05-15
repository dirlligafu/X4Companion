import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import type { InventoryItem, NpcInfo, PlayerBasics } from "@/types/save";

export type NpcTraitKey = "piloting" | "management" | "morale" | "engineering" | "boarding";
import { repRank, rankToWriteValue } from "@/lib/reputation";

export function useSaveEditor(defaultSaveDir: string) {
  const [path, setPath] = useState("");
  const [data, setData] = useState<PlayerBasics | null>(null);
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const [editName, setEditName] = useState("");
  const [editMoney, setEditMoney] = useState(0);
  const [editModified, setEditModified] = useState(false);
  const [editInventory, setEditInventory] = useState<InventoryItem[]>([]);
  const [editNpcs, setEditNpcs] = useState<NpcInfo[]>([]);
  const [pendingBlueprints, setPendingBlueprints] = useState<Set<string>>(new Set());
  const [completedResearch, setCompletedResearch] = useState<string[]>([]);
  const [pendingResearch, setPendingResearch] = useState<Set<string>>(new Set());
  const [editReputations, setEditReputations] = useState<Map<string, number>>(new Map());
  const [editStationCargo, setEditStationCargo] = useState<Map<string, Map<string, number>>>(new Map());
  const [editShipNames, setEditShipNames] = useState<Map<string, string>>(new Map());
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [repSearch, setRepSearch] = useState("");
  const [fleetSearch, setFleetSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [stationSearch, setStationSearch] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [deployableSearch, setDeployableSearch] = useState("");

  const initEditState = useCallback((d: PlayerBasics) => {
    setEditName(d.summary.player_name);
    setEditMoney(d.summary.money);
    setEditModified(d.summary.modified);
    setEditInventory(d.inventory.map(i => ({ ...i })));
    setPendingBlueprints(new Set(d.blueprints));
    // Init reputations: sum base + booster per faction, then get rank
    const sums = new Map<string, number>();
    for (const r of d.reputations) {
      sums.set(r.faction_id, (sums.get(r.faction_id) ?? 0) + r.relation);
    }
    const ranks = new Map<string, number>();
    for (const [fid, combined] of sums) {
      ranks.set(fid, repRank(combined));
    }
    setEditReputations(ranks);
    setEditNpcs(d.npcs.map(n => ({ ...n })));
    setEditStationCargo(new Map());
    setEditShipNames(new Map());
    setPendingResearch(new Set());
  }, []);

  const closeFile = useCallback(() => {
    setPath("");
    setData(null);
    setError("");
    setSaveMsg("");
    setProgress(null);
    setEditName("");
    setEditMoney(0);
    setEditModified(false);
    setEditInventory([]);
    setPendingBlueprints(new Set());
    setCompletedResearch([]);
    setPendingResearch(new Set());
    setEditReputations(new Map());
    setEditNpcs([]);
    setBlueprintSearch("");
    setRepSearch("");
    setFleetSearch("");
    setEmployeeSearch("");
    setStationSearch("");
    setInventorySearch("");
    setDeployableSearch("");
  }, []);

  const pickFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      defaultPath: defaultSaveDir || undefined,
      filters: [{ name: "X4 Save", extensions: ["xml", "gz"] }],
    });
    if (typeof selected === "string") setPath(selected);
  }, [defaultSaveDir]);

  const loadSave = useCallback(async () => {
    const p = path.trim();
    if (!p) return;
    setLoading(true);
    setProgress(0);
    setError("");
    setSaveMsg("");
    setData(null);
    const unlisten = await listen<{ pct: number }>("progress", e =>
      setProgress(e.payload.pct)
    );
    try {
      const [result, research] = await Promise.all([
        invoke<PlayerBasics>("parse_save_basics", { path: p }),
        invoke<string[]>("parse_player_research", { path: p }),
      ]);
      setData(result);
      setCompletedResearch(research);
      setPendingResearch(new Set());
      initEditState(result);
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setProgress(null);
      setLoading(false);
    }
  }, [path, initEditState]);

  const updateReputation = useCallback((factionId: string, rank: number) => {
    setEditReputations(prev => new Map(prev).set(factionId, rank));
  }, []);

  const applyEdits = useCallback(async () => {
    if (!data) return;
    const p = path.trim();
    const originalBps = new Set(data.blueprints);
    const blueprints_add    = [...pendingBlueprints].filter(w => !originalBps.has(w));
    const blueprints_remove = [...originalBps].filter(w => !pendingBlueprints.has(w));

    // Reputation edits: only send factions whose rank changed from original
    const origSums = new Map<string, number>();
    for (const r of data.reputations) {
      origSums.set(r.faction_id, (origSums.get(r.faction_id) ?? 0) + r.relation);
    }
    const reputation_edits: Array<{ faction_id: string; relation: number }> = [];
    for (const [fid, targetRank] of editReputations) {
      const origRank = repRank(origSums.get(fid) ?? 0);
      if (targetRank !== origRank) {
        reputation_edits.push({ faction_id: fid, relation: rankToWriteValue(targetRank, origRank) });
      }
    }

    const origNpcByCode = new Map(data.npcs.map(n => [n.code, n]));
    const npc_skills: Array<{
      code: string;
      piloting: number;
      management: number;
      morale: number;
      engineering: number;
      boarding: number;
    }> = [];
    for (const n of editNpcs) {
      const o = origNpcByCode.get(n.code);
      if (!o) continue;
      if (
        n.piloting !== o.piloting ||
        n.management !== o.management ||
        n.morale !== o.morale ||
        n.engineering !== o.engineering ||
        n.boarding !== o.boarding
      ) {
        npc_skills.push({
          code: n.code,
          piloting: Math.min(15, Math.max(0, Math.round(n.piloting))),
          management: Math.min(15, Math.max(0, Math.round(n.management))),
          morale: Math.min(15, Math.max(0, Math.round(n.morale))),
          engineering: Math.min(15, Math.max(0, Math.round(n.engineering))),
          boarding: Math.min(15, Math.max(0, Math.round(n.boarding))),
        });
      }
    }
    const station_cargo = [...editStationCargo.entries()].map(([station_code, wareMap]) => ({
      station_code,
      wares: [...wareMap.entries()].map(([ware, amount]) => ({ ware, amount })),
    }));
    if (station_cargo.length > 0) {
      for (const { station_code } of station_cargo) {
        const st = data.stations.find(s => s.code === station_code);
        if (!st?.storage_slots?.length) {
          setError(
            `Station « ${station_code} » : pas de modules stockage (storage_slots). Rechargez la sauvegarde avec cette version de l’éditeur.`
          );
          return;
        }
      }
    }
    const origShipNames = new Map(data.ships.map(s => [s.code, s.name ?? ""]));
    const ship_names = [...editShipNames.entries()]
      .filter(([code, name]) => name !== (origShipNames.get(code) ?? ""))
      .map(([code, name]) => ({ code, name }));

    const station_storage_layout =
      station_cargo.length === 0
        ? []
        : station_cargo.map(({ station_code }) => {
            const st = data.stations.find(s => s.code === station_code)!;
            return {
              station_code,
              slots: st.storage_slots.map(s => ({
                id: s.id,
                macro_id: s.macro_id,
                connection: s.connection,
              })),
            };
          });

    setSaving(true);
    setProgress(0);
    setSaveMsg("");
    setError("");
    const unlisten = await listen<{ pct: number }>("progress", e =>
      setProgress(e.payload.pct)
    );
    try {
      await invoke("apply_edits", {
        path: p,
        edits: {
          player_name: editName,
          money: editMoney,
          modified: editModified,
          inventory: editInventory,
          blueprints_add,
          blueprints_remove,
          research_unlock: [...pendingResearch].filter(id => !completedResearch.includes(id)),
          reputation_edits,
          npc_skills,
          ship_names,
          station_cargo,
          station_storage_layout,
        },
      });
      unlisten();
      setSaveMsg("Save written successfully.");
      setCompletedResearch(prev => [...new Set([...prev, ...pendingResearch])]);
      setPendingResearch(new Set());
      setProgress(0);
      const unlisten2 = await listen<{ pct: number }>("progress", e =>
        setProgress(e.payload.pct)
      );
      const reloaded = await invoke<PlayerBasics>("parse_save_basics", { path: p });
      unlisten2();
      setData(reloaded);
      initEditState(reloaded);
    } catch (e) {
      unlisten();
      setError(String(e));
    } finally {
      setProgress(null);
      setSaving(false);
    }
  }, [data, path, editName, editMoney, editModified, editInventory, pendingBlueprints, pendingResearch, completedResearch, editReputations, editNpcs, editShipNames, editStationCargo, initEditState]);

  const toggleBlueprint = useCallback((ware: string) => {
    setPendingBlueprints(prev => {
      const next = new Set(prev);
      if (next.has(ware)) next.delete(ware);
      else next.add(ware);
      return next;
    });
  }, []);

  const toggleBlueprintCategory = useCallback((wares: string[], setOwned: boolean) => {
    setPendingBlueprints(prev => {
      const next = new Set(prev);
      for (const ware of wares) {
        if (setOwned) next.add(ware);
        else next.delete(ware);
      }
      return next;
    });
  }, []);

  const updateWareAmount = useCallback((index: number, amount: number) => {
    setEditInventory(prev => {
      const next = [...prev];
      next[index] = { ...next[index], amount: Math.max(1, amount) };
      return next;
    });
  }, []);

  const updateNpcTrait = useCallback((code: string, key: NpcTraitKey, value: number) => {
    const v = Math.min(15, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
    setEditNpcs(prev => prev.map(n => (n.code === code ? { ...n, [key]: v } : n)));
  }, []);

  const updateShipName = useCallback((code: string, name: string) => {
    setEditShipNames(prev => new Map(prev).set(code, name));
  }, []);

  const updateStationWare = useCallback((stationCode: string, wareId: string, amount: number) => {
    setEditStationCargo(prev => {
      const next = new Map(prev);
      const wareMap = new Map(next.get(stationCode) ?? []);
      wareMap.set(wareId, amount);
      next.set(stationCode, wareMap);
      return next;
    });
  }, []);

  const addInventoryItem = useCallback((ware: string, amount: number) => {
    setEditInventory(prev => {
      const existing = prev.findIndex(i => i.ware === ware);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], amount: next[existing].amount + amount };
        return next;
      }
      return [...prev, { ware, amount }];
    });
  }, []);

  const toggleResearch = useCallback((id: string) => {
    setPendingResearch(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addResearchMaterials = useCallback((materials: { ware: string; amount: number }[]) => {
    setEditInventory(prev => {
      const next = [...prev];
      for (const mat of materials) {
        const idx = next.findIndex(i => i.ware === mat.ware);
        if (idx >= 0) next[idx] = { ...next[idx], amount: next[idx].amount + mat.amount };
        else next.push({ ware: mat.ware, amount: mat.amount });
      }
      return next;
    });
  }, []);

  const busy = loading || saving;

  return {
    path,
    setPath,
    data,
    error,
    saveMsg,
    loading,
    saving,
    progress,
    busy,
    editName,
    setEditName,
    editMoney,
    setEditMoney,
    editModified,
    setEditModified,
    editInventory,
    blueprintSearch,
    setBlueprintSearch,
    repSearch,
    setRepSearch,
    fleetSearch,
    setFleetSearch,
    employeeSearch,
    setEmployeeSearch,
    stationSearch,
    setStationSearch,
    inventorySearch,
    setInventorySearch,
    deployableSearch,
    setDeployableSearch,
    loadSave,
    applyEdits,
    closeFile,
    pickFile,
    updateWareAmount,
    addInventoryItem,
    pendingBlueprints,
    toggleBlueprint,
    toggleBlueprintCategory,
    editReputations,
    updateReputation,
    editNpcs,
    updateNpcTrait,
    editStationCargo,
    updateStationWare,
    editShipNames,
    updateShipName,
    completedResearch,
    pendingResearch,
    toggleResearch,
    addResearchMaterials,
  };
}
