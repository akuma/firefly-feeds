import { describe, expect, it } from "vitest";
import {
  ARTICLE_STALE_MS,
  articlesUnchanged,
  EXTRACTION_RETRY_MS,
  needsArticleRefresh,
  reconcileArticles,
  STALE_MS,
  staleSourceIds,
  type IncomingItem,
} from "./refreshing";
import type { ArticleRecord, SourceRecord } from "./storage/types";

function source(id: string, fetchedAt: number, extra?: Partial<SourceRecord>): SourceRecord {
  return {
    id,
    url: `https://${id}.example/feed.xml`,
    siteUrl: `https://${id}.example`,
    title: id,
    host: `${id}.example`,
    addedAt: 0,
    fetchedAt,
    error: null,
    updatedAt: 0,
    ...extra,
  };
}

const NOW = 1_000_000;

describe("staleSourceIds", () => {
  it("includes only sources older than the staleness window", () => {
    const ids = staleSourceIds(
      [
        source("fresh", NOW - (STALE_MS - 1)),
        source("edge", NOW - STALE_MS),
        source("stale", NOW - STALE_MS - 1),
      ],
      NOW,
    );
    expect(ids).toEqual(["stale", "edge"]);
  });

  it("orders oldest first", () => {
    const ids = staleSourceIds(
      [source("newer", NOW - 2 * STALE_MS), source("older", NOW - 5 * STALE_MS)],
      NOW,
    );
    expect(ids).toEqual(["older", "newer"]);
  });

  it("skips tombstoned sources", () => {
    const ids = staleSourceIds([source("gone", 0, { deletedAt: NOW })], NOW);
    expect(ids).toEqual([]);
  });
});

function incoming(id: string, extra?: Partial<IncomingItem>): IncomingItem {
  return {
    id,
    title: "A title",
    summary: "s",
    body: [{ kind: "p", text: "feed body" }],
    minutes: 1,
    layout: "compact",
    contentState: "summary",
    ...extra,
  };
}

function cached(id: string, extra?: Partial<ArticleRecord>): ArticleRecord {
  return {
    id,
    sourceId: "src",
    title: "A title",
    publishedAt: 1000,
    fetchedAt: 1000,
    summary: "s",
    body: [{ kind: "p", text: "feed body" }],
    minutes: 1,
    layout: "compact",
    contentState: "summary",
    extractionState: "idle",
    ...extra,
  };
}

describe("reconcileArticles", () => {
  it("is a no-op for an unchanged feed, apart from fetch timestamps", () => {
    const existing = [cached("src~a", { link: "https://e.test/a", publishedAt: 5000 })];
    const next = reconcileArticles(
      "src",
      [incoming("a", { link: "https://e.test/a", publishedMs: 5000 })],
      existing,
      9000,
    );
    expect(next[0].id).toBe("src~a");
    expect(next[0].publishedAt).toBe(5000);
    expect(next[0].fetchedAt).toBe(9000);
  });

  it("keeps the first-seen time for an entry with no published date", () => {
    const existing = [cached("src~a", { publishedAt: 4242 })];
    const next = reconcileArticles("src", [incoming("a")], existing, 9000);
    // without this the entry inherited Date.now() on every refresh and jumped
    expect(next[0].publishedAt).toBe(4242);
  });

  it("keeps locally extracted full text and does not reset it to the summary", () => {
    const fullBody = [{ kind: "p" as const, text: "the whole piece" }];
    const existing = [
      cached("src~a", {
        body: fullBody,
        contentState: "full",
        extractionState: "success",
        title: "Extracted title",
      }),
    ];
    const next = reconcileArticles(
      "src",
      [incoming("a", { title: "Extracted title", contentState: "summary" })],
      existing,
      9000,
    );
    expect(next[0].body).toEqual(fullBody);
    expect(next[0].contentState).toBe("full");
    expect(next[0].extractionState).toBe("success");
  });

  it("never re-arms a failed extraction when the feed still lacks the body", () => {
    const existing = [cached("src~a", { extractionState: "failed" })];
    const next = reconcileArticles(
      "src",
      [incoming("a", { contentState: "summary" })],
      existing,
      9000,
    );
    expect(next[0].extractionState).toBe("failed");
  });

  it("accepts the feed body when a failed feed starts shipping full content", () => {
    const existing = [cached("src~a", { extractionState: "failed" })];
    const next = reconcileArticles(
      "src",
      [incoming("a", { contentState: "full", body: [{ kind: "p", text: "now complete" }] })],
      existing,
      9000,
    );
    expect(next[0].extractionState).toBe("idle");
    expect(next[0].contentState).toBe("full");
  });

  it("includes genuinely new entries", () => {
    const next = reconcileArticles("src", [incoming("a"), incoming("b")], [], 9000);
    expect(next.map((a) => a.id)).toEqual(["src~a", "src~b"]);
    expect(next.every((a) => a.extractionState === "idle")).toBe(true);
  });

  it("keeps an original body when the feed refreshes", () => {
    const extracted = cached("src~a", {
      link: "https://e.test/a",
      body: [{ kind: "p", text: "Original body" }],
      contentState: "full",
      extractionState: "success",
      contentFetchedAt: 5000,
      contentCheckedAt: 5000,
    });
    const next = reconcileArticles(
      "src",
      [incoming("a", { link: "https://e.test/a", contentState: "summary" })],
      [extracted],
      9000,
    );
    expect(next[0].body).toEqual([{ kind: "p", text: "Original body" }]);
    expect(next[0].contentState).toBe("full");
    expect(next[0].contentCheckedAt).toBe(5000);
  });

  it("preserves a legacy successful extraction that predates the freshness fields", () => {
    const legacy = cached("src~a", {
      link: "https://e.test/a",
      body: [{ kind: "p", text: "Old extracted body" }],
      contentState: "full",
      extractionState: "success",
    });
    const next = reconcileArticles(
      "src",
      [incoming("a", { link: "https://e.test/a" })],
      [legacy],
      9000,
    );
    expect(next[0].body).toEqual([{ kind: "p", text: "Old extracted body" }]);
  });
});

describe("needsArticleRefresh", () => {
  const record = (extra?: Partial<ArticleRecord>) =>
    cached("src~a", { link: "https://e.test/a", ...extra });

  it("fetches a page that has never been fetched", () => {
    expect(needsArticleRefresh(record(), NOW)).toBe(true);
  });

  it("does not fetch when there is no article URL", () => {
    // a feed-native entry's body is canonical; there is nothing to get
    expect(needsArticleRefresh(cached("src~a"), NOW)).toBe(false);
  });

  it("leaves a fresh original body alone", () => {
    expect(
      needsArticleRefresh(
        record({ contentFetchedAt: NOW - 1000, contentCheckedAt: NOW - 1000 }),
        NOW,
      ),
    ).toBe(false);
  });

  it("revalidates an original body once it is stale", () => {
    expect(
      needsArticleRefresh(
        record({
          contentFetchedAt: NOW - ARTICLE_STALE_MS,
          contentCheckedAt: NOW - ARTICLE_STALE_MS,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("does not retry a failure inside the retry window", () => {
    expect(
      needsArticleRefresh(record({ extractionState: "failed", contentCheckedAt: NOW - 1000 }), NOW),
    ).toBe(false);
  });

  it("allows a retry once the retry window has passed", () => {
    expect(
      needsArticleRefresh(
        record({
          extractionState: "failed",
          contentCheckedAt: NOW - EXTRACTION_RETRY_MS - 1,
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("articlesUnchanged", () => {
  it("treats a refreshed-but-identical feed as unchanged", () => {
    const existing = [
      cached("src~a", {
        link: "https://e.test/a",
        publishedAt: 5000,
        title: "Same title",
        fetchedAt: 1000,
      }),
    ];
    const next = reconcileArticles(
      "src",
      [incoming("a", { link: "https://e.test/a", publishedMs: 5000, title: "Same title" })],
      existing,
      9000,
    );
    // fetchedAt moved with the fetch, but the content is the same
    expect(next[0].fetchedAt).toBe(9000);
    expect(articlesUnchanged(existing, next)).toBe(true);
  });

  it("regards a locally enriched record with only a new fetchedAt as unchanged", () => {
    const existing = [cached("src~a", { contentState: "full", extractionState: "success" })];
    const next = reconcileArticles("src", [incoming("a")], existing, 9000);
    expect(articlesUnchanged(existing, next)).toBe(true);
  });

  it("notices a new entry", () => {
    const existing = [cached("src~a")];
    const next = reconcileArticles("src", [incoming("a"), incoming("b")], existing, 9000);
    expect(articlesUnchanged(existing, next)).toBe(false);
  });

  it("notices an entry that left the feed", () => {
    const existing = [cached("src~a"), cached("src~b")];
    const next = reconcileArticles("src", [incoming("a")], existing, 9000);
    expect(articlesUnchanged(existing, next)).toBe(false);
  });

  it("notices a changed title even when ids line up", () => {
    const existing = [cached("src~a", { title: "Old title" })];
    const next = reconcileArticles("src", [incoming("a", { title: "New title" })], existing, 9000);
    expect(articlesUnchanged(existing, next)).toBe(false);
  });

  it("compares block contents rather than block references", () => {
    const existing = [cached("src~a", { body: [{ kind: "p", text: "Same prose." }] })];
    const next = reconcileArticles(
      "src",
      [incoming("a", { body: [{ kind: "p", text: "Same prose." }] })],
      existing,
      9000,
    );
    // fresh block objects, identical contents
    expect(next[0].body).not.toBe(existing[0].body);
    expect(articlesUnchanged(existing, next)).toBe(true);
  });

  it("notices changed text inside a block", () => {
    const existing = [cached("src~a", { body: [{ kind: "p", text: "Old prose." }] })];
    const next = reconcileArticles(
      "src",
      [incoming("a", { body: [{ kind: "p", text: "New prose." }] })],
      existing,
      9000,
    );
    expect(articlesUnchanged(existing, next)).toBe(false);
  });

  it("compares every field of non-paragraph blocks", () => {
    const existing = [
      cached("src~a", {
        body: [{ kind: "figure", caption: "Plate", seed: 7, src: "https://e.test/p.jpg" }],
      }),
    ];
    const changedImage = reconcileArticles(
      "src",
      [
        incoming("a", {
          body: [{ kind: "figure", caption: "Plate", seed: 7, src: "https://e.test/q.jpg" }],
        }),
      ],
      existing,
      9000,
    );
    const changedSeed = reconcileArticles(
      "src",
      [incoming("a", { body: [{ kind: "figure", caption: "Plate", seed: 8 }] })],
      existing,
      9000,
    );
    expect(articlesUnchanged(existing, changedImage)).toBe(false);
    expect(articlesUnchanged(existing, changedSeed)).toBe(false);
  });

  it("compares list block items", () => {
    const existing = [cached("src~a", { body: [{ kind: "list", items: ["one", "two"] }] })];
    const same = reconcileArticles(
      "src",
      [incoming("a", { body: [{ kind: "list", items: ["one", "two"] }] })],
      existing,
      9000,
    );
    const changed = reconcileArticles(
      "src",
      [incoming("a", { body: [{ kind: "list", items: ["one", "three"] }] })],
      existing,
      9000,
    );
    expect(articlesUnchanged(existing, same)).toBe(true);
    expect(articlesUnchanged(existing, changed)).toBe(false);
  });
});
