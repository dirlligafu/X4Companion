export const FLEET_SIZE_ORDER: Record<string, number> = {
  xl: 0,
  l: 1,
  m: 2,
  s: 3,
};

export function shipSizeBadgeClass(size: string): string {
  const map: Record<string, string> = {
    xl: "bg-red-100 text-red-900 border-red-300/90 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
    l: "bg-orange-100 text-orange-900 border-orange-300/90 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800",
    m: "bg-blue-100 text-blue-900 border-blue-300/90 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
    s: "bg-muted text-muted-foreground border-border",
  };
  return map[size] ?? "bg-muted text-muted-foreground border-border";
}
