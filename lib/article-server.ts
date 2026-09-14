import Defuddle from "defuddle";
import type { DefuddleResponse } from "defuddle";
import { DOMParser, parseHTML } from "linkedom";
import { FeedError, readCapped, USER_AGENT } from "./feed-server";
import {
  ARTICLE_BODY_BUDGET,
  decodeEntities,
  firstFigureSrc,
  htmlToBlocks,
  htmlToText,
  imageIdentity,
  isJunkImageUrl,
  resolveUrl,
  stripLeadFigure,
} from "./feed-html";
import type { Block } from "./types";
import { isSafeTargetUrl } from "./url-safety";

/**
 * Original-page extraction.
 *
 * When a feed gives a story an article URL, that page is the preferred body;
 * the feed's own text is the instant fallback until the original arrives. This
 * fetches the page the reader actually opened, extracts its body with
 * Defuddle, and returns it as the same `Block[]` the reader already renders
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
  /** The caption the page printed under that lead image, when it had one. */
  imageCaption?: string;
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

/* ------------------------------------------------------------- video */

type VideoEmbed = { provider: "youtube" | "vimeo"; id: string; title?: string };

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "player.vimeo.com",
]);

/**
 * Whether an address is a video from a provider we are willing to embed.
 *
 * Anything else is refused: the reader must never render an arbitrary
 * publisher iframe, so an embed is only ever a known provider plus an id.
 */
export function parseVideoEmbedUrl(
  raw: string,
): { provider: "youtube" | "vimeo"; id: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!VIDEO_HOSTS.has(host)) return undefined;

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? { provider: "youtube", id } : undefined;
  }
  if (host === "player.vimeo.com") {
    const match = /^\/video\/(\d+)/.exec(url.pathname);
    return match ? { provider: "vimeo", id: match[1] } : undefined;
  }
  const match = /^\/(?:embed|v|shorts)\/([A-Za-z0-9_-]{6,})/.exec(url.pathname);
  return match ? { provider: "youtube", id: match[1] } : undefined;
}

/** Walks a JSON-LD graph looking for a `VideoObject` with a usable embed. */
function videoFromJson(node: unknown): VideoEmbed | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = videoFromJson(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const object = node as Record<string, unknown>;
  const type = object["@type"];
  const isVideo = type === "VideoObject" || (Array.isArray(type) && type.includes("VideoObject"));
  if (isVideo) {
    for (const key of ["embedUrl", "contentUrl"]) {
      const value = object[key];
      if (typeof value !== "string") continue;
      const parsed = parseVideoEmbedUrl(value);
      if (parsed) {
        return { ...parsed, title: typeof object.name === "string" ? object.name : undefined };
      }
    }
  }
  for (const value of Object.values(object)) {
    const found = videoFromJson(value);
    if (found) return found;
  }
  return undefined;
}

function metaContent(html: string, property: string): string | undefined {
  const tag = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${property}["'][^>]*>`, "i").exec(
    html,
  )?.[0];
  if (!tag) return undefined;
  const content = /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content) : undefined;
}

/**
 * The page's own video, from standard metadata rather than publisher markup.
 * schema.org `VideoObject` first, then Open Graph/Twitter player meta, then a
 * real iframe.
 */
function findVideoEmbed(html: string): VideoEmbed | undefined {
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const found = videoFromJson(data);
    if (found) return found;
  }

  for (const property of ["og:video:secure_url", "og:video:url", "og:video", "twitter:player"]) {
    const value = metaContent(html, property);
    if (!value) continue;
    const parsed = parseVideoEmbedUrl(value);
    if (parsed) return parsed;
  }

  for (const match of html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const parsed = parseVideoEmbedUrl(match[1]);
    if (parsed) return parsed;
  }
  return undefined;
}

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

/**
 * linkedom does not implement the couple of layout APIs Defuddle probes for
 * hidden elements, and its `defaultView` can resolve to a host `window` (jsdom
 * under test) whose `getComputedStyle` refuses foreign elements. So the document
 * gets a small window of its own — linkedom's matching DOM parser plus a
 * no-layout `getComputedStyle` — that shadows whatever view it inherited.
 */
function documentFor(html: string, url: string): Document {
  const { document } = parseHTML(html);
  const doc = document as unknown as {
    defaultView?: object | null;
    URL?: string;
    styleSheets?: unknown;
  };
  // Defuddle reads the page's own stylesheets to spot mobile-hidden elements;
  // linkedom has none to give, and an empty list is the honest answer.
  if (!doc.styleSheets) doc.styleSheets = [];
  const view = Object.create(doc.defaultView ?? null) as Record<string, unknown>;
  view.getComputedStyle = () => ({ display: "" });
  view.DOMParser = DOMParser;
  Object.defineProperty(doc, "defaultView", { value: view, configurable: true });
  try {
    doc.URL = url;
    // Relative `src`/`href` resolve against the article, not the local host.
    Object.defineProperty(doc, "baseURI", { value: url, configurable: true });
  } catch {
    /* some DOM implementations expose URL/baseURI as read-only */
  }
  return document as unknown as Document;
}

export { documentFor };

/** The lead image from the page's own metadata, if it is worth showing. */
function usableImage(raw: string | undefined, base: string): string | undefined {
  const resolved = resolveUrl(raw, base);
  if (!resolved || isJunkImageUrl(resolved)) return undefined;
  return resolved;
}

/**
 * The caption the body printed under the lead image, if the body has it.
 * The lead is often the same photograph as a body figure at another size, and
 * that figure is about to be removed — so its caption is carried up first.
 */
function captionForImage(blocks: Block[], image: string): string | undefined {
  const target = imageIdentity(image);
  const figure = blocks.find(
    (block) => block.kind === "figure" && block.src && imageIdentity(block.src) === target,
  );
  return figure?.kind === "figure" ? figure.caption.trim() || undefined : undefined;
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  // Read the page's own video before extraction: a video page has almost no
  // prose, and content extraction often returns null or a handful of credits.
  const video = findVideoEmbed(html);

  let parsed: DefuddleResponse | null = null;
  try {
    // Sync `parse()` never touches the async third-party extractors, so the
    // reader still fetches one page and nothing else.
    parsed = new Defuddle(documentFor(html, url), { url, useAsync: false }).parse();
  } catch {
    parsed = null;
  }

  const content = parsed?.content ?? "";
  if (!content) {
    // A video is the article here; a page with nothing but a player is still
    // readable rather than a failure.
    if (video) return { blocks: [{ kind: "video", ...video }], truncated: false };
    throw new FeedError("Could not read the article on that page.", 422);
  }

  const { blocks, truncated } = htmlToBlocks(content, url, ARTICLE_BODY_BUDGET);
  const text = htmlToText(content);
  if (!video && (blocks.length === 0 || text.length < MIN_ARTICLE_CHARS)) {
    throw new FeedError("That page did not contain a readable article.", 422);
  }

  // The page's own metadata names the piece's main image, which is a better
  // lead than whichever figure happens to come first in the body.
  const image = usableImage(parsed?.image, url) ?? firstFigureSrc(blocks);
  // The reader shows `image` above the body, so the same figure must not
  // appear a second time inside it — but its caption belongs to the lead.
  const imageCaption = image ? captionForImage(blocks, image) : undefined;
  const body = stripLeadFigure(blocks, image);
  // Content extraction drops iframes, so the video is placed at the top of
  // what it did keep. Only a provider id is stored, never publisher markup.
  const withVideo = video ? [{ kind: "video" as const, ...video }, ...body] : body;

  return {
    title: parsed?.title?.trim() || undefined,
    author: parsed?.author?.trim() || undefined,
    publishedTime: parsed?.published?.trim() || undefined,
    siteName: parsed?.site?.trim() || undefined,
    blocks: withVideo,
    truncated,
    image,
    imageCaption,
  };
}

type ArticleFetchResult =
  | { notModified: true; etag?: string; lastModified?: string }
  | { notModified: false; html: string; finalUrl: string; etag?: string; lastModified?: string };

/**
 * Fetches a page's HTML with the same safety rules as the reader, for the
 * local extractor-comparison lab. Not used by the product path.
 */
export async function fetchPage(raw: string): Promise<{ html: string; finalUrl: string }> {
  const result = await fetchArticleHtml(raw);
  if (result.notModified) throw new FeedError("The page answered 304 unexpectedly.", 502);
  return { html: result.html, finalUrl: result.finalUrl };
}

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
