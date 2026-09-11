import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { hashString } from "../hash";
import type { ArticleRecord, MetaRecord, ReadingRecord, SourceRecord } from "./types";

/**
 * The only module in the application that knows IndexedDB exists. Everything
 * else talks to `repository.ts`, so swapping this for SQLite/WASM, OPFS, or a
 * remote-backed adapter later is a change to one directory.
 */

const DB_NAME = "firefly";
const DB_VERSION = 1;
const SEEDED = "seed:initialised";
const LEGACY_SOURCES = "firefly.sources.v1";
const LEGACY_PREFS = "firefly.reader.v1";

export interface FireflyDB extends DBSchema {
  sources: {
    key: string;
    value: SourceRecord;
    indexes: { "by-folder": string; "by-added": number };
  };
  articles: {
    key: string;
    value: ArticleRecord;
    indexes: { "by-source": string; "by-published": number };
  };
  reading: {
    key: string;
    value: ReadingRecord;
    indexes: { "by-updated": number };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

let connection: Promise<IDBPDatabase<FireflyDB>> | null = null;

export function available(): boolean {
  return typeof indexedDB !== "undefined";
}

export function db(): Promise<IDBPDatabase<FireflyDB>> {
  if (!connection) connection = connect();
  return connection;
}

async function connect(): Promise<IDBPDatabase<FireflyDB>> {
  const database = await openDB<FireflyDB>(DB_NAME, DB_VERSION, {
    upgrade(instance) {
      const sources = instance.createObjectStore("sources", { keyPath: "id" });
      sources.createIndex("by-folder", "folder");
      sources.createIndex("by-added", "addedAt");

      const articles = instance.createObjectStore("articles", { keyPath: "id" });
      articles.createIndex("by-source", "sourceId");
      articles.createIndex("by-published", "publishedAt");

      const reading = instance.createObjectStore("reading", { keyPath: "id" });
      reading.createIndex("by-updated", "updatedAt");

      instance.createObjectStore("meta", { keyPath: "key" });
    },
  });

  await initialise(database);
  return database;
}

/* ------------------------------------------------------------------ seed */

/**
 * The seeded edition ships with a few stories already read, kept, and queued —
 * it demonstrates the product's states on first run. Those flags live in the
 * same `reading` store as everything else, so there is exactly one code path.
 */
const CURATED = {
  read: ["screen-typography", "museums-servers", "color-of-print"],
  saved: ["web-we-lost", "reading-technology", "archive-product"],
  later: ["european-ai-stack", "agents-one-thing", "small-web-manifesto"],
};

function curatedRecords(): ReadingRecord[] {
  const at = Date.now();
  const map = new Map<string, ReadingRecord>();
  const bump = (id: string, patch: Partial<ReadingRecord>) => {
    map.set(id, { ...(map.get(id) ?? { id }), ...patch, updatedAt: at } as ReadingRecord);
  };
  CURATED.read.forEach((id) => bump(id, { read: true }));
  CURATED.saved.forEach((id) => bump(id, { saved: true }));
  CURATED.later.forEach((id) => bump(id, { later: true }));
  return [...map.values()];
}

/* ----------------------------------------------------------- migration */

type LegacyItem = {
  id: string;
  title: string;
  link?: string;
  author?: string;
  publishedMs?: number;
  summary: string;
  body: ArticleRecord["body"];
  image?: string;
  minutes: number;
  layout: ArticleRecord["layout"];
  truncated?: boolean;
};

type LegacySubscription = {
  id: string;
  title: string;
  host: string;
  feedUrl: string;
  siteUrl: string;
  folder: SourceRecord["folder"];
  addedAt?: number;
  fetchedAt?: number;
  items?: LegacyItem[];
};

type LegacyDump = { reading: ReadingRecord[]; sources: LegacySubscription[] };

/**
 * v0 kept everything in two localStorage blobs. Read them once and hand the
 * contents back for a single atomic write.
 *
 * This is deliberately a *pure read*. Destroying the legacy data before the
 * new store has committed would turn a failed upgrade into permanent loss, so
 * cleanup happens in `discardLegacy`, after the transaction resolves.
 */
function readLegacy(): LegacyDump | null {
  if (typeof localStorage === "undefined") return null;
  const dump: LegacyDump = { reading: [], sources: [] };

  try {
    const raw = localStorage.getItem(LEGACY_SOURCES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) dump.sources = parsed as LegacySubscription[];
    }
  } catch {
    /* corrupted — start clean rather than blocking the upgrade */
  }

  try {
    const raw = localStorage.getItem(LEGACY_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const at = Date.now();
      const flags = new Map<string, ReadingRecord>();
      for (const bucket of ["read", "saved", "later"] as const) {
        const value = parsed[bucket];
        if (value && typeof value === "object") {
          for (const [id, on] of Object.entries(value as Record<string, boolean>)) {
            if (!on) continue;
            const record = flags.get(id) ?? ({ id, updatedAt: at } as ReadingRecord);
            record[bucket] = true;
            flags.set(id, record);
          }
        }
      }
      dump.reading = [...flags.values()];
    }
  } catch {
    /* ignore */
  }

  return dump.reading.length || dump.sources.length ? dump : null;
}

/** Only call this once the migrated records are durably written. */
function discardLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_SOURCES);
    const raw = localStorage.getItem(LEGACY_PREFS);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const bucket of ["read", "saved", "later"] as const) delete parsed[bucket];
    // theme / font / navOpen / view stay put — the boot script reads this key
    localStorage.setItem(LEGACY_PREFS, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

async function initialise(database: IDBPDatabase<FireflyDB>): Promise<void> {
  if (await database.get("meta", SEEDED)) return;

  const legacy = readLegacy();
  const reading = legacy && legacy.reading.length ? legacy.reading : curatedRecords();

  const tx = database.transaction(["reading", "meta", "sources", "articles"], "readwrite");
  const readingStore = tx.objectStore("reading");
  const sourceStore = tx.objectStore("sources");
  const articleStore = tx.objectStore("articles");

  for (const record of reading) readingStore.put(record);

  for (const source of legacy?.sources ?? []) {
    const addedAt = source.addedAt ?? Date.now();
    const fetchedAt = source.fetchedAt ?? addedAt;
    sourceStore.put({
      id: source.id,
      url: source.feedUrl,
      siteUrl: source.siteUrl,
      title: source.title,
      host: source.host,
      folder: source.folder,
      addedAt,
      fetchedAt,
      updatedAt: addedAt,
    });
    for (const item of source.items ?? []) {
      articleStore.put({
        id: `${source.id}~${item.id}`,
        sourceId: source.id,
        title: item.title,
        link: item.link,
        author: item.author,
        publishedAt: item.publishedMs ?? fetchedAt,
        fetchedAt,
        summary: item.summary,
        body: item.body,
        image: item.image,
        minutes: item.minutes,
        layout: item.layout,
        truncated: item.truncated,
      });
    }
  }

  tx.objectStore("meta").put({ key: SEEDED, value: { at: Date.now(), version: DB_VERSION } });
  await tx.done;

  if (legacy) discardLegacy();
}

/* --------------------------------------------------------------- helpers */

export function sourceIdFor(feedUrl: string): string {
  return `s${hashString(feedUrl).toString(36)}`;
}

export function articleIdFor(sourceId: string, itemId: string): string {
  return `${sourceId}~${itemId}`;
}
