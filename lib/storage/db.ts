import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { hashString } from "../hash";
import type { ArticleRecord, MetaRecord, ReadingRecord, SourceRecord } from "./types";

/**
 * The only module in the application that knows IndexedDB exists. Everything
 * else talks to `repository.ts`, so swapping this for SQLite/WASM, OPFS, or a
 * remote-backed adapter later is a change to one directory.
 */

const DB_NAME = "firefly-feeds";
const DB_VERSION = 1;
const SEEDED = "seed:initialised";

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

/**
 * Releases the connection. Needed before the database can be deleted or
 * upgraded by another tab, and the hook the tests use to get a clean instance.
 */
export async function close(): Promise<void> {
  if (!connection) return;
  const pending = connection;
  connection = null;
  try {
    (await pending).close();
  } catch {
    /* already closed or never opened */
  }
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

async function initialise(database: IDBPDatabase<FireflyDB>): Promise<void> {
  if (await database.get("meta", SEEDED)) return;

  const tx = database.transaction(["reading", "meta"], "readwrite");
  const reading = tx.objectStore("reading");
  for (const record of curatedRecords()) reading.put(record);
  tx.objectStore("meta").put({ key: SEEDED, value: { at: Date.now(), version: DB_VERSION } });
  await tx.done;
}

/* --------------------------------------------------------------- helpers */

export function sourceIdFor(feedUrl: string): string {
  return `s${hashString(feedUrl).toString(36)}`;
}

export function articleIdFor(sourceId: string, itemId: string): string {
  return `${sourceId}~${itemId}`;
}
