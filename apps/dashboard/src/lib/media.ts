import { useSyncExternalStore } from "react";

/** Whether a media query matches, following changes such as a window resized past it. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** From 1800px, Tailwind's `3xl:`: the Board and Settings gain a third column. */
export const EXTRA_WIDE = "(min-width: 112.5rem)";
