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

export type Prefs = {
  theme?: "light" | "dark";
  font?: number;
  navOpen?: boolean;
  view?: ViewId;
  /**
   * Article classification is off until the reader turns it on: it is the one
   * part of the app that sends any of the reader's data off the device.
   */
  classify?: boolean;
  /**
   * An optional personal Jev key. The shared default lives as a server secret;
   * a key kept here overrides it for this browser alone, and is sent to our own
   * `/api/classify` — never to Jev directly, and never written server-side.
   */
  jevKey?: string;
};

export function loadPrefs(): Prefs {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREFS_KEY);
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
