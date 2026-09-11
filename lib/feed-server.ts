import { XMLParser } from "fast-xml-parser";
import { hashString, htmlToBlocks, htmlToSummary, htmlToText, isSafeUrl } from "./feed-html";
import type { Block, Story, StoryLayout } from "./types";

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
  truncated?: boolean;
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

const UA =
  "Mozilla/5.0 (compatible; FireflyReader/1.0; +https://github.com/fireflyreader) AppleWebKit/537.36";

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

async function request(url: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": UA,
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

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > 4_000_000) throw new FeedError("That feed is too large to read.", 413);

  return {
    body: new TextDecoder("utf-8").decode(buffer),
    contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
    finalUrl: res.url || url,
  };
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
      if (!found.some((f) => f.href === abs)) found.push({ href: abs, title: attr(tag, "title") ?? "" });
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
    contentType.includes("xml") ||
    /^\s*<\?xml/i.test(head) ||
    /<(rss|feed|rdf:RDF)\b/i.test(head)
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
    if (!href || !isSafeUrl(href)) continue;
    try {
      scored.push({ href: new URL(href, baseUrl).toString(), score });
    } catch {
      /* skip */
    }
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

function pickImage(item: Record<string, unknown>, html: string, baseUrl: string): string | undefined {
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
    if (isSafeUrl(candidate)) return new URL(candidate, baseUrl).toString();
  }
  // last resort: the first real image in the body
  const match = /<img\b[^>]*>/i.exec(html);
  const src = match ? attr(match[0], "src") : undefined;
  if (isSafeUrl(src)) {
    try {
      return new URL(src, baseUrl).toString();
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function normalizeItem(
  raw: Record<string, unknown>,
  baseUrl: string,
  index: number,
  channelAuthor: string,
): ParsedItem | null {
  const title = htmlToText(firstText(raw.title)).slice(0, 300);
  const link = pickLink(raw.link, baseUrl) || firstText(raw.guid);
  const contentHtml = [
    firstText(raw["content:encoded"]),
    firstText(raw.content),
    firstText(raw.description),
    firstText(raw.summary),
  ].find((x) => x && x.length > 0) ?? "";

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
  const summary = htmlToSummary(firstText(raw.description) || firstText(raw.summary) || contentHtml);
  const image = pickImage(raw, contentHtml, baseUrl);

  return {
    id: hashString(`${link || title}|${index}`).toString(36),
    title: title || "Untitled",
    link: isSafeUrl(link) ? link : undefined,
    author: author ? htmlToText(author).slice(0, 120) : undefined,
    publishedMs,
    summary: summary || htmlToText(contentHtml).slice(0, 220),
    body,
    image,
    truncated,
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
    channel = rdfRoot;
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
  const title = htmlToText(firstText(channel.title)) || new URL(feedUrl).hostname.replace(/^www\./, "");

  const items: ParsedItem[] = [];
  for (const [index, raw] of rawItems.slice(0, 40).entries()) {
    if (!raw || typeof raw !== "object") continue;
    const item = normalizeItem(raw as Record<string, unknown>, siteUrl, index, channelAuthor);
    if (item) items.push(item);
  }

  if (!items.length) throw new FeedError("That feed contains no readable entries.", 422);

  return {
    title: title.slice(0, 120),
    siteUrl,
    feedUrl,
    description: htmlToText(firstText(channel.description) || firstText(channel.subtitle) || firstText(channel.tagline)),
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
  for (const candidate of discovered.slice(0, 3)) {
    try {
      const next = await request(candidate.href);
      return parseFeedXml(next.body, next.finalUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof FeedError ? lastError : new FeedError("No readable feed was found.", 422);
}

/* ------------------------------------------------------------- shaping */

/** Deterministic stream rhythm for fetched stories, so live feeds sit in the same visual system as the seeded ones. */
export function layoutFor(index: number, hasImage: boolean, hasQuote: boolean): StoryLayout {
  if (hasQuote && index % 9 === 4) return "quote";
  if (index === 0) return hasImage ? "standard" : "compact";
  if (index % 7 === 3) return "brief";
  if (hasImage && index % 3 === 0) return "standard";
  return "compact";
}

export type { Story };
