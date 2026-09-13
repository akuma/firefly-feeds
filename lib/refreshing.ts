import type { ArticleRecord, SourceRecord } from "./storage/types";
import type { Block, ContentState, StoryLayout } from "./types";

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

/** One normalised item as the feed route hands it to the client. */
export type IncomingItem = {
  id: string;
  title: string;
  link?: string;
  author?: string;
  publishedMs?: number;
  summary: string;
  body: Block[];
  image?: string;
  minutes: number;
  layout: StoryLayout;
  contentState: ContentState;
};

/**
 * Turn a freshly fetched feed into article records, reconciling them with what
 * is already cached so an unchanged feed changes nothing visible:\ ids stay
 * stable, order stays put, and a body the reader fetched on demand is never
 * thrown back to the feed's summary (which would re-trigger extraction and
 * flash the article pane on every refresh).
 */
export function reconcileArticles(
  sourceId: string,
  incoming: readonly IncomingItem[],
  existing: readonly ArticleRecord[],
  at: number,
): ArticleRecord[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  // Bridges the id scheme across the old position-seeded hash: a record that
  // already owns this link keeps its id, so read/saved state is not orphaned.
  const byLink = new Map(existing.filter((a) => a.link).map((a) => [a.link!, a]));

  return incoming.map((item) => {
    const preferredId = `${sourceId}~${item.id}`;
    const bridged = item.link ? byLink.get(item.link) : undefined;
    const recordId = bridged && !byId.has(preferredId) ? bridged.id : preferredId;
    const prev = byId.get(recordId);

    // A locally enriched copy is authoritative for the body: "success" keeps
    // the extracted full text, and "failed" must not be asked again just
    // because the feed was refreshed — unless the publisher now ships the full
    // piece in the feed itself.
    if (prev && prev.extractionState !== "idle") {
      if (prev.extractionState === "success" || item.contentState !== "full") {
        return { ...prev, fetchedAt: at };
      }
    }

    return {
      id: recordId,
      sourceId,
      title: item.title,
      link: item.link,
      author: item.author,
      // A dateless entry used to inherit the fetch timestamp, so it jumped
      // towards the top on every refresh. Its first-seen time is the stable
      // answer.
      publishedAt: item.publishedMs ?? prev?.publishedAt ?? at,
      fetchedAt: at,
      summary: item.summary,
      body: item.body,
      image: item.image,
      minutes: item.minutes,
      layout: item.layout,
      contentState: item.contentState,
      extractionState: "idle",
    };
  });
}
