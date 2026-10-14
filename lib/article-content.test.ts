import { describe, expect, it, vi } from "vitest";
import { ensureArticleContent } from "./article-content";
import { EXTRACTOR_VERSION } from "./refreshing";
import type { ArticleRecord, SourceRecord } from "./storage/types";
const now = Date.now();
const source: SourceRecord = {
  id: "body-source",
  title: "Body source",
  url: "https://example.org/feed",
  siteUrl: "https://example.org",
  host: "example.org",
  addedAt: now,
  fetchedAt: now,
  updatedAt: now,
};
const article: ArticleRecord = {
  id: "body-source~article",
  sourceId: source.id,
  title: "Original",
  link: "https://example.org/article",
  publishedAt: now,
  fetchedAt: now,
  summary: "Summary",
  body: [{ kind: "p", text: "Complete original body." }],
  minutes: 2,
  layout: "compact",
  contentState: "full",
  extractionState: "success",
  contentFetchedAt: now - 7 * 3600000,
  contentCheckedAt: now - 7 * 3600000,
  extractorVersion: EXTRACTOR_VERSION,
};
describe("shared article extraction", () => {
  it("keeps the previous complete body if a nominally successful response is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: true, article: { blocks: [] } }),
    );
    const result = await ensureArticleContent({ article, source, purpose: "briefing" });
    expect(result.fetched).toBe(false);
    expect(result.article.body).toEqual(article.body);
  });
  it("uses a fresh full RSS body without a new briefing extraction", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await ensureArticleContent({
      article: { ...article, id: "fresh-feed", contentFetchedAt: undefined },
      source,
      purpose: "briefing",
    });
    expect(result.fetched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
