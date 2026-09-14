import { Readability } from "@mozilla/readability";
import Defuddle from "defuddle";
import { documentFor } from "./article-server";
import { ARTICLE_BODY_BUDGET, htmlToBlocks, htmlToText } from "./feed-html";
import type { ExtractOptions, ExtractOutput } from "./lab-types";
import type { Block } from "./types";

/**
 * Server-only helpers for the extractor-comparison lab (`/lab/compare`).
 *
 * Both libraries run on the same fetched HTML so the difference in what each
 * one keeps is the only variable. This is a development tool; the product path
 * uses Defuddle alone in `article-server.ts`.
 */

function summarize(
  blocks: Block[],
  truncated: boolean,
): Pick<ExtractOutput, "imageCount" | "blocks" | "truncated"> {
  return {
    imageCount: blocks.filter((block) => block.kind === "figure" || block.kind === "video").length,
    blocks,
    truncated,
  };
}

export function runReadability(html: string, url: string, options: ExtractOptions): ExtractOutput {
  const started = performance.now();
  let contentHtml = "";
  let title: string | undefined;
  let author: string | undefined;
  let published: string | undefined;
  let site: string | undefined;
  try {
    const parsed = new Readability(documentFor(html, url), {
      charThreshold: options.charThreshold ?? 500,
      keepClasses: options.keepClasses ?? false,
    }).parse();
    contentHtml = parsed?.content ?? "";
    title = parsed?.title?.trim() || undefined;
    author = parsed?.byline?.trim() || undefined;
    published = parsed?.publishedTime?.trim() || undefined;
    site = parsed?.siteName?.trim() || undefined;
  } catch {
    /* leave the empty result so the panel shows the failure */
  }
  const { blocks, truncated } = htmlToBlocks(contentHtml, url, ARTICLE_BODY_BUDGET);
  return {
    title,
    author,
    published,
    site,
    contentHtml,
    textLength: htmlToText(contentHtml).length,
    ...summarize(blocks, truncated),
    ms: Math.round(performance.now() - started),
  };
}

export function runDefuddle(html: string, url: string, options: ExtractOptions): ExtractOutput {
  const started = performance.now();
  let contentHtml = "";
  let title: string | undefined;
  let author: string | undefined;
  let published: string | undefined;
  let site: string | undefined;
  let image: string | undefined;
  try {
    const parsed = new Defuddle(documentFor(html, url), {
      url,
      useAsync: false,
      removeLowScoring: options.removeLowScoring ?? true,
      removeHiddenElements: options.removeHiddenElements ?? true,
      removeSmallImages: options.removeSmallImages ?? true,
      includeReplies: options.includeReplies ?? false,
      standardize: options.standardize ?? true,
    }).parse();
    contentHtml = parsed.content ?? "";
    title = parsed.title?.trim() || undefined;
    author = parsed.author?.trim() || undefined;
    published = parsed.published?.trim() || undefined;
    site = parsed.site?.trim() || undefined;
    image = parsed.image?.trim() || undefined;
  } catch {
    /* leave the empty result so the panel shows the failure */
  }
  const { blocks, truncated } = htmlToBlocks(contentHtml, url, ARTICLE_BODY_BUDGET);
  return {
    title,
    author,
    published,
    site,
    image,
    contentHtml,
    textLength: htmlToText(contentHtml).length,
    ...summarize(blocks, truncated),
    ms: Math.round(performance.now() - started),
  };
}
