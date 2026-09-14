import { deleteDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord, ReadingRecord, SourceRecord } from "./types";

const FEED_URL = "https://example.com/feed.xml";

/**
 * The repository memoises its connection and seeds on first open, so each test
 * needs both a fresh module graph and a fresh database: close the previous
 * connection, drop the module registry, delete the store, re-import.
 */
let previous: typeof import("./db") | undefined;

async function freshRepository() {
  if (previous) {
    await previous.close();
    previous = undefined;
  }
  vi.resetModules();
  await deleteDB("firefly-feeds").catch(() => {});
  previous = await import("./db");
  return import("./repository");
}

beforeEach(() => {
  localStorage.clear();
});

/* --------------------------------------------------------------- seeding */

describe("first run", () => {
  it("opens a database under the name the product uses", async () => {
    const repo = await freshRepository();
    await repo.loadAll();
    expect((await indexedDB.databases()).map((d) => d.name)).toEqual(["firefly-feeds"]);
  });

  it("seeds the curated reading states and nothing else", async () => {
    const repo = await freshRepository();
    const snapshot = await repo.loadAll();

    expect(snapshot.sources).toEqual([]);
    expect(snapshot.articles).toEqual([]);

    const ids = snapshot.reading.map((r) => r.id).toSorted();
    expect(ids).toContain("screen-typography");
    expect(ids).toContain("web-we-lost");
    // timestamps are what a sync client diffs on
    expect(snapshot.reading.every((r) => typeof r.updatedAt === "number")).toBe(true);
  });

  it("does not seed twice", async () => {
    const repo = await freshRepository();
    const first = await repo.loadAll();
    const second = await repo.loadAll();
    expect(second.reading).toHaveLength(first.reading.length);
  });
});

/* --------------------------------------------------------------- caching */

const source = (id: string, url = FEED_URL): SourceRecord => ({
  id,
  url,
  siteUrl: "https://example.com",
  title: "Example",
  host: "example.com",
  folder: "independent",
  addedAt: 1,
  fetchedAt: 1,
  updatedAt: 1,
});

const article = (id: string, sourceId: string): ArticleRecord => ({
  id,
  sourceId,
  title: id,
  publishedAt: 1,
  fetchedAt: 1,
  summary: "",
  body: [],
  minutes: 1,
  layout: "compact",
  contentState: "full",
  extractionState: "idle",
});

/* ---------------------------------------------------------- adoption */

/* --------------------------------------------------------------- caching */

describe("article cache", () => {
  it("evicts stale entries on refresh", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    await repo.replaceArticles("s1", [article("s1~a", "s1"), article("s1~b", "s1")]);
    expect(await repo.getArticles("s1")).toHaveLength(2);

    await repo.replaceArticles("s1", [article("s1~b", "s1"), article("s1~c", "s1")]);
    expect((await repo.getArticles("s1")).map((a) => a.id).toSorted()).toEqual(["s1~b", "s1~c"]);
  });

  it("never evicts an article the reader kept", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    await repo.replaceArticles("s1", [article("s1~saved", "s1"), article("s1~gone", "s1")]);

    await repo.replaceArticles("s1", [article("s1~new", "s1")], new Set(["s1~saved"]));

    expect((await repo.getArticles("s1")).map((a) => a.id).toSorted()).toEqual([
      "s1~new",
      "s1~saved",
    ]);
  });

  it("scopes reads to their source", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    await repo.putSource(source("s2", "https://other.example/feed"));
    await repo.replaceArticles("s1", [article("s1~a", "s1")]);
    await repo.replaceArticles("s2", [article("s2~a", "s2")]);
    expect((await repo.getArticles("s1")).map((a) => a.id)).toEqual(["s1~a"]);
  });

  it("reads a legacy record that predates the content freshness fields", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    // the shape written before contentFetchedAt / contentCheckedAt / etag
    await repo.replaceArticles("s1", [article("s1~a", "s1")]);
    const [saved] = await repo.getArticles("s1");
    expect(saved.contentFetchedAt).toBeUndefined();
    expect(saved.contentCheckedAt).toBeUndefined();
    expect(saved.body).toEqual([]);
  });
});

/* --------------------------------------------------------------- sources */

describe("sources", () => {
  it("tombstones instead of deleting, and hides it from reads", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    await repo.removeSource("s1");

    expect((await repo.loadAll()).sources).toEqual([]);
    const raw = await repo.getSource("s1");
    expect(raw?.deletedAt).toBeGreaterThan(0);
    expect(raw?.updatedAt).toBeGreaterThan(0);
  });

  it("drops a removed source's cached articles", async () => {
    const repo = await freshRepository();
    await repo.putSource(source("s1"));
    await repo.replaceArticles("s1", [article("s1~a", "s1")]);
    await repo.removeSource("s1");
    expect(await repo.getArticles("s1")).toEqual([]);
  });
});

/* ------------------------------------------------------------- sync seam */

const readingAt = (id: string, updatedAt: number, read: boolean): ReadingRecord => ({
  id,
  read,
  updatedAt,
});

describe("sync primitives", () => {
  const sourceAt = (updatedAt: number, deletedAt?: number): SourceRecord => ({
    ...source("s1"),
    updatedAt,
    deletedAt,
  });

  it("reports only what changed after the watermark", async () => {
    const repo = await freshRepository();
    await repo.putSource(sourceAt(Date.now() - 10_000));
    await repo.putReading(readingAt("old", Date.now() - 10_000, true));

    const watermark = (await repo.changesSince(0)).watermark;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const now = Date.now();
    await repo.putSource(sourceAt(now));
    await repo.putReading(readingAt("new", now, true));

    const changes = await repo.changesSince(watermark);
    expect(changes.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(changes.reading.map((r) => r.id)).toEqual(["new"]);
    expect(changes.watermark).toBeGreaterThanOrEqual(now);
  });

  it("resolves conflicts last-write-wins", async () => {
    const repo = await freshRepository();
    await repo.putReading(readingAt("a", 2_000, true));

    await repo.mergeChangeset({
      watermark: 0,
      sources: [],
      reading: [readingAt("a", 1_000, false)],
    });
    expect((await repo.loadAll()).reading[0].read).toBe(true);

    await repo.mergeChangeset({
      watermark: 0,
      sources: [],
      reading: [readingAt("a", 3_000, false)],
    });
    expect((await repo.loadAll()).reading[0].read).toBe(false);

    // an identical timestamp still converges, and does not thrash
    await repo.mergeChangeset({
      watermark: 0,
      sources: [],
      reading: [readingAt("a", 3_000, false)],
    });
    const stored = (await repo.loadAll()).reading.filter((r) => r.id === "a");
    expect(stored).toHaveLength(1);
  });

  it("lets a deletion win a tie, so removals are not resurrected", async () => {
    const repo = await freshRepository();
    await repo.putSource(sourceAt(5_000));

    await repo.mergeChangeset({ watermark: 0, sources: [sourceAt(5_000, 5_000)], reading: [] });
    expect((await repo.getSource("s1"))?.deletedAt).toBe(5_000);
  });

  it("keeps tombstones in the changeset so deletes can replicate", async () => {
    const repo = await freshRepository();
    await repo.putSource(sourceAt(1));
    await repo.removeSource("s1");
    expect((await repo.changesSince(0)).sources.some((s) => s.deletedAt)).toBe(true);
  });
});

describe("clearAll", () => {
  it("empties every user-data store", async () => {
    const repo = await freshRepository();
    await repo.clearAll();
    const snapshot = await repo.loadAll();
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.articles).toEqual([]);
    expect(snapshot.reading).toEqual([]);
  });
});
