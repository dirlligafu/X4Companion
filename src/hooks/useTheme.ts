import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "x4-editor-theme";

export type ThemeMode = "light" | "dark";

function readStored(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyDom(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStored());

  useEffect(() => {
    applyDom(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      setThemeState(e.newValue === "light" ? "light" : "dark");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(t => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggleTheme };
}
