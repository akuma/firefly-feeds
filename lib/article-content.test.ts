import { describe, expect, it, vi } from "vitest";
import { ensureArticleContent, mergedArtwork } from "./article-content";
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
describe("mergedArtwork", () => {
  const row = {
    image: "https://cdn.test/feed.jpg?w=150",
    hasCover: true,
    layout: "compact" as const,
    summary: "Standfirst.",
  };

  it("keeps the feed thumbnail when the page names a different picture", () => {
    const artwork = mergedArtwork(row, {
      image: "https://cdn.test/page.jpg",
      hasCover: true,
    });
    expect(artwork.image).toBe("https://cdn.test/feed.jpg?w=150");
    expect(artwork.coverImage).toBe("https://cdn.test/page.jpg");
    expect(artwork.hasCover).toBe(true);
    expect(artwork.layout).toBe("standard");
  });

  it("treats a resized copy of the same photograph as the feed thumbnail", () => {
    const artwork = mergedArtwork(row, {
      image: "https://cdn.test/feed.jpg?w=1600",
      hasCover: true,
    });
    expect(artwork.image).toBe("https://cdn.test/feed.jpg?w=150");
    expect(artwork.coverImage).toBeUndefined();
    expect(artwork.hasCover).toBe(true);
  });

  it("fills a missing thumbnail from the page and promotes a compact row", () => {
    const artwork = mergedArtwork(
      { ...row, image: undefined, hasCover: undefined },
      { image: "https://cdn.test/page.jpg", hasCover: true },
    );
    expect(artwork.image).toBe("https://cdn.test/page.jpg");
    expect(artwork.coverImage).toBeUndefined();
    expect(artwork.hasCover).toBe(true);
    expect(artwork.layout).toBe("standard");
  });

  it("does not present a different feed thumbnail as the page cover", () => {
    const artwork = mergedArtwork(row, {
      image: "https://cdn.test/lede.jpg",
      hasCover: false,
    });
    expect(artwork.image).toBe("https://cdn.test/feed.jpg?w=150");
    expect(artwork.coverImage).toBeUndefined();
    expect(artwork.hasCover).toBe(false);
  });

  it("leaves a contents-page row as a contents-page row", () => {
    const artwork = mergedArtwork(
      { image: undefined, hasCover: undefined, layout: "brief", summary: "" },
      { image: "https://cdn.test/page.jpg", hasCover: true },
    );
    expect(artwork.image).toBe("https://cdn.test/page.jpg");
    expect(artwork.layout).toBe("brief");
  });
});

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

  it("persists the feed thumbnail and a distinct page cover", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ok: true,
        article: {
          blocks: [{ kind: "p", text: "The full piece." }],
          image: "https://cdn.test/page.jpg",
          hasCover: true,
        },
      }),
    );
    const result = await ensureArticleContent({
      article: {
        ...article,
        id: "body-source~thumb",
        image: "https://cdn.test/feed.jpg",
        hasCover: true,
        layout: "compact",
        contentFetchedAt: undefined,
        contentCheckedAt: undefined,
        extractorVersion: undefined,
      },
      source,
      purpose: "reader",
    });
    expect(result.article.image).toBe("https://cdn.test/feed.jpg");
    expect(result.article.coverImage).toBe("https://cdn.test/page.jpg");
    expect(result.article.layout).toBe("standard");
    vi.restoreAllMocks();
  });
});
