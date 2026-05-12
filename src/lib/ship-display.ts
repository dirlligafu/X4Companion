/** shield_ter_s_standard_01_mk2 → "Std Mk2" ; extrait type + niveau */
export function equipLabel(macro: string): string {
  const parts = macro.split("_");
  const mkIdx = parts.findIndex(p => /^mk\d+$/.test(p));
  const type = parts[3] ?? "";
  const mk = mkIdx >= 0 ? parts[mkIdx].replace("mk", "Mk") : "";
  return [type, mk].filter(Boolean).join(" ");
}

/** Groupe les macros par label et retourne "Nx label" */
export function groupEquip(macros: string[]): string {
  if (macros.length === 0) return "—";
  const counts = new Map<string, number>();
  for (const m of macros) {
    const lbl = equipLabel(m);
    counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([lbl, n]) => `${n}× ${lbl}`)
    .join(", ");
}

const SOFTWARE_LABELS: Record<string, string> = {
  software_dockmk1: "Docking Mk1",
  software_dockmk2: "Docking Mk2",
  software_dockmk3: "Docking Mk3",
  software_scannerlongrangemk1: "LR Scanner Mk1",
  software_scannerlongrangemk2: "LR Scanner Mk2",
  software_scannerlongrangemk3: "LR Scanner Mk3",
  software_scannerobjectmk1: "Object Scanner Mk1",
  software_scannerobjectmk2: "Object Scanner Mk2",
  software_scannerobjectmk3: "Object Scanner Mk3",
  software_trademk1: "Trade Mk1",
  software_trademk2: "Trade Mk2",
  software_trademk3: "Trade Mk3",
  software_targetmk1: "Targeting Mk1",
  software_targetmk2: "Targeting Mk2",
  software_targetmk3: "Targeting Mk3",
  software_masstraffic: "Mass Traffic",
  software_firecontrol: "Fire Control",
};

export function softwareLabel(s: string): string {
  return SOFTWARE_LABELS[s] ?? s.replace(/^software_/, "").replace(/mk(\d)/, " Mk$1");
}
