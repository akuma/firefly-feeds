import { describe, expect, it } from "vitest";
import { reconcileArticles, STALE_MS, staleSourceIds, type IncomingItem } from "./refreshing";
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
    title: id,
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
    title: id,
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

  it("bridges a cached record across the id change via its link", () => {
    // the old id was hash(link|index); the new one is hash(guid-or-link)
    const existing = [cached("src~oldhash", { link: "https://e.test/a" })];
    const next = reconcileArticles(
      "src",
      [incoming("newhash", { link: "https://e.test/a" })],
      existing,
      9000,
    );
    expect(next[0].id).toBe("src~oldhash");
  });

  it("includes genuinely new entries", () => {
    const next = reconcileArticles("src", [incoming("a"), incoming("b")], [], 9000);
    expect(next.map((a) => a.id)).toEqual(["src~a", "src~b"]);
    expect(next.every((a) => a.extractionState === "idle")).toBe(true);
  });
});
