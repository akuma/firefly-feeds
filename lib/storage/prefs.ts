import type { ClassifyConfig } from "../classify";
import type { LlmConfig } from "../llm";
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
   * The reader's classifier configuration: which decision API classifies new
   * stories, and the address, account and key it needs. It is kept on this
   * device only — the commercial APIs take a key, and it is sent to this app's
   * own `/api/classify` rather than to the API itself.
   */
  classifyConfig?: ClassifyConfig;
  /**
   * Today's briefing is off until the reader turns it on, for the same reason
   * classification is: it is the other part of the app that sends any of the
   * reader's data off the device.
   */
  digest?: boolean;
  /**
   * Which model writes the briefing, and the key for it. Same rule as the
   * classifier's: this device only, sent to this app's own endpoint.
   */
  llmConfig?: LlmConfig;
  /** The language the edition is written in — a `DigestLanguageId`. */
  digestLanguage?: string;
  /**
   * Manual rewrites used today, so the daily cap survives a reload. A scalar
   * with a date beside it, which is exactly the size of thing prefs exist for.
   */
  digestRuns?: { day: string; count: number };
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
