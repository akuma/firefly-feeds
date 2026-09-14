import type { ArticleRecord, SourceRecord } from "./storage/types";
import type { Block, ContentState, StoryLayout } from "./types";

/**
 * How long a cached feed stands in before it is considered stale. The reader
 * is a local app with no server pushing updates, so opening it must not show
 * yesterday's edition as if it were current.
 */
export const STALE_MS = 30 * 60_000;

/**
 * How long an extracted original body stands before it is revalidated.
 * Source refresh and article refresh are different lifecycles: this one tracks
 * whether the page the reader is looking at has changed, not whether the feed
 * has new entries. A fixed first value, deliberately not adaptive.
 */
export const ARTICLE_STALE_MS = 6 * 60 * 60_000;

/**
 * How long a failed extraction waits before it may be tried again. A failure
 * is often a timeout or a temporary CDN problem, so it must not lock the
 * original page out forever — it only needs to stop the retry storm.
 */
export const EXTRACTION_RETRY_MS = 12 * 60 * 60_000;

/**
 * Whether opening this article should touch the network.
 *
 * Without an article URL there is nothing to fetch and the feed body is
 * canonical. With one: a never-fetched page is fetched on open, a fresh cached
 * page is not touched, a stale one is revalidated, and a recent failure waits
 * out the retry window.
 */
export function needsArticleRefresh(record: ArticleRecord, now: number): boolean {
  if (!record.link) return false;
  const checkedAt = record.contentCheckedAt ?? 0;
  if (record.contentFetchedAt) return now - checkedAt >= ARTICLE_STALE_MS;
  if (record.extractionState === "failed") return now - checkedAt >= EXTRACTION_RETRY_MS;
  return true;
}

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

  return incoming.map((item) => {
    const recordId = `${sourceId}~${item.id}`;
    const prev = byId.get(recordId);

    // Once an original page has been fetched it is the authoritative body, so
    // a source refresh may update the fallback metadata but must not throw the
    // extracted text away (which would also re-trigger extraction and flash
    // the article pane). Legacy records saved before the freshness fields
    // existed carry `extractionState: "success"` and are preserved too.
    if (prev && (prev.contentFetchedAt || prev.extractionState === "success")) {
      return {
        ...prev,
        link: item.link ?? prev.link,
        summary: item.summary || prev.summary,
        fetchedAt: at,
      };
    }

    // A failure is remembered so the retry window can throttle it — unless the
    // feed now ships the full piece itself, in which case the failure notice
    // would contradict the body that is already there.
    const failureSurvives = prev?.extractionState === "failed" && item.contentState !== "full";
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
      extractionState: failureSurvives ? "failed" : "idle",
      contentCheckedAt: failureSurvives ? prev?.contentCheckedAt : undefined,
    };
  });
}

/**
 * Whether a refresh changed anything worth persisting. `fetchedAt` is
 * deliberately ignored: it moves on every fetch, and treating it as content
 * would make every unchanged refresh a write plus a list re-render. When this
 * is true the caller can leave the cached articles and the in-memory list
 * untouched.
 */
export function articlesUnchanged(
  existing: readonly ArticleRecord[],
  next: readonly ArticleRecord[],
): boolean {
  if (existing.length !== next.length) return false;
  const byId = new Map(existing.map((a) => [a.id, a]));
  return next.every((candidate) => {
    const prev = byId.get(candidate.id);
    return prev !== undefined && sameRecord(prev, candidate);
  });
}

function sameRecord(prev: ArticleRecord, next: ArticleRecord): boolean {
  const keys = Object.keys(next) as (keyof ArticleRecord)[];
  return keys.every((key) => {
    if (key === "fetchedAt") return true;
    const a = prev[key];
    const b = next[key];
    if (key !== "body") return a === b;
    // blocks are fresh objects on every fetch even when the text is the same,
    // so compare their contents rather than their references. Blocks come in
    // several shapes (paragraph, list, figure), so compare every field — a
    // paragraph only carries text, but a figure also carries src and seed.
    const pa = a as ArticleRecord["body"];
    const pb = b as ArticleRecord["body"];
    if (!Array.isArray(pa) || pa.length !== pb.length) return false;
    return pb.every((block, i) => {
      const prevBlock = pa[i];
      if (!prevBlock || prevBlock.kind !== block.kind) return false;
      const fields = new Set([...Object.keys(prevBlock), ...Object.keys(block)]);
      return [...fields].every((field) => {
        const left = (prevBlock as Record<string, unknown>)[field];
        const right = (block as Record<string, unknown>)[field];
        if (Array.isArray(left) || Array.isArray(right)) {
          return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((v, j) => v === right[j])
          );
        }
        return left === right;
      });
    });
  });
}
