import type { SourceRecord } from "./storage/types";

/**
 * How long a cached feed stands in before it is considered stale. The reader
 * is a local app with no server pushing updates, so opening it must not show
 * yesterday's edition as if it were current.
 */
export const STALE_MS = 30 * 60_000;

/**
 * Sources whose last successful (or attempted) fetch is older than the staleness
 * window, oldest first. Refreshing in that order empties the stalest copy first.
 */
export function staleSourceIds(sources: readonly SourceRecord[], now: number): string[] {
  return sources
    .filter((s) => !s.deletedAt && now - s.fetchedAt >= STALE_MS)
    .toSorted((a, b) => a.fetchedAt - b.fetchedAt)
    .map((s) => s.id);
}
