import { XMLParser } from "fast-xml-parser";
import {
  blocksToText,
  firstFigureSrc,
  hashString,
  hasReadMoreCue,
  htmlToBlocks,
  htmlToSummary,
  htmlToText,
  resolveUrl,
  sharedOpening,
} from "./feed-html";
import type { Block, ContentState, Story, StoryLayout } from "./types";

/* --------------------------------------------------------------- types */

export type ParsedItem = {
  id: string;
  title: string;
  link?: string;
  author?: string;
  publishedMs?: number;
  summary: string;
  body: Block[];
  image?: string;
  contentState: ContentState;
};

export type ParsedFeed = {
  title: string;
  siteUrl: string;
  feedUrl: string;
  description: string;
  kind: "rss" | "atom" | "rdf";
  items: ParsedItem[];
};

export class FeedError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

/* ---------------------------------------------------------------- fetch */

// No contact URL: we do not have one to give, and inventing one would be worse
// than a plain product identifier.
export const USER_AGENT = "Mozilla/5.0 (compatible; FireflyFeeds/1.0) AppleWebKit/537.36";

const FEED_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/feed+json",
  "application/xml",
  "text/xml",
  "application/rdf+xml",
];

export function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new FeedError("Enter an address first.", 400);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FeedError("That does not look like a web address.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FeedError("Only http and https addresses can be read.", 400);
  }
  return url.toString();
}

async function request(
  url: string,
): Promise<{ body: string; contentType: string; finalUrl: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: `${FEED_TYPES.join(", ")}, text/html;q=0.8, */*;q=0.5`,
        "accept-language": "en",
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
    throw new FeedError(
      timedOut ? "That address took too long to answer." : "Could not reach that address.",
      502,
    );
  }

  if (!res.ok) {
    throw new FeedError(
      res.status === 404 ? "Nothing lives at that address." : `The site answered ${res.status}.`,
      502,
    );
  }

  return {
    body: await readCapped(res),
    contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
    finalUrl: res.url || url,
  };
}

/**
 * The largest document worth reading.
 *
 * The heaviest real feed measured here is Pluralistic at 137KB; 2MB is a
 * generous ceiling that still bounds what one request can make the Worker pull.
 */
const MAX_BYTES = 2_000_000;

/**
 * Reads a response with a ceiling, aborting the moment it is crossed.
 *
 * `res.arrayBuffer()` buffers the whole document before anything can be checked,
 * so a declared 4MB cap only ever fired after the megabytes had already arrived.
 * Reading the stream lets the transfer stop mid-flight instead, which matters
 * because this endpoint is public and anyone can point it at a large URL.
 */
export async function readCapped(response: Response, limit = MAX_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    throw new FeedError("That feed is too large to read.", 413);
  }
  if (!response.body) {
    const text = await response.text();
    if (text.length > limit) throw new FeedError("That feed is too large to read.", 413);
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    // a stream is read one chunk at a time by definition
    /* oxlint-disable no-await-in-loop */
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new FeedError("That feed is too large to read.", 413);
      }
      chunks.push(value);
    }
    /* oxlint-enable no-await-in-loop */
  } finally {
    // stops the transfer rather than draining a document we will not read
    await reader.cancel().catch(() => {});
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(buffer);
}

/* ------------------------------------------------------------ discovery */

/** `<link rel="alternate" type="application/rss+xml" href="…">` */
function discoverFeeds(html: string, baseUrl: string): { href: string; title: string }[] {
  const found: { href: string; title: string }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (!FEED_TYPES.some((t) => type.includes(t))) continue;
    const rel = (attr(tag, "rel") ?? "alternate").toLowerCase();
    if (rel && !rel.includes("alternate") && !rel.includes("feed")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (!found.some((f) => f.href === abs))
        found.push({ href: abs, title: attr(tag, "title") ?? "" });
    } catch {
      /* skip malformed */
    }
  }
  return found;
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  return (m?.[1] ?? m?.[2] ?? m?.[3])?.trim() || undefined;
}

function looksLikeFeed(body: string, contentType: string): boolean {
  const head = body.slice(0, 900);
  if (/^\s*\{/.test(head)) return contentType.includes("json");
  return (
    contentType.includes("xml") || /^\s*<\?xml/i.test(head) || /<(rss|feed|rdf:RDF)\b/i.test(head)
  );
}

/* --------------------------------------------------------------- parser */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
});

type Node = Record<string, unknown> | string | undefined;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of a node that may be a string, `{ "#text": … }`, or a list. */
function firstText(value: unknown): string {
  for (const node of asArray(value as Node | Node[])) {
    if (typeof node === "string" && node.trim()) return node.trim();
    if (node && typeof node === "object") {
      const t = (node as Record<string, unknown>)["#text"];
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  return "";
}

function firstAttr(value: unknown, name: string): string {
  for (const node of asArray(value as Node | Node[])) {
    if (node && typeof node === "object") {
      const v = (node as Record<string, unknown>)[name];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** Atom links are a list of `{ "@_href", "@_rel" }`; RSS links are strings. */
function pickLink(value: unknown, baseUrl: string): string {
  const entries = asArray(value as Node | Node[]);
  const scored: { href: string; score: number }[] = [];
  for (const node of entries) {
    let href = "";
    let score = 1;
    if (typeof node === "string") href = node.trim();
    else if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      href = typeof o["@_href"] === "string" ? o["@_href"] : firstText(o);
      const rel = typeof o["@_rel"] === "string" ? o["@_rel"] : "alternate";
      if (rel === "alternate") score = 3;
      else if (rel === "self") score = 0;
      if (typeof o["@_type"] === "string" && o["@_type"].includes("html")) score += 1;
    }
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;
    scored.push({ href: resolved, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.href ?? "";
}

function parseDate(value: unknown): number | undefined {
  const raw = firstText(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The lead image the feed declares in its own metadata.
 *
 * Deliberately does not fall back to the body: a body image is chosen from the
 * parsed blocks (filtered, ordered, de-duplicated) rather than by grabbing the
 * first `<img>` in the source, which is how a logo ends up as a lead image.
 */
function pickFeedImage(item: Record<string, unknown>, baseUrl: string): string | undefined {
  const candidates: string[] = [
    firstAttr(item["media:content"], "@_url"),
    firstAttr(item["media:thumbnail"], "@_url"),
    firstAttr(item["itunes:image"], "@_href"),
    firstAttr(item["image"], "@_href"),
  ];
  for (const enclosure of asArray(item.enclosure as Node | Node[])) {
    if (enclosure && typeof enclosure === "object") {
      const o = enclosure as Record<string, unknown>;
      const type = typeof o["@_type"] === "string" ? o["@_type"] : "";
      const url = typeof o["@_url"] === "string" ? o["@_url"] : "";
      if (url && (type.startsWith("image/") || /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(url))) {
        candidates.push(url);
      }
    }
  }
  for (const candidate of candidates) {
    const resolved = resolveUrl(candidate, baseUrl);
    if (resolved) return resolved;
  }
  return undefined;
}

function normalizeItem(
  raw: Record<string, unknown>,
  baseUrl: string,
  channelAuthor: string,
): ParsedItem | null {
  const title = htmlToText(firstText(raw.title)).slice(0, 300);
  const link = pickLink(raw.link, baseUrl) || resolveUrl(firstText(raw.guid), baseUrl);
  const rich = firstText(raw["content:encoded"]) || firstText(raw.content);
  const plain = firstText(raw.description) || firstText(raw.summary);
  const contentHtml = rich || plain;

  if (!title && !contentHtml) return null;

  // Atom carries the byline on the feed, not on each entry
  const author =
    firstText(raw["dc:creator"]) ||
    firstText(raw["itunes:author"]) ||
    firstText(raw.author) ||
    firstText(raw["atom:author"]) ||
    firstText((raw.author as Record<string, unknown> | undefined)?.name) ||
    channelAuthor;

  const publishedMs =
    parseDate(raw.pubDate) ??
    parseDate(raw.published) ??
    parseDate(raw.updated) ??
    parseDate(raw["dc:date"]) ??
    parseDate(raw.date);

  const { blocks: body, truncated } = htmlToBlocks(contentHtml, baseUrl);
  const summary = htmlToSummary(
    firstText(raw.description) || firstText(raw.summary) || contentHtml,
  );
  /*
   * Which field the body came from is the first signal, not its length: a
   * `<content:encoded>` body is the publisher saying “this is the piece”, while
   * `<description>` is their summary. Two content signals can still downgrade a
   * content body: a “read more” stub, or a body that is *exactly* the feed's own
   * summary — some feeds put their one-paragraph teaser in `content:encoded`.
   * Our own cut wins over all of them.
   */
  let contentState: ContentState = rich ? "full" : "summary";
  if (contentState === "full" && hasReadMoreCue(contentHtml)) contentState = "summary";
  if (contentState === "full" && summary && blocksToText(body) === summary.trim()) {
    contentState = "summary";
  }
  if (truncated) contentState = "truncated";
  // The feed's own lead image is the stream cover; otherwise the first body
  // figure is. The body is left alone, so an image keeps the place the feed
  // gave it.
  const image = pickFeedImage(raw, baseUrl) ?? firstFigureSrc(body);

  /*
   * Identity answers "is this the same article?", which is a different question
   * from "where do I fetch the original?" — that is `link`, stored separately.
   * Publisher-provided ids win: Atom's <id>, RSS's <guid> and RDF's rdf:about
   * survive a URL change. Then the link, then the title and published time,
   * then the content itself. Position is deliberately absent: a feed that
   * inserts a new entry would otherwise renumber every later item and orphan
   * its reading state.
   */
  const publisherId = firstText(raw.guid) || firstText(raw.id) || firstAttr(raw, "@_rdf:about");
  const titled = title ? `${title} ${publishedMs ?? ""}`.trim() : "";
  const contentKey = htmlToText(contentHtml).replace(/\s+/g, " ").trim().slice(0, 400);
  const identity =
    publisherId ||
    link ||
    titled ||
    contentKey ||
    `content-${hashString(contentHtml).toString(36)}`;

  return {
    id: hashString(identity).toString(36),
    title: title || "Untitled",
    link,
    author: author ? htmlToText(author).slice(0, 120) : undefined,
    publishedMs,
    summary: summary || htmlToText(contentHtml).slice(0, 220),
    body,
    image,
    contentState,
  };
}

/* ------------------------------------------------------------- headline */

export function parseFeedXml(xml: string, feedUrl: string): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new FeedError("That page is not valid XML.", 422);
  }

  const rssRoot = doc.rss as Record<string, unknown> | undefined;
  const rdfRoot = doc["rdf:RDF"] as Record<string, unknown> | undefined;
  const atomRoot = doc.feed as Record<string, unknown> | undefined;

  let kind: ParsedFeed["kind"] = "rss";
  let channel: Record<string, unknown>;
  let rawItems: unknown[];

  if (atomRoot) {
    kind = "atom";
    channel = atomRoot;
    rawItems = asArray(atomRoot.entry as never);
  } else if (rdfRoot) {
    kind = "rdf";
    // RSS 1.0 keeps its metadata on <channel> alongside the top-level <item>s
    channel = (asArray(rdfRoot.channel as never)[0] as Record<string, unknown>) ?? rdfRoot;
    rawItems = asArray(rdfRoot.item as never);
  } else if (rssRoot) {
    channel = (asArray(rssRoot.channel as never)[0] as Record<string, unknown>) ?? {};
    rawItems = asArray(channel.item as never);
  } else {
    throw new FeedError("No feed was found at that address.", 422);
  }

  const siteUrl = pickLink(channel.link, feedUrl) || feedUrl;
  const channelAuthor =
    firstText(channel["dc:creator"]) ||
    firstText(channel["itunes:author"]) ||
    firstText((channel.author as Record<string, unknown> | undefined)?.name) ||
    firstText(channel.author) ||
    firstText((channel["atom:author"] as Record<string, unknown> | undefined)?.name) ||
    "";
  const title =
    htmlToText(firstText(channel.title)) || new URL(feedUrl).hostname.replace(/^www\./, "");

  const items: ParsedItem[] = [];
  for (const raw of rawItems.slice(0, 40)) {
    if (!raw || typeof raw !== "object") continue;
    const item = normalizeItem(raw as Record<string, unknown>, siteUrl, channelAuthor);
    if (item) items.push(item);
  }

  if (!items.length) throw new FeedError("That feed contains no readable entries.", 422);

  // A summary that is the same in every row is not a summary. Strip whatever
  // opening the feed repeats, so each row says something about its own entry.
  const common = sharedOpening(items.map((item) => item.summary));
  if (common) {
    for (const item of items) {
      if (item.summary.startsWith(common)) item.summary = item.summary.slice(common.length).trim();
    }
  }

  return {
    title: title.slice(0, 120),
    siteUrl,
    feedUrl,
    description: htmlToText(
      firstText(channel.description) || firstText(channel.subtitle) || firstText(channel.tagline),
    ),
    kind,
    items,
  };
}

/* --------------------------------------------------------------- public */

export async function readFeed(input: string): Promise<ParsedFeed> {
  const url = normalizeInputUrl(input);
  const first = await request(url);

  if (looksLikeFeed(first.body, first.contentType)) {
    return parseFeedXml(first.body, first.finalUrl);
  }

  const discovered = discoverFeeds(first.body, first.finalUrl);
  if (!discovered.length) {
    throw new FeedError("No feed was found at that address. Try the direct feed URL.", 422);
  }

  let lastError: unknown;
  // candidates are tried in document order and stop at the first that parses,
  // so these requests are deliberately sequential
  /* oxlint-disable no-await-in-loop */
  for (const candidate of discovered.slice(0, 3)) {
    try {
      const next = await request(candidate.href);
      return parseFeedXml(next.body, next.finalUrl);
    } catch (error) {
      lastError = error;
    }
  }
  /* oxlint-enable no-await-in-loop */
  throw lastError instanceof FeedError
    ? lastError
    : new FeedError("No readable feed was found.", 422);
}

/* ------------------------------------------------------------- shaping */

/**
 * A fetched story's row shape follows the story, never its position in the feed.
 *
 * It used to be positional, and that was wrong twice over. Every seventh entry
 * was forced into `brief` — the bare contents-page row — so the same story
 * rendered differently depending on when it happened to be published, and a row
 * with no summary reads as missing data rather than as a deliberate layout.
 * Measured across six real feeds, thirty entries, none lacked a summary: the
 * rule cost information and bought nothing.
 *
 * A positional "lead story" treatment would be wrong here too. The stream merges
 * every source and sorts by time, so a per-source lead would land at an
 * arbitrary height in the column.
 *
 * What is left is genuinely earned: a picture makes a thumbnail row, and an
 * entry with nothing to summarise — rare, but real for title-only feeds — is
 * the one case where hiding the summary costs nothing.
 */
export function layoutFor(input: { hasImage: boolean; hasSummary: boolean }): StoryLayout {
  if (!input.hasSummary) return "brief";
  if (input.hasImage) return "standard";
  return "compact";
}

export type { Story };
