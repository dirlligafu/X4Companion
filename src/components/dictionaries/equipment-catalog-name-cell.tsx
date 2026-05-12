/** Name + (NPC). Series lives in subgroup header (series mode) or detail footer. */
export function EquipmentCatalogNameCell({ name, playerUsable }: { name: string; playerUsable: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block truncate" title={name}>
        <span className="font-medium">{name}</span>
        {!playerUsable && <span className="ml-1 text-xs text-muted-foreground">(NPC)</span>}
      </span>
    </div>
  );
}
