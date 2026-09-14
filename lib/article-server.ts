import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { FeedError, readCapped, USER_AGENT } from "./feed-server";
import { ARTICLE_BODY_BUDGET, firstFigureSrc, htmlToBlocks, stripLeadFigure } from "./feed-html";
import type { Block } from "./types";
import { isSafeTargetUrl } from "./url-safety";

/**
 * Original-page extraction.
 *
 * When a feed gives a story an article URL, that page is the preferred body;
 * the feed's own text is the instant fallback until the original arrives. This
 * fetches the page the reader actually opened, extracts its body with
 * Readability, and returns it as the same `Block[]` the reader already renders
 * — so the reading surface is unchanged and no publisher HTML reaches the DOM.
 *
 * It runs one page at a time, when a reader opens a story, never as a
 * background crawl. Conditional requests let a revalidation of an already
 * cached page cost a 304 instead of a full download. It does not defeat
 * paywalls, logins or JavaScript challenges: a page that will not hand over
 * its text is a page we keep the feed's fallback for.
 */

export type ExtractedArticle = {
  title?: string;
  author?: string;
  publishedTime?: string;
  siteName?: string;
  blocks: Block[];
  /** True when our own article budget cut the body short. */
  truncated: boolean;
  /** The article's own lead image, when it has one. */
  image?: string;
  /** Validators to send back on the next conditional GET. */
  etag?: string;
  lastModified?: string;
};

/** What a conditional request can send. Stored per article. */
export type ArticleConditions = {
  etag?: string;
  lastModified?: string;
};

/**
 * The result of asking for an article. `not-modified` means the publisher
 * confirmed the cached copy is current, so there is nothing to parse or
 * replace — only the checked-at time moves.
 */
export type ArticleResult =
  | { status: "not-modified"; etag?: string; lastModified?: string }
  | { status: "ok"; article: ExtractedArticle };

const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 12_000;

/**
 * The smallest body worth calling an article.
 *
 * This is not the `full` vs `summary` test — that is decided by which feed
 * field the body came from. It only answers "did extraction produce an article
 * at all": below it the page is a nav shell, a paywall stub, or a script that
 * never rendered, and the caller keeps the feed's own text.
 */
const MIN_ARTICLE_CHARS = 200;

export async function readArticle(
  raw: string,
  conditions?: ArticleConditions,
): Promise<ArticleResult> {
  const fetched = await fetchArticleHtml(raw, conditions);
  if (fetched.notModified) {
    return {
      status: "not-modified",
      etag: fetched.etag,
      lastModified: fetched.lastModified,
    };
  }
  const article = extractArticle(fetched.html, fetched.finalUrl);
  return {
    status: "ok",
    article: { ...article, etag: fetched.etag, lastModified: fetched.lastModified },
  };
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  // Readability resolves the content's relative URLs against `baseURI`, and
  // linkedom exposes it as a getter-only property. Re-defining it per document
  // is what keeps `/lead.jpg` resolving against the article, not the test host.
  try {
    Object.defineProperty(doc, "baseURI", { value: url, configurable: true });
  } catch {
    /* fall back to htmlToBlocks' own resolution */
  }

  let parsed: ReturnType<Readability["parse"]> = null;
  try {
    parsed = new Readability(doc, { charThreshold: 100 }).parse();
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.content) {
    throw new FeedError("Could not read the article on that page.", 422);
  }

  const { blocks, truncated } = htmlToBlocks(parsed.content, url, ARTICLE_BODY_BUDGET);
  const text = (parsed.textContent ?? "").replace(/\s+/g, " ").trim();
  if (blocks.length === 0 || text.length < MIN_ARTICLE_CHARS) {
    throw new FeedError("That page did not contain a readable article.", 422);
  }

  const image = firstFigureSrc(blocks);
  // The reader shows `image` above the body, so the same figure must not
  // appear a second time inside it.
  const body = stripLeadFigure(blocks, image);

  return {
    title: parsed.title?.trim() || undefined,
    author: parsed.byline?.trim() || undefined,
    publishedTime: parsed.publishedTime?.trim() || undefined,
    siteName: parsed.siteName?.trim() || undefined,
    blocks: body,
    truncated,
    image,
  };
}

type ArticleFetchResult =
  | { notModified: true; etag?: string; lastModified?: string }
  | { notModified: false; html: string; finalUrl: string; etag?: string; lastModified?: string };

async function fetchArticleHtml(
  start: string,
  conditions?: ArticleConditions,
): Promise<ArticleFetchResult> {
  // Conditional GET, never a HEAD followed by a GET: one round trip either
  // confirms the cache (`304`) or hands back the page.
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml;q=0.8,*/*;q=0.5",
    "accept-language": "en",
  };
  if (conditions?.etag) headers["if-none-match"] = conditions.etag;
  else if (conditions?.lastModified) headers["if-modified-since"] = conditions.lastModified;

  let current = start;
  /* oxlint-disable no-await-in-loop */
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // re-checked on every hop: a redirect is a second address
    if (!isSafeTargetUrl(current)) {
      throw new FeedError("That address cannot be read.", 400);
    }

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
      throw new FeedError(
        timedOut ? "That page took too long to answer." : "Could not reach that page.",
        502,
      );
    }

    if (res.status === 304) {
      return {
        notModified: true,
        etag: res.headers.get("etag") ?? conditions?.etag,
        lastModified: res.headers.get("last-modified") ?? conditions?.lastModified,
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new FeedError("That page redirected nowhere.", 502);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new FeedError("That page redirected to an address that cannot be read.", 502);
      }
      continue;
    }

    if (!res.ok) throw new FeedError(`The site answered ${res.status}.`, 502);

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("html")) throw new FeedError("That address is not a web page.", 422);

    return {
      notModified: false,
      html: await readCapped(res, MAX_HTML_BYTES),
      finalUrl: current,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
  }
  /* oxlint-enable no-await-in-loop */

  throw new FeedError("That address redirected too many times.", 502);
}
