import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { FeedError, readCapped, USER_AGENT } from "./feed-server";
import { ARTICLE_BODY_BUDGET, firstFigureSrc, htmlToBlocks, stripLeadFigure } from "./feed-html";
import type { Block } from "./types";
import { isSafeTargetUrl } from "./url-safety";

/**
 * On-demand full-text extraction.
 *
 * A feed that carries only a summary leaves the reader with two bad options:
 * read the summary twice, or leave the app. This fetches the article the reader
 * actually opened, extracts its body, and returns it as the same `Block[]` the
 * reader already renders — so the reading surface is unchanged and no publisher
 * HTML reaches the DOM.
 *
 * It runs only when a reader opens a story, never as a background crawl. It
 * does not defeat paywalls, logins or JavaScript challenges: a page that will
 * not hand over its text is a page we keep the feed's summary for.
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
};

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

export async function readArticle(raw: string): Promise<ExtractedArticle> {
  const { html, finalUrl } = await fetchArticleHtml(raw);
  return extractArticle(html, finalUrl);
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

async function fetchArticleHtml(start: string): Promise<{ html: string; finalUrl: string }> {
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
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.8,*/*;q=0.5",
          "accept-language": "en",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
      throw new FeedError(
        timedOut ? "That page took too long to answer." : "Could not reach that page.",
        502,
      );
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

    return { html: await readCapped(res, MAX_HTML_BYTES), finalUrl: current };
  }
  /* oxlint-enable no-await-in-loop */

  throw new FeedError("That address redirected too many times.", 502);
}
