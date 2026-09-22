import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "run-coach:theme";
/** Long enough to read as a crossfade, short enough not to feel like a wait.
 *  Must stay in step with the .theme-transition rule in index.css. */
const CROSSFADE_MS = 280;

function stored(): Theme | null {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : localStorage.getItem(KEY) === "dark" ? "dark" : null;
  } catch {
    return null;
  }
}

/** The theme currently painted, which index.html set before React booted. */
function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Reads and writes the theme on <html data-theme>, and crossfades the switch.
 *
 * The transition is a class added to <html> for the length of the switch only:
 * leaving it on would make every hover and every data update in the app fade,
 * and would animate the very first paint.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);

  // A second tab switching the theme should not leave this one out of step.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const next = stored() ?? "dark";
      document.documentElement.dataset.theme = next === "light" ? "light" : "";
      setTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    const root = document.documentElement;

    root.classList.add("theme-transition");
    if (next === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    setTheme(next);

    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the choice just will not survive a reload */
    }

    window.setTimeout(() => root.classList.remove("theme-transition"), CROSSFADE_MS);
  }, []);

  return { theme, toggle };
}
