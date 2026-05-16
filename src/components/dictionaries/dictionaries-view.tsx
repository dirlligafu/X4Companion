import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShipsBrowser }     from "./ships-browser";
import { WeaponsBrowser }   from "./weapons-browser";
import { TurretsBrowser }   from "./turrets-browser";
import { EnginesBrowser }   from "./engines-browser";
import { ShieldsBrowser }   from "./shields-browser";
import { ThrustersBrowser } from "./thrusters-browser";
import { ModsBrowser }     from "./mods-browser";
import { useShipsCatalog }     from "@/hooks/useShipsCatalog";
import { useEquipmentCatalog } from "@/hooks/useEquipmentCatalog";
import type { ModRecipesData, ModStat } from "@/types/save";

type Props = {
  modStats:   ModStat[];
  modRecipes: ModRecipesData | null;
};

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-secondary-foreground">
      {count}
    </span>
  );
}

export function DictionariesView({ modStats, modRecipes }: Props) {
  const shipsCatalog    = useShipsCatalog();
  const equipmentCatalog = useEquipmentCatalog();
  const { weapons, engines, shields, thrusters } = equipmentCatalog;

  const fixedWeapons = useMemo(
    () => weapons.filter(w => !w.is_turret),
    [weapons],
  );
  const turretWeapons = useMemo(
    () => weapons.filter(w => w.is_turret),
    [weapons],
  );

  const shipsCount   = useMemo(() => shipsCatalog.filter(s => s.size !== "xs").length, [shipsCatalog]);
  const weaponsCount = useMemo(() => fixedWeapons.filter(w => w.size !== "xs").length, [fixedWeapons]);
  const enginesCount = useMemo(() => engines.filter(e => e.size !== "xs").length, [engines]);

  return (
    <Tabs defaultValue="ships" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TabsList className="shrink-0 w-fit">
        <TabsTrigger value="ships">
          Ships <CountBadge count={shipsCount} />
        </TabsTrigger>
        <TabsTrigger value="weapons">
          Weapons <CountBadge count={weaponsCount} />
        </TabsTrigger>
        <TabsTrigger value="turrets">
          Turrets <CountBadge count={turretWeapons.length} />
        </TabsTrigger>
        <TabsTrigger value="engines">
          Engines <CountBadge count={enginesCount} />
        </TabsTrigger>
        <TabsTrigger value="shields">
          Shields <CountBadge count={shields.length} />
        </TabsTrigger>
        <TabsTrigger value="thrusters">
          Thrusters <CountBadge count={thrusters.length} />
        </TabsTrigger>
        <TabsTrigger value="mods">
          Mods <CountBadge count={modStats.length} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ships" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {shipsCatalog.length === 0
          ? <p className="text-sm text-muted-foreground">Loading ships catalog…</p>
          : <ShipsBrowser ships={shipsCatalog} />
        }
      </TabsContent>

      <TabsContent value="weapons" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {weapons.length === 0
          ? <p className="text-sm text-muted-foreground">Loading weapons catalog…</p>
          : <WeaponsBrowser weapons={fixedWeapons} />
        }
      </TabsContent>

      <TabsContent value="turrets" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {weapons.length === 0
          ? <p className="text-sm text-muted-foreground">Loading weapons catalog…</p>
          : turretWeapons.length === 0
            ? <p className="text-sm text-muted-foreground">No turrets in this catalog build.</p>
            : <TurretsBrowser turrets={turretWeapons} />
        }
      </TabsContent>

      <TabsContent value="engines" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {engines.length === 0
          ? <p className="text-sm text-muted-foreground">Loading engines catalog…</p>
          : <EnginesBrowser engines={engines} />
        }
      </TabsContent>

      <TabsContent value="shields" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {shields.length === 0
          ? <p className="text-sm text-muted-foreground">Loading shields catalog…</p>
          : <ShieldsBrowser shields={shields} />
        }
      </TabsContent>

      <TabsContent value="thrusters" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {thrusters.length === 0
          ? <p className="text-sm text-muted-foreground">Loading thrusters catalog…</p>
          : <ThrustersBrowser thrusters={thrusters} />
        }
      </TabsContent>

      <TabsContent value="mods" className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {modStats.length === 0
          ? <p className="text-sm text-muted-foreground">Loading mods catalog…</p>
          : <ModsBrowser mods={modStats} modRecipes={modRecipes} />
        }
      </TabsContent>
    </Tabs>
  );
}
