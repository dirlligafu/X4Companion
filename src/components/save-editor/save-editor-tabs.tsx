import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { BlueprintInfo, EquipmentCatalog, InventoryCatalogItem, ModStat, ModuleCargoInfo, NpcInfo, PlayerBasics, WareCargoInfo } from "@/types/save";
import type { NpcTraitKey } from "@/hooks/useSaveEditor";
import { BlueprintsTab } from "./blueprints-tab";
import { EmployeesTab } from "./employees-tab";
import { FleetTab } from "./fleet-tab";
import { InventoryTab } from "./inventory-tab";
import { OverviewTab } from "./overview-tab";
import { ReputationsTab } from "./reputations-tab";
import { StationsTab } from "./stations-tab";
import { DeployablesTab } from "./deployables-tab";
import { MessagesTab } from "./messages-tab";
import { StatsTab } from "./stats-tab";
import { InjectTab } from "./inject-tab";
import type { SectorsCatalog } from "@/types/save";
import { PlayerMap } from "./player-map";

type SaveEditorTabsProps = {
  data: PlayerBasics;
  busy: boolean;
  editName: string;
  setEditName: (v: string) => void;
  editMoney: number;
  setEditMoney: (v: number) => void;
  editModified: boolean;
  setEditModified: (v: boolean) => void;
  editInventory: PlayerBasics["inventory"];
  updateWareAmount: (index: number, amount: number) => void;
  addInventoryItem: (ware: string, amount: number) => void;
  inventoryCatalog: InventoryCatalogItem[];
  wareLabels: Record<string, string>;
  wareCargoInfo: Record<string, WareCargoInfo>;
  moduleCargoIndex: Record<string, ModuleCargoInfo>;
  blueprintSearch: string;
  setBlueprintSearch: (v: string) => void;
  blueprintInfos: Record<string, BlueprintInfo>;
  pendingBlueprints: Set<string>;
  toggleBlueprint: (ware: string) => void;
  toggleBlueprintCategory: (wares: string[], setOwned: boolean) => void;
  repSearch: string;
  setRepSearch: (v: string) => void;
  factionNames: Record<string, string>;
  editReputations: Map<string, number>;
  updateReputation: (factionId: string, rank: number) => void;
  editNpcs: NpcInfo[];
  updateNpcTrait: (code: string, key: NpcTraitKey, value: number) => void;
  editStationCargo: Map<string, Map<string, number>>;
  updateStationWare: (stationCode: string, wareId: string, amount: number) => void;
  fleetSearch: string;
  setFleetSearch: (v: string) => void;
  editShipNames: Map<string, string>;
  updateShipName: (code: string, name: string) => void;
  shipLabels: Record<string, string>;
  sectorNames: Record<string, string>;
  employeeSearch: string;
  setEmployeeSearch: (v: string) => void;
  stationSearch: string;
  setStationSearch: (v: string) => void;
  inventorySearch: string;
  setInventorySearch: (v: string) => void;
  deployableSearch: string;
  setDeployableSearch: (v: string) => void;
  savePath: string;
  equipmentCatalog: EquipmentCatalog;
  modStats: ModStat[];
  sectorsCatalog: SectorsCatalog | null;
};

export function SaveEditorTabs(props: SaveEditorTabsProps) {
  const {
    data, busy,
    editName, setEditName,
    editMoney, setEditMoney,
    editModified, setEditModified,
    editInventory, updateWareAmount, addInventoryItem, inventoryCatalog,
    wareLabels, wareCargoInfo, moduleCargoIndex,
    blueprintSearch, setBlueprintSearch, blueprintInfos, pendingBlueprints, toggleBlueprint, toggleBlueprintCategory,
    repSearch, setRepSearch,     factionNames, editReputations, updateReputation,
    editNpcs, updateNpcTrait,
    editStationCargo, updateStationWare,
    fleetSearch, setFleetSearch, editShipNames, updateShipName, shipLabels, sectorNames,
    employeeSearch, setEmployeeSearch,
    stationSearch, setStationSearch,
    inventorySearch, setInventorySearch,
    deployableSearch, setDeployableSearch,
    savePath,
    equipmentCatalog,
    modStats,
    sectorsCatalog,
  } = props;

  const equipIndex = useMemo(() => {
    const idx: Record<string, string> = {};
    const cats = [equipmentCatalog.weapons, equipmentCatalog.engines, equipmentCatalog.shields, equipmentCatalog.thrusters];
    for (const cat of cats) {
      for (const item of cat) {
        idx[item.macro_id.replace(/_macro$/, "")] = item.name;
      }
    }
    return idx;
  }, [equipmentCatalog]);

  const modIndex = useMemo(() => {
    const idx: Record<string, { name: string | null; quality: number }> = {};
    for (const m of modStats) {
      if (!idx[m.ware]) idx[m.ware] = { name: m.name, quality: m.quality };
    }
    return idx;
  }, [modStats]);

  const [activeTab, setActiveTab] = useState("overview");
  const panelClass = "mt-4 flex min-h-0 flex-1 flex-col overflow-hidden";

  // Navigation croisée Fleet ↔ Employees ↔ Stations
  function goToEmployee(name: string) {
    setEmployeeSearch(name);
    setActiveTab("employees");
  }
  function goToShip(code: string) {
    setFleetSearch(code);
    setActiveTab("fleet");
  }
  function goToStation(code: string) {
    setStationSearch(code);
    setActiveTab("stations");
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn("w-full min-h-0 flex-1 overflow-hidden")}
    >
      <TabsList className="flex h-auto w-full shrink-0 flex-wrap justify-start gap-1 p-1 sm:flex-nowrap">
        <TabsTrigger value="overview" className="flex-1 min-w-22">Overview</TabsTrigger>
        <TabsTrigger value="map" className="flex-1 min-w-22">Map</TabsTrigger>
        <TabsTrigger value="inventory" className="flex-1 min-w-22">
          Inventory
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{editInventory.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="blueprints" className="flex-1 min-w-22">
          Blueprints
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{data.blueprints.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="reputations" className="flex-1 min-w-22">Reputations</TabsTrigger>
        <TabsTrigger value="fleet" className="flex-1 min-w-22">
          Fleet
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{data.ships.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="employees" className="flex-1 min-w-22">
          Employees
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{data.npcs.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="stations" className="flex-1 min-w-22">
          Stations
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{data.stations.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="deployables" className="flex-1 min-w-22">
          Deployables
          <Badge variant="secondary" className="ml-1.5 tabular-nums">{data.deployables.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="stats" className="flex-1 min-w-22">Stats</TabsTrigger>
        <TabsTrigger value="messages" className="flex-1 min-w-22">Messages</TabsTrigger>
        <TabsTrigger value="inject" className="flex-1 min-w-22">Inject</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className={cn(panelClass)}>
        <OverviewTab data={data} busy={busy}
          editName={editName} setEditName={setEditName}
          editMoney={editMoney} setEditMoney={setEditMoney}
          editModified={editModified} setEditModified={setEditModified} />
      </TabsContent>

      <TabsContent value="map" className={cn(panelClass)}>
        {sectorsCatalog ? (
          <PlayerMap
            catalog={sectorsCatalog}
            knownSectors={data.known_sectors}
            knownClusters={data.known_clusters}
            sectorOwners={data.sector_owners}
            clusterOwners={data.cluster_owners}
            ships={data.ships}
            shipLabels={shipLabels}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading map data…</p>
        )}
      </TabsContent>

      <TabsContent value="inventory" className={cn(panelClass)}>
        <InventoryTab
          editInventory={editInventory}
          wareLabels={wareLabels}
          busy={busy}
          onUpdateWareAmount={updateWareAmount}
          onAddItem={addInventoryItem}
          inventoryCatalog={inventoryCatalog}
          inventorySearch={inventorySearch}
          setInventorySearch={setInventorySearch}
        />
      </TabsContent>

      <TabsContent value="blueprints" className={cn(panelClass)}>
        <BlueprintsTab data={data} blueprintSearch={blueprintSearch}
          setBlueprintSearch={setBlueprintSearch} blueprintInfos={blueprintInfos}
          pendingBlueprints={pendingBlueprints} toggleBlueprint={toggleBlueprint}
          toggleBlueprintCategory={toggleBlueprintCategory} />
      </TabsContent>

      <TabsContent value="reputations" className={cn(panelClass)}>
        <ReputationsTab data={data} repSearch={repSearch}
          setRepSearch={setRepSearch} factionNames={factionNames}
          editReputations={editReputations} updateReputation={updateReputation}
          busy={busy} />
      </TabsContent>

      <TabsContent value="fleet" className={cn(panelClass)}>
        <FleetTab
          data={data}
          fleetSearch={fleetSearch}
          setFleetSearch={setFleetSearch}
          editShipNames={editShipNames}
          updateShipName={updateShipName}
          shipLabels={shipLabels}
          sectorNames={sectorNames}
          savePath={savePath}
          onSelectEmployee={goToEmployee}
          equipIndex={equipIndex}
          equipmentCatalog={equipmentCatalog}
          modIndex={modIndex}
        />
      </TabsContent>

      <TabsContent value="employees" className={cn(panelClass)}>
        <EmployeesTab
          data={data}
          editNpcs={editNpcs}
          busy={busy}
          updateNpcTrait={updateNpcTrait}
          employeeSearch={employeeSearch}
          setEmployeeSearch={setEmployeeSearch}
          shipLabels={shipLabels}
          onSelectShip={goToShip}
          onSelectStation={goToStation}
        />
      </TabsContent>

      <TabsContent value="stations" className={cn(panelClass)}>
        <StationsTab data={data} stationSearch={stationSearch}
          setStationSearch={setStationSearch} sectorNames={sectorNames}
          wareLabels={wareLabels} wareCargoInfo={wareCargoInfo}
          moduleCargoIndex={moduleCargoIndex}
          editStationCargo={editStationCargo}
          updateStationWare={updateStationWare}
          onSelectEmployee={goToEmployee} />
      </TabsContent>

      <TabsContent value="deployables" className={cn(panelClass)}>
        <DeployablesTab data={data} deployableSearch={deployableSearch}
          setDeployableSearch={setDeployableSearch} sectorNames={sectorNames} />
      </TabsContent>

      <TabsContent value="stats" className={cn(panelClass)}>
        <StatsTab path={savePath} />
      </TabsContent>

      <TabsContent value="messages" className={cn(panelClass)}>
        <MessagesTab path={savePath} />
      </TabsContent>

      <TabsContent value="inject" className={cn(panelClass)}>
        <InjectTab savePath={savePath} />
      </TabsContent>

    </Tabs>
  );
}
