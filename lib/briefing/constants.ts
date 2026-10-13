/**
 * The one place the briefing's budgets live.
 *
 * Every number here is a product decision with a cost attached: candidates
 * decide how much of the day the model sees, extracts decide how much text
 * leaves the device, and the story caps decide the shape of the edition. They
 * are constants rather than settings because a reader should not be asked to
 * price a token budget — see docs/specs/ai-daily-briefing.md §3.2.
 */
export const BRIEFING_LIMITS = {
  /** The most stories one run ever looks at, after sampling. */
  maxCandidates: 60,
  /** The recent window: the day itself, as the reader sees it. */
  recentWindowHours: 24,
  /** The insight window: how far back deep reading may reach. */
  insightWindowDays: 7,
  /** Input coverage quotas between the two windows; either may borrow the rest. */
  recentQuota: 42,
  olderQuota: 18,
  /** First rotation round gives every source this many slots before repeats. */
  maxPerSourceInitial: 5,
  /** The most article bodies one run may fetch that were not already cached. */
  maxNewExtracts: 10,
  /** How many of those fetches may run at once. */
  extractConcurrency: 2,
  /** The edition's shape: at most five Top Stories and two Worth Reading. */
  maxStories: 5,
  maxDeepReads: 2,
  /** Explicit reader interests: at most three topics, ever. */
  maxFocusTopics: 3,
  /** What one candidate's summary may occupy in the shortlist prompt. */
  shortlistSummaryChars: 500,
  /** What one article's material may occupy in the composition prompt. */
  composeArticleChars: 6000,
} as const;

/** The fixed prompt versions, recorded on every published edition. */
export const PROMPT_VERSIONS = {
  shortlist: "shortlist-v1",
  compose: "compose-v1",
} as const;

/** Runtime schema versions for the two model contracts. */
export const BRIEFING_SCHEMA_VERSION = 1 as const;

/**
 * How long one run may hold the cross-tab lease. Renewed at stage
 * boundaries; an expired lease may be taken over, so a closed tab can never
 * strand a run in "running" forever.
 */
export const BRIEFING_LEASE_MS = 120_000;

/** Failed or cancelled runs are kept this long for diagnosis, then dropped. */
export const BRIEFING_RUN_TTL_MS = 7 * 24 * 60 * 60_000;

/** Server-side request budgets. Fixed here so tests can pin them. */
export const BRIEFING_BODY_LIMITS = {
  shortlist: 256 * 1024,
  compose: 512 * 1024,
} as const;

/** How long one model call may take before the phase fails as timed out. */
export const BRIEFING_LLM_TIMEOUT_MS = 120_000;
