import type {
  Block,
  ClassificationStatus,
  ContentState,
  ExtractionState,
  FolderId,
  StoryLayout,
} from "../types";

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
  /** Caption printed under the cover, when the source gave one. */
  imageCaption?: string;
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

/**
 * A reader-editable article topic.
 *
 * Deliberately separate from `SourceRecord.folder`: a folder files a
 * publication, while a topic describes what a single story is about. The same
 * feed publishes pieces in several of them, so folding the two together would
 * lose the only thing article-level classification adds.
 *
 * `id` and `slug` are the same value for the built-in set. They are kept apart
 * because the slug is what travels to the classifier as a stable, readable
 * label, while the id is what a stored classification points at — so a reader
 * renaming a topic's label never has to rewrite every record that used it.
 */
export type ArticleTopic = {
  id: string;
  slug: string;
  label: string;
  /** Guidance shown to the classifier. Never rendered in the reader. */
  description?: string;
  /** True for the set Firefly ships, so a reset can restore them. */
  builtin?: boolean;
  /** Last local mutation, for last-write-wins reconciliation. */
  updatedAt: number;
  /** Tombstone. Removed topics are kept so the removal can replicate. */
  deletedAt?: number;
};

/**
 * The topic a story was classified into. This is user state — the reader can
 * correct it and it is worth carrying to another device — so it lives in its
 * own store rather than on the disposable `articles` cache record.
 */
export type ArticleClassification = {
  /** The `ArticleRecord.id` this belongs to. One classification per story. */
  itemId: string;
  topicIds: string[];
  primaryTopicId?: string;
  confidence: number;
  status: ClassificationStatus;
  provider: "jev";
  model?: string;
  /**
   * Hash of the title and summary the classification was made from. A story
   * whose text changes gets a new fingerprint and is classified again — unless
   * the reader has already confirmed or rejected it.
   */
  contentFingerprint: string;
  /** Last local mutation, for last-write-wins reconciliation. */
  updatedAt: number;
  /** Tombstone. Removed classifications are kept so the removal can replicate. */
  deletedAt?: number;
};

/**
 * One edition of Today's briefing, keyed by the reader's own calendar day.
 *
 * Derived rather than authored: it can be written again from the stories a
 * reader already has, which is why it stays out of the changeset — a new device
 * writes its own edition rather than downloading somebody else's prose.
 *
 * The picks and the prose travel in parallel fields rather than as one nested
 * shape, for the same reason a classification stores ids and not the
 * suggestion: this is a record of what happened, and the words are metadata
 * about ids that are the real content.
 */
export type DigestRecord = {
  /** `YYYY-MM-DD` in the reader's own day. One edition per day. */
  day: string;
  /** The chosen story ids, in reading order. */
  picks: string[];
  /** What each picked story is, keyed by story id. */
  gists: Record<string, string>;
  /** Why each one was picked, keyed by story id. */
  reasons: Record<string, string>;
  /**
   * The stories it was written from. A candidate that is not here arrived
   * afterwards, which is the only case where rewriting could add anything —
   * a story that has since been read and dropped out does not make an edition
   * the reader has already read wrong.
   */
  candidates: string[];
  /** The LLM service that wrote it. */
  provider: string;
  model?: string;
  /** The language it is written in, so a change of mind is visible. */
  language: string;
  updatedAt: number;
};

/** What a sync client needs: everything that changed after a watermark. */
export type Changeset = {
  watermark: number;
  sources: SourceRecord[];
  reading: ReadingRecord[];
  /** Optional so a changeset from a peer that predates topics still merges. */
  topics?: ArticleTopic[];
  classifications?: ArticleClassification[];
};

export type StorageUsage = {
  usage: number;
  quota: number;
} | null;
