import { deleteDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleRecord, ReadingRecord, SourceRecord } from "./types";

const FEED_URL = "https://example.com/feed.xml";
const LEGACY_SOURCES = "firefly.sources.v1";
const LEGACY_PREFS = "firefly.reader.v1";

/**
 * The repository memoises its connection and seeds on first open, so each test
 * needs both a fresh module graph and a fresh database: close the previous
 * connection, drop the module registry, delete the store, re-import.
 */
let previous: typeof import("./db") | undefined;

/** Close, forget the module graph, and remove both database names. */
async function cleanDatabases() {
  if (previous) {
    await previous.close();
    previous = undefined;
  }
  vi.resetModules();
  await deleteDB("firefly.feeds").catch(() => {});
  await deleteDB("firefly").catch(() => {});
}

/** Import the storage layer. Separate from cleaning so a test can plant a
 *  pre-rename database in between and watch it being adopted. */
async function openRepository() {
  previous = await import("./db");
  return import("./repository");
}

async function freshRepository() {
  await cleanDatabases();
  return openRepository();
}

function seedLegacy() {
  localStorage.setItem(
    LEGACY_SOURCES,
    JSON.stringify([
      {
        id: "slegacy",
        title: "Legacy Weekly",
        host: "legacy.example",
        feedUrl: FEED_URL,
        siteUrl: "https://legacy.example",
        folder: "design",
        addedAt: 1_000,
        fetchedAt: 2_000,
        items: [
          {
            id: "a1",
            title: "Inherited",
            summary: "s",
            body: [{ kind: "p", text: "hello" }],
            minutes: 3,
            layout: "compact",
            publishedMs: 1_500,
          },
        ],
      },
    ]),
  );
  localStorage.setItem(
    LEGACY_PREFS,
    JSON.stringify({
      read: { "quiet-return": true },
      saved: { "web-we-lost": true },
      later: { aeon: true },
      theme: "dark",
      font: 2,
      navOpen: true,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

/* --------------------------------------------------------------- seeding */

describe("first run", () => {
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
});

/* ------------------------------------------------------------- migration */

describe("v0 migration", () => {
  it("moves both legacy blobs into the new stores", async () => {
    seedLegacy();
    const repo = await freshRepository();
    const snapshot = await repo.loadAll();

    expect(snapshot.sources.map((s) => s.title)).toEqual(["Legacy Weekly"]);
    expect(snapshot.articles.map((a) => a.title)).toEqual(["Inherited"]);
    expect(snapshot.articles[0].id).toBe("slegacy~a1");
    expect(snapshot.articles[0].publishedAt).toBe(1_500);
  });

  it("prefers the reader's real flags over the curated demo state", async () => {
    seedLegacy();
    const repo = await freshRepository();
    const reading = (await repo.loadAll()).reading;
    const byId = new Map(reading.map((r) => [r.id, r]));

    expect(byId.get("quiet-return")?.read).toBe(true);
    expect(byId.get("web-we-lost")?.saved).toBe(true);
    expect(byId.get("aeon")?.later).toBe(true);
    // the curated seeds must not leak in alongside migrated data — this is the
    // regression that silently discarded every legacy flag
    expect(byId.has("screen-typography")).toBe(false);
    expect(reading).toHaveLength(3);
  });

  it("discards the legacy blobs only after the new records are committed", async () => {
    seedLegacy();
    const repo = await freshRepository();
    // before any read there has been no transaction, so the source blob must survive
    expect(localStorage.getItem(LEGACY_SOURCES)).not.toBeNull();
    await repo.loadAll();
    expect(localStorage.getItem(LEGACY_SOURCES)).toBeNull();
  });

  it("short-circuits once the store has been initialised", async () => {
    seedLegacy();
    const repo = await freshRepository();
    await repo.loadAll();

    // plant a new legacy blob; a second initialisation must ignore it
    seedLegacy();
    const after = await repo.loadAll();
    expect(after.reading).toHaveLength(3);
    expect(localStorage.getItem(LEGACY_SOURCES)).not.toBeNull();
  });

  it("starts clean when a legacy blob is corrupt", async () => {
    localStorage.setItem(LEGACY_SOURCES, "{not json");
    const repo = await freshRepository();
    const snapshot = await repo.loadAll();
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.reading.length).toBeGreaterThan(0);
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
});

/* ---------------------------------------------------------- adoption */

describe("the pre-rename database", () => {
  it("is carried across rather than orphaned", async () => {
    await cleanDatabases();
    // build a database under the old name, exactly as the previous version left it
    const { openDB } = await import("idb");
    const old = await openDB("firefly", 1, {
      upgrade(db) {
        const sources = db.createObjectStore("sources", { keyPath: "id" });
        sources.createIndex("by-folder", "folder");
        const articles = db.createObjectStore("articles", { keyPath: "id" });
        articles.createIndex("by-source", "sourceId");
        const reading = db.createObjectStore("reading", { keyPath: "id" });
        reading.createIndex("by-updated", "updatedAt");
        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
    await old.put("sources", {
      ...source("sold"),
      title: "Subscribed Before The Rename",
      updatedAt: 1,
    });
    await old.put("articles", article("sold~a", "sold"));
    await old.put("reading", { id: "sold~a", read: true, updatedAt: 1 });
    await old.put("meta", { key: "seed:initialised", value: { at: 1, version: 1 } });
    old.close();
    // ...and prefs under the old key, which is the case that slips through:
    // the adopted database brings its seeded flag with it, so `initialise`
    // short-circuits and any cleanup living inside it never runs
    localStorage.setItem(
      "firefly.reader.v1",
      JSON.stringify({ theme: "dark", font: 2, navOpen: true }),
    );

    const repo = await openRepository();
    const snapshot = await repo.loadAll();

    expect(snapshot.sources.map((s) => s.title)).toEqual(["Subscribed Before The Rename"]);
    expect(snapshot.articles.map((a) => a.id)).toEqual(["sold~a"]);
    expect(snapshot.reading.map((r) => r.id)).toEqual(["sold~a"]);
    // the curated seeds must not land on top of adopted data
    expect(snapshot.reading).toHaveLength(1);

    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain("firefly");

    expect(localStorage.getItem("firefly.reader.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("firefly.feeds.v1") ?? "{}")).toMatchObject({
      theme: "dark",
      font: 2,
    });
  });

  it("leaves a fresh install untouched", async () => {
    const repo = await freshRepository();
    const snapshot = await repo.loadAll();
    // nothing to adopt, nothing to clean up, and the curated seeds still apply
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.reading.length).toBeGreaterThan(0);
    expect(localStorage.getItem("firefly.reader.v1")).toBeNull();
  });

  it("carries the prefs to their new key before the old one goes", async () => {
    seedLegacy();
    const repo = await freshRepository();
    await repo.loadAll();

    expect(localStorage.getItem("firefly.reader.v1")).toBeNull();
    expect(localStorage.getItem("firefly.sources.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("firefly.feeds.v1") ?? "{}")).toMatchObject({
      theme: "dark",
      font: 2,
      navOpen: true,
    });
  });
});

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
