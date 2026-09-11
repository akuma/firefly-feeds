import { hashString } from "./hash";
import type { Block } from "./types";

export { hashString };

/**
 * Feed bodies arrive as arbitrary HTML. Rather than sanitise and inject it, we
 * translate it into the reader's own block model. That means no
 * `dangerouslySetInnerHTML`, no sanitiser dependency, and — more usefully —
 * fetched stories inherit exactly the same typography as the rest of the
 * product instead of smuggling in a publisher's own stylesheet.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "“",
  ldquo: "“",
  sbquo: "‚",
  bdquo: "„",
  times: "×",
  middot: "·",
  bull: "•",
  dagger: "†",
  deg: "°",
  laquo: "«",
  raquo: "»",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  copy: "©",
  reg: "®",
  trade: "™",
  frac12: "½",
  frac14: "¼",
  prime: "′",
  Prime: "″",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      if (code >= 0xd800 && code <= 0xdfff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[entity] ?? ENTITIES[entity.toLowerCase()] ?? m;
  });
}

function text(html: string): string {
  return (
    decodeEntities(html.replace(/<[^>]*>/g, " "))
      // feed bodies carry stray control characters that would corrupt the layout
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3] ?? "";
  return decodeEntities(raw).trim() || undefined;
}

export function isSafeUrl(url: string | undefined): url is string {
  if (!url) return false;
  const u = url.trim();
  if (u.startsWith("//")) return true;
  return /^https?:\/\//i.test(u);
}

/**
 * Absolute-ises a URL against the document it came from, then decides whether
 * it is safe to fetch. Order matters: feeds routinely publish `src="/photo.jpg"`
 * or `<link href="/entry">`, and testing safety *before* resolution threw those
 * away — which silently broke images and made Atom `rel="alternate"` lose to
 * `rel="self"`.
 */
export function resolveUrl(raw: string | undefined, base?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (!base) return undefined;
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Publisher boilerplate that has no business appearing in a reading surface.
 * The WordPress trailer is matched loosely — the title between "The post" and
 * "appeared first on" is often absent, which an over-specified pattern misses.
 */
function scrub(s: string): string {
  return s
    .replace(/\s*The post\b[\s\S]{0,200}?appeared first on\b[\s\S]{0,160}?\.?\s*$/i, " ")
    .replace(
      /\s*(Read more|Continue reading|Read the full (?:post|article|story)|View comments)\s*[»→….]*\s*$/i,
      " ",
    )
    .replace(/\s*\[…\]\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove images that are really tracking pixels, spacers, or share badges. */
function isMeaningfulImage(tag: string): boolean {
  const w = Number(attr(tag, "width") ?? 0);
  const h = Number(attr(tag, "height") ?? 0);
  if ((w && w <= 64) || (h && h <= 64)) return false;
  const src = attr(tag, "src") ?? "";
  if (/feedburner|feeds\.wordpress|pixel|spacer|1x1|doubleclick|gravatar|avatar/i.test(src))
    return false;
  const alt = (attr(tag, "alt") ?? "").trim();
  if (/^(share|tweet|facebook|linkedin|whatsapp|email|print)$/i.test(alt)) return false;
  return true;
}

/** Bodies are cached in the browser, so they need a ceiling. */
const DEFAULT_BUDGET = { blocks: 60, chars: 8_000 };

export type Extraction = { blocks: Block[]; truncated: boolean };

export function htmlToBlocks(input: string, baseUrl?: string, budget = DEFAULT_BUDGET): Extraction {
  if (!input) return { blocks: [], truncated: false };

  let s = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|head|noscript|iframe|svg|canvas|form|button|select|textarea|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<(script|style|iframe|input|link|meta|source|track)\b[^>]*\/?>/gi, "");

  const vault: Block[] = [];
  const hold = (block: Block) => {
    vault.push(block);
    return `\uE000${vault.length - 1}\uE000`;
  };

  // ---------------------------------------------------------- figures
  s = s.replace(/<figure\b[^>]*>([\s\S]*?)<\/figure\s*>/gi, (_m, inner: string) => {
    const img = /<img\b[^>]*>/i.exec(inner);
    if (!img || !isMeaningfulImage(img[0])) return "";
    const src = resolveUrl(attr(img[0], "src"), baseUrl);
    if (!src) return "";
    const caption = text(inner.replace(/<img\b[^>]*>/gi, "")) || attr(img[0], "alt") || "";
    return hold({ kind: "figure", src, caption, seed: hashString(src) });
  });

  s = s.replace(/<img\b[^>]*>/gi, (tag: string) => {
    if (!isMeaningfulImage(tag)) return "";
    const src = resolveUrl(attr(tag, "src"), baseUrl);
    if (!src) return "";
    return hold({
      kind: "figure",
      src,
      caption: attr(tag, "alt") ?? "",
      seed: hashString(src),
    });
  });

  // -------------------------------------------------------- structure
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_m, inner: string) => {
    const body = text(inner.replace(/<\/?(cite|footer)\b[^>]*>/gi, " "));
    if (body.length < 12) return "";
    const cite = /<cite\b[^>]*>([\s\S]*?)<\/cite\s*>/i.exec(inner);
    return hold({
      kind: "quote",
      text: scrub(body).slice(0, 700),
      cite: cite ? text(cite[1]).slice(0, 120) : undefined,
    });
  });

  s = s.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (_m, inner: string) => {
    const body = text(inner);
    if (body.length < 3 || body.length > 180) return "";
    return hold({ kind: "h2", text: scrub(body) });
  });

  s = s.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _tag: string, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)]
      .map((x) => scrub(text(x[1])))
      .filter((x) => x.length > 1 && x.length < 400);
    if (items.length < 2) return "";
    return hold({ kind: "list", items: items.slice(0, 12) });
  });

  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => {
    const body = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/^\n+|\n+$/g, "");
    if (!body.trim()) return "";
    return hold({ kind: "code", text: body.slice(0, 1400) });
  });

  s = s.replace(/<hr\b[^>]*\/?>/gi, "\n\n");

  // ------------------------------------------------------- paragraphs
  s = s
    .replace(/<br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|tr|li|dd|dt|td|th)\s*>/gi, "\n\n")
    .replace(/<(p|div|section|article|main|tr|li|dd|dt|td|th)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");

  const blocks: Block[] = [];
  let spent = 0;
  let truncated = false;
  const budgetReached = () => {
    if (blocks.length >= budget.blocks || spent >= budget.chars) {
      truncated = true;
      return true;
    }
    return false;
  };

  for (const chunk of decodeEntities(s).split(/\n{2,}/)) {
    const clean = chunk
      .replace(/[ \t]+/g, " ")
      .replace(/\n/g, " ")
      .trim();
    if (!clean) continue;
    // a chunk is either a held block, body text, or body text wrapped around held blocks
    for (const piece of clean.split(/(\uE000\d+\uE000)/)) {
      if (!piece) continue;
      const token = /^\uE000(\d+)\uE000$/.exec(piece);
      if (token) {
        const block = vault[Number(token[1])];
        if (block) blocks.push(block);
        spent += 120;
        continue;
      }
      const body = scrub(piece.replace(/\s+/g, " ").trim());
      if (body.length < 2) continue;
      if (body.length > 2400) {
        // split runaway paragraphs at sentence boundaries
        const sentences = body.match(/[^.!?]+[.!?]+["'”’)]?\s*/g) ?? [body];
        let buf = "";
        for (const sentence of sentences) {
          if ((buf + sentence).length > 900) {
            if (buf) blocks.push({ kind: "p", text: buf.trim() });
            buf = sentence;
          } else {
            buf += sentence;
          }
        }
        if (buf.trim()) blocks.push({ kind: "p", text: buf.trim() });
      } else {
        blocks.push({ kind: "p", text: body });
      }
      spent += body.length;
      if (budgetReached()) break;
    }
    if (budgetReached()) break;
  }

  // collapse identical neighbours (a common double-render in feed templates)
  const deduped = blocks.filter((b, i) => {
    const prev = blocks[i - 1];
    if (!prev || prev.kind !== b.kind) return true;
    if (b.kind === "p" && prev.kind === "p") return prev.text !== b.text;
    return true;
  });

  // a trailing "End of story" on a cut-off body would be a lie
  if (deduped.length && deduped[deduped.length - 1].kind === "p" && truncated) {
    // keep it — the caller flags truncation in the UI
  }

  return { blocks: deduped, truncated };
}

/**
 * The opening that every entry in a feed shares, if there is one.
 *
 * Plenty of publications start every post with the same block — a subscription
 * pitch, a house style note, a mailing address. It is real content, but it is
 * identical in every entry, so a summary built from it tells the reader nothing:
 * a column of rows that all read the same. Measured on 阮一峰的网络日志, the
 * shared opening is 96 characters, which is the whole of what every row showed.
 *
 * Returns "" when the entries share nothing worth removing, which is the common
 * case. The result is trimmed back to a sentence boundary so stripping it never
 * leaves a dangling fragment.
 */
export function sharedOpening(texts: string[], minimum = 60): string {
  const samples = texts.filter((value) => value.length > 0);
  if (samples.length < 3) return "";

  let prefix = samples[0];
  for (const sample of samples.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < sample.length && prefix[i] === sample[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }

  // cut at the last sentence end so the remainder still starts cleanly
  const boundaries = ["。", "！", "？", "；", ". ", "! ", "? ", "; "];
  let cut = -1;
  for (const mark of boundaries) cut = Math.max(cut, prefix.lastIndexOf(mark));
  const trimmed = cut >= 0 ? prefix.slice(0, cut + 1) : prefix;

  return trimmed.trim().length >= minimum ? trimmed : "";
}

/** Plain-text standfirst for the stream, from whatever HTML the feed offers. */
export function htmlToSummary(input: string, limit = 260): string {
  if (!input) return "";
  const stripped = scrub(htmlToText(input));
  if (stripped.length <= limit) return stripped;
  const cut = stripped.slice(0, limit);
  const stop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("。"),
    cut.lastIndexOf("！"),
    cut.lastIndexOf("？"),
  );
  return `${(stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut).trim()}…`;
}

export function htmlToText(input: string): string {
  return decodeEntities(
    input
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr)\s*>/gi, "\n\n")
      .replace(/<br\b[^>]*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The plain text of a block list, paragraphs only, whitespace collapsed.
 * Used to tell a body that *is* the summary from one that merely resembles it.
 */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => (block.kind === "p" ? block.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A “keep reading” stub dressed up as content.
 *
 * Some feeds put a short “Read more” / “Continue reading” paragraph (or its
 * Chinese equivalent) at the end of an entry that otherwise looks like a full
 * body. It came from `content:encoded`, but it is a signpost, not the article.
 *
 * Read from the raw HTML, not the block model: `scrub` already strips these
 * phrases from a block, so by the time the blocks exist the evidence is gone.
 * Only the tail is examined — scanning the whole body would downgrade an
 * article *about* “read more” links.
 */
const READ_MORE_CUE =
  /(read more|continue reading|read the full|full (?:article|story)|阅读全文|阅读原文|全文)/i;

export function hasReadMoreCue(input: string): boolean {
  const body = htmlToText(input);
  return body.length > 0 && READ_MORE_CUE.test(body.slice(-160));
}
