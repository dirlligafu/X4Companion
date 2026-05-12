import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useState } from "react";

export function usePreferences() {
  const [defaultSaveDir, setDefaultSaveDir] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState("");

  useEffect(() => {
    load("preferences.json", { autoSave: true, defaults: {} }).then(store => {
      store.get<string>("default_save_dir").then(v => {
        if (v) setDefaultSaveDir(v);
      });
    });
  }, []);

  const pickSettingsDir = useCallback(async () => {
    const selected = await open({
      directory: true,
      defaultPath: settingsDraft || undefined,
    });
    if (typeof selected === "string") setSettingsDraft(selected);
  }, [settingsDraft]);

  const saveSettings = useCallback(async () => {
    const store = await load("preferences.json", { autoSave: true, defaults: {} });
    await store.set("default_save_dir", settingsDraft);
    setDefaultSaveDir(settingsDraft);
    setSettingsOpen(false);
  }, [settingsDraft]);

  return {
    defaultSaveDir,
    settingsOpen,
    setSettingsOpen,
    settingsDraft,
    setSettingsDraft,
    pickSettingsDir,
    saveSettings,
  };
}
