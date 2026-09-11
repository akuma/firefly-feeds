import type { ViewId } from "../types";

/**
 * The one thing that cannot live in IndexedDB.
 *
 * The colour scheme is needed *before first paint*, by an inline script in
 * `<head>`, and IndexedDB is asynchronous — reading it there would produce a
 * flash of the wrong theme on every load. So this stays in localStorage, where
 * a synchronous read is possible, and it is deliberately tiny: a handful of
 * scalars, never article content.
 */

export const PREFS_KEY = "firefly.feeds.v1";

/**
 * The pre-rename key. Read as a fallback, and carried across by the store
 * migration; never written.
 */
const LEGACY_PREFS_KEY = "firefly.reader.v1";

export type Prefs = {
  theme?: "light" | "dark";
  font?: number;
  navOpen?: boolean;
  view?: ViewId;
};

export function loadPrefs(): Prefs {
  if (typeof localStorage === "undefined") return {};
  try {
    // the old key also holds the v0 read/saved/later buckets, which parse
    // harmlessly as extra fields we do not read
    const raw = localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: Prefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota or private mode — the session still works */
  }
}
