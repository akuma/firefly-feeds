import { BRIEFING_BODY_LIMITS, BRIEFING_LIMITS } from "./constants";
import type { Block } from "../types";
import type { ArticleMaterial, ComposeInput } from "./types";

/**
 * What the second round is allowed to read.
 *
 * The budget is per article, and the sampling is deliberately not "the first
 * N characters": a body cut at the top hides its conclusion, and a conclusion
 * without its setup is what makes a model invent the middle. So a long body is
 * taken from its opening, its middle and its end — and whatever is cut is
 * recorded as cut (`excerpted`), because a model that read a slice must not be
 * treated as one that read the piece. See docs/specs/ai-daily-briefing.md §5.3.
 */

function blockText(block: Block): string | null {
  switch (block.kind) {
    case "p":
    case "h2":
    case "note":
    case "code":
      return block.text.trim() || null;
    case "quote":
      return block.cite ? `“${block.text.trim()}” — ${block.cite}` : `“${block.text.trim()}”`;
    case "list":
      return block.items.length ? block.items.map((item) => `· ${item.trim()}`).join("\n") : null;
    case "figure":
      // The caption is the publisher's own words and often carries the fact.
      return block.caption.trim() ? `[figure] ${block.caption.trim()}` : null;
    default:
      // An embed is a pointer to somewhere else; there is no text to judge.
      return null;
  }
}

type Span = { index: number; text: string };

function joinWithin(spans: readonly Span[], budget: number): Span[] {
  const kept: Span[] = [];
  let spent = 0;
  for (const span of spans) {
    const cost = span.text.length + (kept.length > 0 ? 2 : 0);
    if (spent + cost > budget) continue;
    kept.push(span);
    spent += cost;
  }
  return kept;
}

export function createArticleMaterial(input: {
  article: {
    id: string;
    title: string;
    link?: string;
    publishedAt: number;
    summary: string;
    body: Block[];
    contentState: "full" | "summary" | "truncated";
    contentFetchedAt?: number;
  };
  sourceName: string;
  limit?: number;
}): ArticleMaterial {
  const { article, sourceName } = input;
  const limit = input.limit ?? BRIEFING_LIMITS.composeArticleChars;
  const spans = article.body
    .map((block, index) => ({ index, text: blockText(block) }))
    .filter((span): span is Span => span.text !== null);

  const base: Omit<ArticleMaterial, "text" | "materialQuality" | "blockIndices"> = {
    articleId: article.id,
    sourceName,
    title: article.title,
    sourceUrl: article.link ?? null,
    publishedAt: article.publishedAt || null,
  };

  // No usable body: the feed's summary is all there is, and the model is told
  // so rather than being handed a short excerpt dressed as the article.
  if (spans.length === 0 || article.contentState === "summary") {
    return {
      ...base,
      materialQuality: "feed-summary",
      text: article.summary.trim().slice(0, limit),
    };
  }

  const total =
    spans.reduce((n, span) => n + span.text.length, 0) + Math.max(0, spans.length - 1) * 2;
  if (total <= limit) {
    return {
      ...base,
      materialQuality: article.contentState === "full" ? "full" : "excerpted",
      text: spans.map((s) => s.text).join("\n\n"),
      blockIndices: spans.map((s) => s.index),
    };
  }

  // Over budget: keep the opening, a slice of the middle and the ending, so a
  // summary of the material can still see how the piece begins and concludes.
  // A single oversized paragraph still has an opening and conclusion.
  const expanded = spans.flatMap((span) => {
    const size = Math.max(1, Math.floor((limit - 6) / 3));
    if (span.text.length <= size) return [span];
    return Array.from({ length: Math.ceil(span.text.length / size) }, (_, i) => ({
      index: span.index,
      text: span.text.slice(i * size, (i + 1) * size),
    }));
  });
  const third = Math.ceil(expanded.length / 3);
  const head = expanded.slice(0, third);
  const middle = expanded.slice(third, third * 2);
  const tail = expanded.slice(third * 2);
  const partBudget = Math.floor((limit - 4) / 3);
  const taken: Span[] = [
    ...joinWithin(head, partBudget),
    ...joinWithin(middle, partBudget),
    // The tail is taken from the end backwards, so the conclusion survives.
    ...joinWithin(tail.toReversed(), partBudget).toReversed(),
  ];
  taken.sort((a, b) => a.index - b.index);
  return {
    ...base,
    materialQuality: "excerpted",
    text: taken.map((s) => s.text).join("\n\n"),
    blockIndices: taken.map((s) => s.index),
  };
}

/** UTF-8 bytes, rather than characters, determine the transport's total budget. */
export function fitComposeInput(input: ComposeInput): ComposeInput {
  const budget = BRIEFING_BODY_LIMITS.compose - 4096;
  const encode = new TextEncoder();
  let fitted = input;
  let bytes = encode.encode(JSON.stringify(fitted)).byteLength;
  while (bytes > budget) {
    const ratio = Math.min(0.8, (budget / bytes) * 0.9);
    const materials = fitted.materials.map((material) => {
      const text = material.text;
      if (text.length < 30) return material;
      const part = Math.max(1, Math.floor((text.length * ratio) / 3) - 2);
      const middle = Math.floor(text.length / 2 - part / 2);
      return {
        ...material,
        materialQuality:
          material.materialQuality === "feed-summary"
            ? ("feed-summary" as const)
            : ("excerpted" as const),
        text: [text.slice(0, part), text.slice(middle, middle + part), text.slice(-part)].join(
          "\n\n",
        ),
      };
    });
    const next = { ...fitted, materials };
    const nextBytes = encode.encode(JSON.stringify(next)).byteLength;
    if (nextBytes >= bytes)
      throw new Error("The selected metadata exceeds the composition budget.");
    fitted = next;
    bytes = nextBytes;
  }
  return fitted;
}
