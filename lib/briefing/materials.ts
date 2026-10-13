import { BRIEFING_LIMITS } from "./constants";
import type { Block } from "../types";
import type { ArticleMaterial } from "./types";

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
  if (spans.length === 0) {
    return {
      ...base,
      materialQuality: "feed-summary",
      text: article.summary.trim().slice(0, limit),
    };
  }

  const total = spans.reduce((n, span) => n + span.text.length, 0);
  if (total <= limit) {
    return {
      ...base,
      materialQuality: "full",
      text: spans.map((s) => s.text).join("\n\n"),
      blockIndices: spans.map((s) => s.index),
    };
  }

  // Over budget: keep the opening, a slice of the middle and the ending, so a
  // summary of the material can still see how the piece begins and concludes.
  const third = Math.ceil(spans.length / 3);
  const head = spans.slice(0, third);
  const middle = spans.slice(third, third * 2);
  const tail = spans.slice(third * 2);
  const partBudget = Math.floor(limit / 3);
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
