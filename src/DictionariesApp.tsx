import { Component, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/hooks/useTheme";
import { ShipsBrowser } from "@/components/dictionaries/ships-browser";
import type { ShipCatalogItem } from "@/types/save";

// ── Error boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-destructive font-mono text-sm whitespace-pre-wrap">
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export function DictionariesApp() {
  useTheme();

  const [ships, setShips]     = useState<ShipCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    invoke<ShipCatalogItem[]>("get_ships_catalog")
      .then(setShips)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground flex flex-col p-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dictionaries</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Game reference data — read only</p>
        </div>

        <Tabs defaultValue="ships" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsList className="shrink-0 w-fit">
            <TabsTrigger value="ships">
              Ships
              {ships.length > 0 && (
                <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-secondary-foreground">
                  {ships.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ships" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
            {loading && (
              <p className="text-sm text-muted-foreground">Loading ships catalog…</p>
            )}
            {error && (
              <p className="text-sm text-destructive font-mono whitespace-pre-wrap">{error}</p>
            )}
            {!loading && !error && <ShipsBrowser ships={ships} />}
          </TabsContent>
        </Tabs>
      </div>
    </ErrorBoundary>
  );
}
