import { useState } from "react";
import { useGameResources } from "@/hooks/useGameResources";
import { usePreferences } from "@/hooks/usePreferences";
import { useSaveEditor } from "@/hooks/useSaveEditor";
import { AppHeader } from "@/components/save-editor/app-header";
import { ApplyEditsBar } from "@/components/save-editor/apply-edits-bar";
import { FeedbackMessages } from "@/components/save-editor/feedback-messages";
import { FilePickerCard } from "@/components/save-editor/file-picker-card";
import { SaveEditorTabs } from "@/components/save-editor/save-editor-tabs";
import { DictionariesView } from "@/components/dictionaries/dictionaries-view";
import { MapView } from "@/components/map/map-view";
import { FittingMockup } from "@/components/fitting/fitting-mockup";
import { ShipComparator } from "@/components/fitting/ship-comparator";

type AppView = "editor" | "dictionaries" | "map" | "fitting" | "compare";

export default function App() {
  const { moduleCargoIndex, wareCargoInfo, wareLabels, blueprintInfos, factionNames, shipLabels, sectorNames, inventoryCatalog, shipsCatalog, equipmentCatalog, modStats, modRecipes, sectorsCatalog } = useGameResources();
  const prefs = usePreferences();
  const editor = useSaveEditor(prefs.defaultSaveDir);

  const [view, setView] = useState<AppView>("editor");

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100vw,1920px)] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-10">
        <div className="shrink-0">
          <AppHeader
            path={editor.path}
            hasData={!!editor.data}
            view={view}
            onSetView={setView}
            defaultSaveDir={prefs.defaultSaveDir}
            settingsOpen={prefs.settingsOpen}
            setSettingsOpen={prefs.setSettingsOpen}
            settingsDraft={prefs.settingsDraft}
            setSettingsDraft={prefs.setSettingsDraft}
            pickSettingsDir={prefs.pickSettingsDir}
            saveSettings={prefs.saveSettings}
          />
        </div>

        {view === "dictionaries" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DictionariesView shipsCatalog={shipsCatalog} equipmentCatalog={equipmentCatalog} modStats={modStats} modRecipes={modRecipes} />
          </div>
        ) : view === "map" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sectorsCatalog
              ? <MapView catalog={sectorsCatalog} />
              : <p className="text-sm text-muted-foreground">Loading map data…</p>
            }
          </div>
        ) : view === "fitting" ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {shipsCatalog.length === 0
              ? <p className="text-sm text-muted-foreground">Loading catalog…</p>
              : <FittingMockup ships={shipsCatalog} equipment={equipmentCatalog} />
            }
          </div>
        ) : view === "compare" ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {shipsCatalog.length === 0
              ? <p className="text-sm text-muted-foreground">Loading catalog…</p>
              : <ShipComparator ships={shipsCatalog} equipment={equipmentCatalog} />
            }
          </div>
        ) : (
          <>
            <div className="shrink-0">
              <FilePickerCard
                path={editor.path}
                setPath={editor.setPath}
                busy={editor.busy}
                loading={editor.loading}
                progress={editor.progress}
                hasData={!!editor.data}
                onPickFile={editor.pickFile}
                onLoad={editor.loadSave}
                onCloseFile={editor.closeFile}
              />
            </div>

            <div className="shrink-0">
              <FeedbackMessages error={editor.error} saveMsg={editor.saveMsg} />
            </div>

            {!editor.data && (
              <div className="flex flex-1 min-h-0 items-center justify-center">
                <img
                  src="/x4-logo.png"
                  alt="X4: Foundations"
                  style={{ maxWidth: "min(520px, 100%)", maxHeight: "min(520px, 100%)" }}
                  className="opacity-60"
                />
              </div>
            )}

            {editor.data && (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <SaveEditorTabs
                  data={editor.data}
                  busy={editor.busy}
                  editName={editor.editName}
                  setEditName={editor.setEditName}
                  editMoney={editor.editMoney}
                  setEditMoney={editor.setEditMoney}
                  editModified={editor.editModified}
                  setEditModified={editor.setEditModified}
                  editInventory={editor.editInventory}
                  updateWareAmount={editor.updateWareAmount}
                  addInventoryItem={editor.addInventoryItem}
                  inventoryCatalog={inventoryCatalog}
                  wareLabels={wareLabels}
                  wareCargoInfo={wareCargoInfo}
                  moduleCargoIndex={moduleCargoIndex}
                  blueprintSearch={editor.blueprintSearch}
                  setBlueprintSearch={editor.setBlueprintSearch}
                  blueprintInfos={blueprintInfos}
                  pendingBlueprints={editor.pendingBlueprints}
                  toggleBlueprint={editor.toggleBlueprint}
                  toggleBlueprintCategory={editor.toggleBlueprintCategory}
                  repSearch={editor.repSearch}
                  setRepSearch={editor.setRepSearch}
                  factionNames={factionNames}
                  editReputations={editor.editReputations}
                  updateReputation={editor.updateReputation}
                  editNpcs={editor.editNpcs}
                  updateNpcTrait={editor.updateNpcTrait}
                  editStationCargo={editor.editStationCargo}
                  updateStationWare={editor.updateStationWare}
                  fleetSearch={editor.fleetSearch}
                  setFleetSearch={editor.setFleetSearch}
                  editShipNames={editor.editShipNames}
                  updateShipName={editor.updateShipName}
                  shipLabels={shipLabels}
                  sectorNames={sectorNames}
                  employeeSearch={editor.employeeSearch}
                  setEmployeeSearch={editor.setEmployeeSearch}
                  stationSearch={editor.stationSearch}
                  setStationSearch={editor.setStationSearch}
                  inventorySearch={editor.inventorySearch}
                  setInventorySearch={editor.setInventorySearch}
                  deployableSearch={editor.deployableSearch}
                  setDeployableSearch={editor.setDeployableSearch}
                  savePath={editor.path}
                  equipmentCatalog={equipmentCatalog}
                  modStats={modStats}
                  modRecipes={modRecipes}
                  sectorsCatalog={sectorsCatalog}
                />
                <div className="shrink-0">
                  <ApplyEditsBar
                    busy={editor.busy}
                    saving={editor.saving}
                    onApply={editor.applyEdits}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
