import { useCallback, useSyncExternalStore } from "react";
import { useMediaQuery } from "./media.ts";

/** The desktop sidebar's state, as someone last chose it. Unset until they first toggle it. */
export type SidebarChoice = "expanded" | "collapsed";

const STORAGE_KEY = "runyard.sidebar";
const listeners = new Set<() => void>();

/**
 * From 1536px (Tailwind's `2xl:`) the sidebar starts expanded. Below that it starts collapsed, so
 * the Board's departure board keeps room for its split-flap columns on a laptop.
 */
export const SIDEBAR_WIDE = "(min-width: 96rem)";

export function parseSidebar(raw: string | null): SidebarChoice | null {
  return raw === "expanded" || raw === "collapsed" ? raw : null;
}

/** Whether the sidebar is collapsed: the saved choice if there is one, else by the window's width. */
export function isCollapsed(choice: SidebarChoice | null, wide: boolean): boolean {
  return choice ? choice === "collapsed" : !wide;
}

function read(): SidebarChoice | null {
  try {
    return parseSidebar(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

let current = read();

export function setSidebarChoice(choice: SidebarChoice) {
  current = choice;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Non-essential: the choice lasts for this page load.
  }
  listeners.forEach((l) => l());
}

/** Whether the desktop sidebar is collapsed, and a toggle that remembers the choice. */
export function useSidebar(): [collapsed: boolean, toggle: () => void] {
  const choice = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const wide = useMediaQuery(SIDEBAR_WIDE);
  const collapsed = isCollapsed(choice, wide);
  const toggle = useCallback(
    () => setSidebarChoice(collapsed ? "expanded" : "collapsed"),
    [collapsed],
  );
  return [collapsed, toggle];
}
