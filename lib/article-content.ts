import { ARTICLE_STALE_MS, EXTRACTOR_VERSION, needsArticleRefresh } from "./refreshing";
import * as repo from "./storage/repository";
import type { ArticleRecord, SourceRecord } from "./storage/types";

/**
 * One place that downloads an article's original body.
 *
 * The reader's open story and the briefing's bounded enrichment both need it,
 * and they must not disagree about caching, conditional GET or retry windows.
 * The reader-visible policy — never swapping the body under someone mid-read —
 * stays with the caller; this layer only fetches, judges freshness and writes
 * the cache. See docs/specs/ai-daily-briefing.md §5.2.
 */

export type ArticleContentResult = {
  article: ArticleRecord;
  availability: "full" | "truncated" | "summary";
  fetched: boolean;
  /** `cancelled` is not a failure: the reader stopped the run, not the site. */
  error?: string;
};

const inFlight = new Map<string, Promise<ArticleContentResult>>();

function availabilityOf(article: ArticleRecord): ArticleContentResult["availability"] {
  if (article.contentState === "full") return "full";
  if (article.contentState === "truncated") return "truncated";
  return "summary";
}

async function fetchContent(
  article: ArticleRecord,
  source: SourceRecord,
  purpose: "reader" | "briefing",
  signal?: AbortSignal,
): Promise<ArticleContentResult> {
  const current = {
    article,
    availability: availabilityOf(article),
    fetched: false,
  } satisfies ArticleContentResult;
  if (!article.link) return current;

  // A fresh body from the current extractor is revalidated; anything else is
  // fetched as if for the first time, so the cached copy may change.
  const revalidation =
    typeof article.contentFetchedAt === "number" && article.extractorVersion === EXTRACTOR_VERSION;

  const at = Date.now();
  const params = new URLSearchParams({ url: article.link });
  // Conditional GET is only useful when the cached body came from this same
  // extractor: after a version bump a 304 would leave nothing to rebuild from.
  if (revalidation) {
    if (article.etag) params.set("etag", article.etag);
    else if (article.lastModified) params.set("lastModified", article.lastModified);
  }
  if (source.title) params.set("site", source.title);

  try {
    const res = await fetch(`/api/article?${params.toString()}`, { signal });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error ?? "failed");

    if (data.notModified) {
      const touched: ArticleRecord = { ...article, contentCheckedAt: at };
      await repo.putArticle(touched);
      return { article: touched, availability: availabilityOf(touched), fetched: false };
    }

    const body = data.article as {
      title?: string;
      author?: string;
      blocks: ArticleRecord["body"];
      truncated?: boolean;
      image?: string;
      hasCover?: boolean;
      imageCaption?: string;
      videoPage?: boolean;
      etag?: string;
      lastModified?: string;
    };
    if (!Array.isArray(body?.blocks) || body.blocks.length === 0)
      throw new Error("The source returned no usable body.");
    const next: ArticleRecord = {
      ...article,
      title: body.title || article.title,
      author: body.author || article.author,
      body: body.blocks,
      image: body.image ?? article.image,
      hasCover: body.hasCover ?? article.hasCover,
      imageCaption: body.imageCaption ?? article.imageCaption,
      videoPage: body.videoPage ?? article.videoPage,
      // Only a body that was not cut by our own budget may call itself full.
      contentState: body.truncated ? "truncated" : "full",
      extractionState: "success",
      contentFetchedAt: at,
      contentCheckedAt: at,
      etag: body.etag ?? article.etag,
      lastModified: body.lastModified ?? article.lastModified,
      extractorVersion: EXTRACTOR_VERSION,
    };
    await repo.putArticle(next);
    return { article: next, availability: availabilityOf(next), fetched: true };
  } catch (error) {
    if (signal?.aborted) {
      return {
        ...current,
        error: purpose === "briefing" ? "cancelled" : "aborted",
      };
    }
    // A failure keeps whatever body is already there. The checked time moves,
    // so the retry window — not a permanent lockout — decides the next try.
    const hasOriginal = typeof article.contentFetchedAt === "number";
    const failed: ArticleRecord = {
      ...article,
      extractionState: hasOriginal ? article.extractionState : "failed",
      contentCheckedAt: at,
      // Stamp the attempt so a version change does not retrigger every render.
      extractorVersion: EXTRACTOR_VERSION,
    };
    await repo.putArticle(failed);
    return {
      article: failed,
      availability: availabilityOf(failed),
      fetched: false,
      error: error instanceof Error ? error.message : "failed",
    };
  }
}

export function ensureArticleContent(input: {
  article: ArticleRecord;
  source: SourceRecord;
  purpose: "reader" | "briefing";
  signal?: AbortSignal;
}): Promise<ArticleContentResult> {
  const { article, source, purpose, signal } = input;
  const current = {
    article,
    availability: availabilityOf(article),
    fetched: false,
  } satisfies ArticleContentResult;

  if (!article.link) return Promise.resolve(current);
  if (
    purpose === "briefing" &&
    article.contentState === "full" &&
    article.contentFetchedAt === undefined &&
    Date.now() - article.fetchedAt < ARTICLE_STALE_MS
  )
    return Promise.resolve(current);
  // Fresh enough means no network at all — for the briefing as much as for the
  // reader: extraction is an on-demand act, never a background crawl.
  if (!needsArticleRefresh(article, Date.now())) return Promise.resolve(current);

  // One page, one request: the reader opening a story the briefing is already
  // fetching waits for that fetch rather than starting a second.
  const running = inFlight.get(article.id);
  if (running) return running;

  const task = fetchContent(article, source, purpose, signal).finally(() => {
    inFlight.delete(article.id);
  });
  inFlight.set(article.id, task);
  return task;
}
