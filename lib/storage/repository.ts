import { articleIdFor, available, db, sourceIdFor } from "./db";
import type {
  ArticleRecord,
  Changeset,
  ReadingRecord,
  SourceRecord,
  StorageUsage,
} from "./types";

/**
 * The application's storage contract. Nothing above this file imports `idb` or
 * knows that IndexedDB exists — which is what makes the next step (a remote
 * adapter, or SQLite on the server for real cross-device sync) a swap rather
 * than a rewrite.
 *
 * The three stores have different jobs and different lifetimes:
 *
 *   sources   the registry of what you subscribe to. Small, durable, synced.
 *   reading   read / saved / later per article. Tiny, synced, high write rate.
 *   articles  cached bodies. Large, disposable, re-fetchable. NEVER synced —
 *             a new device should re-fetch rather than download a corpus.
 */

export type Snapshot = {
  sources: SourceRecord[];
  articles: ArticleRecord[];
  reading: ReadingRecord[];
};

const EMPTY: Snapshot = { sources: [], articles: [], reading: [] };

export async function loadAll(): Promise<Snapshot> {
  if (!available()) return EMPTY;
  const database = await db();
  const [sources, articles, reading] = await Promise.all([
    database.getAll("sources"),
    database.getAll("articles"),
    database.getAll("reading"),
  ]);
  return {
    sources: sources.filter((s) => !s.deletedAt),
    articles,
    reading,
  };
}

export async function getSource(id: string): Promise<SourceRecord | undefined> {
  if (!available()) return undefined;
  return (await db()).get("sources", id);
}

export async function getArticles(sourceId: string): Promise<ArticleRecord[]> {
  if (!available()) return [];
  return (await db()).getAllFromIndex("articles", "by-source", sourceId);
}

/* ---------------------------------------------------------------- writes */

export async function putSource(source: SourceRecord): Promise<void> {
  if (!available()) return;
  await (await db()).put("sources", source);
}

/**
 * Replaces a source's cached articles in one transaction. Articles that are
 * kept for later are exempt from eviction, so pruning the cache can never
 * remove something the reader deliberately held on to.
 */
export async function replaceArticles(
  sourceId: string,
  items: ArticleRecord[],
  keep: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (!available()) return;
  const database = await db();
  const tx = database.transaction("articles", "readwrite");
  const store = tx.objectStore("articles");
  const existing = await store.index("by-source").getAllKeys(sourceId);
  const incoming = new Set(items.map((item) => item.id));

  for (const id of existing) {
    if (!incoming.has(id) && !keep.has(id)) store.delete(id);
  }
  for (const item of items) store.put(item);

  await tx.done;
}

/** Tombstone rather than delete, so the removal can replicate. */
export async function removeSource(id: string): Promise<void> {
  if (!available()) return;
  const database = await db();
  const tx = database.transaction(["sources", "articles"], "readwrite");
  const sources = tx.objectStore("sources");
  const existing = await sources.get(id);
  if (existing) {
    sources.put({ ...existing, deletedAt: Date.now(), updatedAt: Date.now() });
  }
  const articles = await tx.objectStore("articles").index("by-source").getAllKeys(id);
  for (const articleId of articles) tx.objectStore("articles").delete(articleId);
  await tx.done;
}

export async function putReading(record: ReadingRecord): Promise<void> {
  if (!available()) return;
  await (await db()).put("reading", record);
}

export async function putReadingMany(records: ReadingRecord[]): Promise<void> {
  if (!available() || !records.length) return;
  const database = await db();
  const tx = database.transaction("reading", "readwrite");
  for (const record of records) tx.store.put(record);
  await tx.done;
}

/* ------------------------------------------------------------------ sync */

/**
 * The primitive a sync client needs: everything mutated after a watermark.
 * `sources` includes tombstones so deletions propagate; `articles` is absent by
 * design, because cached bodies are re-fetchable rather than user data.
 */
export async function changesSince(watermark: number): Promise<Changeset> {
  if (!available()) return { watermark, sources: [], reading: [] };
  const database = await db();
  const [sources, reading] = await Promise.all([
    database.getAll("sources"),
    database.getAllFromIndex("reading", "by-updated", IDBKeyRange.lowerBound(watermark, true)),
  ]);
  return {
    watermark: Date.now(),
    sources: sources.filter((s) => s.updatedAt > watermark),
    reading,
  };
}

export async function mergeChangeset(changes: Changeset): Promise<void> {
  if (!available()) return;
  const database = await db();
  const tx = database.transaction(["sources", "reading"], "readwrite");

  for (const incoming of changes.sources) {
    const local = await tx.objectStore("sources").get(incoming.id);
    // last write wins; ties always resolve toward deletion
    const wins =
      !local ||
      incoming.updatedAt > local.updatedAt ||
      (incoming.updatedAt === local.updatedAt && Boolean(incoming.deletedAt) && !local.deletedAt);
    if (wins) tx.objectStore("sources").put(incoming);
  }

  for (const incoming of changes.reading) {
    const local = await tx.objectStore("reading").get(incoming.id);
    if (!local || incoming.updatedAt >= local.updatedAt) {
      tx.objectStore("reading").put(incoming);
    }
  }

  await tx.done;
}

/* ---------------------------------------------------------------- admin */

export async function estimate(): Promise<StorageUsage> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

export async function clearAll(): Promise<void> {
  if (!available()) return;
  const database = await db();
  const tx = database.transaction(["sources", "articles", "reading"], "readwrite");
  await Promise.all([
    tx.objectStore("sources").clear(),
    tx.objectStore("articles").clear(),
    tx.objectStore("reading").clear(),
    tx.done,
  ]);
}

export { articleIdFor, sourceIdFor };
