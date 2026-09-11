import { initials } from "./hash";
import { blocksToText } from "./feed-html";
import type { ArticleRecord, ReadingRecord, SourceRecord } from "./storage/types";
import type { ContentState, Feed, Story } from "./types";

/**
 * Records → the view model. This is the seam where stored data becomes the
 * `Feed` / `Story` shapes the interface already speaks, so a fetched source
 * needs no special cases anywhere downstream.
 */

export function formatPublished(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function feedFromSource(source: SourceRecord): Feed {
  return {
    id: source.id,
    name: source.title,
    folder: source.folder,
    host: source.host,
    mark: initials(source.title),
    feedUrl: source.url,
    siteUrl: source.siteUrl,
    subscribed: true,
  };
}

export function storyFromArticle(article: ArticleRecord, now: number): Story {
  const minutesAgo = Math.max(1, Math.round((now - article.publishedAt) / 60_000));
  return {
    id: article.id,
    title: article.title,
    feedId: article.sourceId,
    dek: article.summary,
    minutesAgo,
    minutes: article.minutes,
    layout: article.layout,
    /*
     * Fetched articles carry artwork only when the publisher supplied it. A
     * generated plate here would occupy the same slot as a photograph and read
     * as the article's own image, which it is not — the giveaway being that it
     * does not exist on the page the story links to. Plates are for the sample
     * edition, where everything is labelled and nothing links out.
     */
    image: article.image,
    byline: article.author,
    body: article.body,
    link: article.link,
    publishedLabel: formatPublished(article.publishedAt),
    live: true,
    contentState: contentStateOf(article),
    extractionState: article.extractionState ?? "idle",
  };
}

/**
 * A cached body's `contentState`, with the one inference the stored record may
 * not have made.
 *
 * Records cached before the classifier existed have no state at all, and a feed
 * that puts its one-paragraph teaser in a `<content:encoded>` is stored as
 * `full`. The reader would then be shown the summary and never offered the
 * article it came from. A body that is *exactly* the feed's summary is the safe
 * tell — a full piece is never character-for-character its own dek — so it is
 * treated as a summary and the on-demand fetch runs.
 */
function contentStateOf(article: ArticleRecord): ContentState {
  const stored = article.contentState;
  if (stored === "summary" || stored === "truncated") return stored;
  const summary = article.summary.replace(/\s+/g, " ").trim();
  if (summary && blocksToText(article.body) === summary) return "summary";
  return "full";
}

/** Flat `Record<id, boolean>` view, which is what the components consume. */
export function readingFlags(records: ReadingRecord[]): {
  read: Record<string, boolean>;
  saved: Record<string, boolean>;
  later: Record<string, boolean>;
} {
  const read: Record<string, boolean> = {};
  const saved: Record<string, boolean> = {};
  const later: Record<string, boolean> = {};
  for (const record of records) {
    if (record.read) read[record.id] = true;
    if (record.saved) saved[record.id] = true;
    if (record.later) later[record.id] = true;
  }
  return { read, saved, later };
}
