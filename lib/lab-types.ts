import type { Block } from "./types";

/**
 * Shapes shared by the local extractor-comparison lab. Kept free of the
 * extractor libraries so the client page can import them without pulling
 * Readability or Defuddle into the browser bundle.
 */

export type ExtractOptions = {
  /** Readability: minimum characters before a candidate counts as content. */
  charThreshold?: number;
  /** Readability: keep the publisher's own class names in the output. */
  keepClasses?: boolean;
  /** Defuddle: drop non-content blocks by score (nav, related links, …). */
  removeLowScoring?: boolean;
  /** Defuddle: drop elements hidden by the page's own CSS. */
  removeHiddenElements?: boolean;
  /** Defuddle: drop small images (icons, tracking pixels). */
  removeSmallImages?: boolean;
  /** Defuddle: keep comment/reply threads. */
  includeReplies?: boolean;
  /** Defuddle: standardise footnotes, headings and code blocks. */
  standardize?: boolean;
};

export type ExtractOutput = {
  title?: string;
  author?: string;
  published?: string;
  site?: string;
  image?: string;
  /** The library's cleaned HTML, before our block conversion. */
  contentHtml: string;
  /** Characters of visible text. */
  textLength: number;
  /** Figures our own block conversion kept. */
  imageCount: number;
  blocks: Block[];
  truncated: boolean;
  /** Milliseconds the extraction took. */
  ms: number;
};

export type CompareResponse =
  | {
      ok: true;
      url: string;
      readability: ExtractOutput;
      defuddle: ExtractOutput;
    }
  | { ok: false; error: string };

/** A one-line description of a block, for the lab's block previews. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case "p":
    case "h2":
    case "quote":
    case "note":
    case "code":
      return block.text;
    case "list":
      return block.items.join(" · ");
    case "figure":
      return block.caption
        ? `${block.src ?? "(figure)"} — ${block.caption}`
        : (block.src ?? "(figure)");
    case "video":
      return `${block.provider}:${block.id}`;
    case "rule":
      return "—";
    default:
      return "";
  }
}

/** The paragraph-like texts of a block list, in order. */
export function paragraphTexts(blocks: Block[]): string[] {
  return blocks
    .filter(
      (block): block is Extract<Block, { kind: "p" | "h2" | "quote" | "note" }> =>
        block.kind === "p" ||
        block.kind === "h2" ||
        block.kind === "quote" ||
        block.kind === "note",
    )
    .map((block) => block.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export type DiffLine = { kind: "same" | "onlyA" | "onlyB"; text: string };

/**
 * A tiny ordered diff of two paragraph lists. Paragraphs are matched by exact
 * text, and anything unmatched is reported as unique to its side — enough to
 * see at a glance that one library kept the comments or the related-articles
 * box and the other dropped them.
 */
export function diffParagraphs(a: string[], b: string[]): DiffLine[] {
  const setA = new Set(a);
  const setB = new Set(b);
  return [
    ...a.map((text): DiffLine => ({ kind: setB.has(text) ? "same" : "onlyA", text })),
    ...b.filter((text) => !setA.has(text)).map((text): DiffLine => ({ kind: "onlyB", text })),
  ];
}
