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
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function absolute(url: string, base?: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Publisher boilerplate that has no business appearing in a reading surface. */
function scrub(s: string): string {
  return s
    .replace(/\s*(Read more|Continue reading|Read the full (?:post|article|story)|The post .{0,120}? appeared first on .{0,80}?\.?)\s*[»→….]*\s*$/i, " ")
    .replace(/\s*\[…\]\s*$/, " ")
    .replace(/\s*The post .{0,120}? appeared first on .{0,80}?\.?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove images that are really tracking pixels, spacers, or share badges. */
function isMeaningfulImage(tag: string): boolean {
  const w = Number(attr(tag, "width") ?? 0);
  const h = Number(attr(tag, "height") ?? 0);
  if ((w && w <= 64) || (h && h <= 64)) return false;
  const src = attr(tag, "src") ?? "";
  if (/feedburner|feeds\.wordpress|pixel|spacer|1x1|doubleclick|gravatar|avatar/i.test(src)) return false;
  const alt = (attr(tag, "alt") ?? "").trim();
  if (/^(share|tweet|facebook|linkedin|whatsapp|email|print)$/i.test(alt)) return false;
  return true;
}

/** Bodies are cached in the browser, so they need a ceiling. */
const DEFAULT_BUDGET = { blocks: 60, chars: 8_000 };

export type Extraction = { blocks: Block[]; truncated: boolean };

export function htmlToBlocks(
  input: string,
  baseUrl?: string,
  budget = DEFAULT_BUDGET,
): Extraction {
  if (!input) return { blocks: [], truncated: false };

  let s = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|noscript|iframe|svg|canvas|form|button|select|textarea|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|input|link|meta|source|track)\b[^>]*\/?>/gi, "");

  const vault: Block[] = [];
  const hold = (block: Block) => {
    vault.push(block);
    return `\u0000${vault.length - 1}\u0000`;
  };

  // ---------------------------------------------------------- figures
  s = s.replace(/<figure\b[^>]*>([\s\S]*?)<\/figure\s*>/gi, (_m, inner: string) => {
    const img = /<img\b[^>]*>/i.exec(inner);
    if (!img || !isMeaningfulImage(img[0])) return "";
    const src = attr(img[0], "src");
    if (!isSafeUrl(src)) return "";
    const caption = text(inner.replace(/<img\b[^>]*>/gi, "")) || attr(img[0], "alt") || "";
    return hold({ kind: "figure", src: absolute(src, baseUrl), caption, seed: hashString(src) });
  });

  s = s.replace(/<img\b[^>]*>/gi, (tag: string) => {
    if (!isMeaningfulImage(tag)) return "";
    const src = attr(tag, "src");
    if (!isSafeUrl(src)) return "";
    return hold({
      kind: "figure",
      src: absolute(src, baseUrl),
      caption: attr(tag, "alt") ?? "",
      seed: hashString(src),
    });
  });

  // -------------------------------------------------------- structure
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_m, inner: string) => {
    const body = text(inner.replace(/<\/?(cite|footer)\b[^>]*>/gi, " "));
    if (body.length < 12) return "";
    const cite = /<cite\b[^>]*>([\s\S]*?)<\/cite\s*>/i.exec(inner);
    return hold({ kind: "quote", text: scrub(body).slice(0, 700), cite: cite ? text(cite[1]).slice(0, 120) : undefined });
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
    const clean = chunk.replace(/[ \t]+/g, " ").replace(/\n/g, " ").trim();
    if (!clean) continue;
    // a chunk is either a held block, body text, or body text wrapped around held blocks
    for (const piece of clean.split(/(\u0000\d+\u0000)/)) {
      if (!piece) continue;
      const token = /^\u0000(\d+)\u0000$/.exec(piece);
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

/** Plain-text standfirst for the stream, from whatever HTML the feed offers. */
export function htmlToSummary(input: string, limit = 260): string {
  if (!input) return "";
  const stripped = scrub(
    htmlToText(input)
  );
  if (stripped.length <= limit) return stripped;
  const cut = stripped.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${(stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut).trim()}…`;
}

export function htmlToText(input: string): string {
  return decodeEntities(
    input
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr)\s*>/gi, "\n\n")
      .replace(/<br\b[^>]*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
