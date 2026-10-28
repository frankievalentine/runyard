import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "runyard.theme";
const listeners = new Set<() => void>();

export function parseTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" ? raw : "system";
}

function read(): Theme {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

let current = read();

/** Reflects the theme on <html>; "system" leaves the OS preference in charge. */
export function applyTheme(theme: Theme = current) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-essential: the choice lasts for this page load.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
