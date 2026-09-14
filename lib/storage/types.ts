import type { Block, ContentState, ExtractionState, FolderId, StoryLayout } from "../types";

/**
 * Record shapes are designed for replication, not just for this browser.
 *
 * Every mutable record carries `updatedAt` (so a future sync client can resolve
 * last-write-wins without a server-side clock) and deletions are tombstones
 * rather than removals (so a delete can propagate to other devices). The three
 * stores are deliberately separate because they have very different lifetimes:
 *
 *   sources  — small, durable, low write rate.      Sync-worthy.
 *   reading  — tiny, high write rate, per item.     The most sync-worthy.
 *   articles — large, disposable, re-fetchable.     A cache, never synced.
 *
 * Keeping cached article bodies out of the same record as subscription
 * metadata is the whole point: it means a future sync only ever uploads a few
 * kilobytes of reading state instead of megabytes of somebody else's prose.
 */

export type SourceRecord = {
  /** Stable, derived from the feed URL, so two devices agree on identity. */
  id: string;
  /** The feed document itself. Unique per source — the sync identity key. */
  url: string;
  siteUrl: string;
  title: string;
  host: string;
  /** Absent when the reader chose not to file the source under a folder. */
  folder?: FolderId;
  addedAt: number;
  fetchedAt: number;
  /** Non-null when the last refresh failed. Surfaced in the navigation. */
  error?: string | null;
  /** Last local mutation, for last-write-wins reconciliation. */
  updatedAt: number;
  /** Tombstone. Deleted sources are kept so the deletion can replicate. */
  deletedAt?: number;
};

export type ArticleRecord = {
  /** `${sourceId}~${itemId}` — stable across refreshes and across devices. */
  id: string;
  sourceId: string;
  title: string;
  link?: string;
  author?: string;
  publishedAt: number;
  fetchedAt: number;
  summary: string;
  body: Block[];
  image?: string;
  /** True when `image` is the page's declared cover, shown above the body. */
  hasCover?: boolean;
  /** True when the page is a video that has to be watched at the source. */
  videoPage?: boolean;
  minutes: number;
  layout: StoryLayout;
  contentState: ContentState;
  extractionState: ExtractionState;
  /**
   * When the original page was last downloaded and its body replaced. Its
   * presence is what makes the body authoritative over the feed's fallback.
   */
  contentFetchedAt?: number;
  /** When the original page was last checked, successfully or not. */
  contentCheckedAt?: number;
  /** Validators from the original page's last response, for conditional GET. */
  etag?: string;
  lastModified?: string;
  /** The extractor generation that produced `body`. See EXTRACTOR_VERSION. */
  extractorVersion?: number;
};

export type ReadingRecord = {
  /** Article id. Seeded edition stories use their own literal ids. */
  id: string;
  read?: boolean;
  saved?: boolean;
  later?: boolean;
  /** Last local mutation. This is what a sync client diffs on. */
  updatedAt: number;
};

export type MetaRecord = {
  key: string;
  value: unknown;
};

/** What a sync client needs: everything that changed after a watermark. */
export type Changeset = {
  watermark: number;
  sources: SourceRecord[];
  reading: ReadingRecord[];
};

export type StorageUsage = {
  usage: number;
  quota: number;
} | null;
