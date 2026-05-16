import { repRank, rankToWriteValue } from "@/lib/reputation";
import type { FactionRep, NpcInfo, ShipInfo } from "@/types/save";

export function computeBlueprintDiff(
  original: string[],
  pending: Set<string>
): { add: string[]; remove: string[] } {
  const originalSet = new Set(original);
  return {
    add:    [...pending].filter(w => !originalSet.has(w)),
    remove: [...originalSet].filter(w => !pending.has(w)),
  };
}

export function computeReputationDiff(
  original: FactionRep[],
  edits: Map<string, number>
): Array<{ faction_id: string; relation: number }> {
  const origSums = new Map<string, number>();
  for (const r of original) {
    origSums.set(r.faction_id, (origSums.get(r.faction_id) ?? 0) + r.relation);
  }
  const result: Array<{ faction_id: string; relation: number }> = [];
  for (const [fid, targetRank] of edits) {
    const origRank = repRank(origSums.get(fid) ?? 0);
    if (targetRank !== origRank) {
      result.push({ faction_id: fid, relation: rankToWriteValue(targetRank, origRank) });
    }
  }
  return result;
}

export function computeNpcDiff(
  original: NpcInfo[],
  edits: NpcInfo[]
): Array<{ code: string; piloting: number; management: number; morale: number; engineering: number; boarding: number }> {
  const origByCode = new Map(original.map(n => [n.code, n]));
  return edits
    .filter(n => {
      const o = origByCode.get(n.code);
      return o != null && (
        n.piloting    !== o.piloting    ||
        n.management  !== o.management  ||
        n.morale      !== o.morale      ||
        n.engineering !== o.engineering ||
        n.boarding    !== o.boarding
      );
    })
    .map(({ code, piloting, management, morale, engineering, boarding }) =>
      ({ code, piloting, management, morale, engineering, boarding })
    );
}

export function computeShipNameDiff(
  original: ShipInfo[],
  edits: Map<string, string>
): Array<{ code: string; name: string }> {
  const origNames = new Map(original.map(s => [s.code, s.name ?? ""]));
  return [...edits.entries()]
    .filter(([code, name]) => name !== (origNames.get(code) ?? ""))
    .map(([code, name]) => ({ code, name }));
}
