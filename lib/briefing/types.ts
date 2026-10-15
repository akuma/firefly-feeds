import type { DigestLanguageId } from "../languages";
import type { ArticleRecord, SourceRecord } from "../storage/types";
import { BRIEFING_SCHEMA_VERSION } from "./constants";

/**
 * The briefing's contracts, in one file: what the model is given, what it may
 * return, what is published, and what a run remembers. The same types serve
 * the browser pipeline, the server route and the runtime validators, so the
 * two ends cannot drift apart — see docs/specs/ai-daily-briefing.md §4/§6/§9.
 */

export type SchemaVersion = typeof BRIEFING_SCHEMA_VERSION;

/* ------------------------------------------------------- stage one input */

export type BriefingCandidate = {
  articleId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  /** Truncated to `BRIEFING_LIMITS.shortlistSummaryChars` before it is sent. */
  summary: string;
  publishedAt: number | null;
  topicIds: string[];
  contentState: "full" | "summary" | "truncated";
  fullBodyCached: boolean;
};

export type BriefingHistoryDigest = {
  kind?: "news" | "insight";
  editionDate: string;
  headline: string;
  sourceArticleIds: string[];
};

/** Optional on older frozen runs, which retain their original broad selection. */
export type BriefingFocusContext = {
  focusTopics?: Array<{ id: string; label: string }>;
  focusOnly?: boolean;
};

export type ShortlistInput = BriefingFocusContext & {
  coverageStartedAt?: number;
  schemaVersion: SchemaVersion;
  editionDate: string;
  cutoffAt: number;
  timezone: string;
  outputLanguage: DigestLanguageId;
  focusTopicIds: string[];
  candidates: BriefingCandidate[];
  previousStories: BriefingHistoryDigest[];
};

/* ------------------------------------------------------ stage one output */

export type CandidateGroup = {
  groupId: string;
  kind: "news" | "insight";
  workingHeadline: string;
  articleIds: string[];
  value: number;
  novelty: number;
  evidence: number;
  selectionReason: string;
  missingInformation: string;
};

export type ShortlistOutput = {
  schemaVersion: SchemaVersion;
  groups: CandidateGroup[];
  extractArticleIds: string[];
};

/* ------------------------------------------------------- stage two input */

export type MaterialQuality = "full" | "excerpted" | "feed-summary";

export type ArticleMaterial = {
  articleId: string;
  sourceName: string;
  title: string;
  sourceUrl: string | null;
  publishedAt: number | null;
  /** `excerpted` is a cut of a longer body — the model did not read it all. */
  materialQuality: MaterialQuality;
  text: string;
  /** Which blocks the text was built from, so a claim can point back. */
  blockIndices?: number[];
};

export type ComposeInput = BriefingFocusContext & {
  coverageStartedAt?: number;
  previousStories?: BriefingHistoryDigest[];
  previouslyRecommendedArticleIds?: string[];
  schemaVersion: SchemaVersion;
  editionDate: string;
  timezone: string;
  cutoffAt: number;
  outputLanguage: DigestLanguageId;
  shortlist: ShortlistOutput;
  materials: ArticleMaterial[];
  limits: {
    maxStories: number;
    maxDeepReads: number;
    targetReadingMinutes: number;
  };
};

/* ----------------------------------------------------- stage two output */

export type EvidenceRef = {
  articleId: string;
  /** A contiguous span of the material it cites — verified, never trusted. */
  excerpt: string;
};

export type SupportedText = {
  text: string;
  evidence: EvidenceRef[];
};

export type ComposedStory = {
  headline: string;
  whatHappened: SupportedText;
  context: SupportedText | null;
  whyItMatters: SupportedText | null;
  perspectives: SupportedText[];
};

export type ComposedDeepRead = {
  articleId: string;
  whyRead: SupportedText;
};

export type ComposeOutput = {
  reassessedGroups?: Array<{ groupId: string; value: number; novelty: number; evidence: number }>;
  schemaVersion: SchemaVersion;
  bigPicture: SupportedText | null;
  topStories: ComposedStory[];
  worthReading: ComposedDeepRead[];
};

/* ------------------------------------------------------------ candidate set */

export type CandidateSet = {
  candidates: BriefingCandidate[];
  skippedStats: {
    duplicates: number;
    outOfWindow: number;
    noSource: number;
    sample: number;
    empty: number;
    capped: number;
    offFocus?: number;
  };
  /** Per-source counts in the final candidate list, for the coverage line. */
  sourceCoverage: Record<string, number>;
  /** How many candidates came from each window. */
  selectedWindow: { recent: number; older: number };
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/* ------------------------------------------------------------ persistence */

export type BriefingSourceSnapshot = {
  articleId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string | null;
  publishedAt: number | null;
};

export type BriefingStats = {
  candidates: number;
  sourcesConsidered: number;
  fullTextsFetched: number;
  fullTextsFailed: number;
  /** Whole proposed items omitted for editorial score or section/group mismatch. */
  omittedWeakItems?: number;
  llmRequests: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
};

export type BriefingEdition = {
  /** `editionKey` + revision: stable and unique. */
  id: string;
  /** `${editionDate}@${timezone}` — one day in one zone is one edition. */
  editionKey: string;
  editionDate: string;
  timezone: string;
  revision: number;
  cutoffAt: number;
  /** Absent on legacy editions that could include week-old reading. */
  coverageStartedAt?: number;
  generatedAt: number;
  /** Missing on editions created before language selection was restored: English. */
  outputLanguage?: DigestLanguageId;
  schemaVersion: SchemaVersion;
  promptVersion: string;
  model: { provider: string; model: string };
  sourceSnapshots: BriefingSourceSnapshot[];
  bigPicture: SupportedText | null;
  topStories: Array<
    ComposedStory & {
      /** Program-made stable section id, for deep links and scroll restore. */
      id: string;
      sourceArticleIds: string[];
    }
  >;
  worthReading: ComposedDeepRead[];
  stats: BriefingStats;
  coverageIncomplete?: boolean;
  updatedAt: number;
};

export type RunStatus =
  | "preparing"
  | "shortlisting"
  | "enriching"
  | "composing"
  | "validating"
  | "paused"
  | "failed"
  | "cancelled"
  | "ready";

export type BriefingRun = {
  runId: string;
  editionKey: string;
  revision: number;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  cutoffAt: number;
  /** Latest manual start/resume; absent on legacy runs whose origin is unknown. */
  trigger?: { type: "manual"; action: "generate" | "resume"; at: number };
  /** Consistency tag over the frozen inputs; not a security hash. */
  snapshotHash: string;
  sourceSnapshots: BriefingSourceSnapshot[];
  promptVersion: string;
  providerId: string;
  modelId: string;
  /** Every model call this run has spent, including repairs. */
  callsUsed: number;
  /** Frozen inputs and stage checkpoints. Never an API key. */
  frozenArticles?: ArticleRecord[];
  frozenSources?: SourceRecord[];
  enrichmentComplete?: boolean;
  extractAttempts?: string[];
  cancelledExtracts?: string[];
  stats?: Partial<BriefingStats>;
  repairUsed?: boolean;
  /** Bounded validator diagnostics, not provider response bodies or credentials. */
  repairTrace?: { phase: GeneratePhase; code: GenerateFailureCode; errors: string[] };
  /** Remember compact-output requirements across cancellation and Resume. */
  truncatedPhases?: GeneratePhase[];
  coverageIncomplete?: boolean;
  prepared?: ShortlistInput;
  shortlist?: ShortlistOutput;
  materials?: ArticleMaterial[];
  composed?: ComposeOutput;
  error?: { code: string; message: string; retryable: boolean };
  /** Cross-tab single-run lease, held in IndexedDB rather than React state. */
  lease?: { ownerId: string; expiresAt: number };
};

/* --------------------------------------------------------- generate wire */

export type GeneratePhase = "shortlist" | "compose";

export type GenerateFailureCode =
  | "INVALID_INPUT"
  | "INVALID_OUTPUT"
  | "INSUFFICIENT_CONTENT"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "TIMED_OUT"
  | "OUTPUT_TRUNCATED"
  | "UNSUPPORTED_MODEL";

export type GenerateSuccess = {
  ok: true;
  /** Whole proposed items omitted for editorial score or section/group mismatch. */
  omittedWeakItems?: number;
  phase: GeneratePhase;
  result: ShortlistOutput | ComposeOutput;
  usage?: { inputTokens?: number; outputTokens?: number };
  provider: string;
  model: string;
};

export type GenerateFailure = {
  ok: false;
  code: GenerateFailureCode;
  message: string;
  retryable: boolean;
  /** Short validator field paths, safe to echo back as repair feedback. */
  errors?: string[];
};

export type GenerateResult = GenerateSuccess | GenerateFailure;
