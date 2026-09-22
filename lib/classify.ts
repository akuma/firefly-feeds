import { blocksToText } from "./feed-html";
import { hashString } from "./hash";
import type { ArticleClassification, ArticleRecord, ArticleTopic } from "./storage/types";
import type { ClassificationStatus } from "./types";

/**
 * Article classification through Jev, kept as one pure module so the decision
 * rules — what counts as a valid answer, what confidence is enough to believe
 * it, and when a reader's correction outranks the classifier — are testable
 * without a network, a database or a DOM.
 *
 * The network call itself belongs to `app/api/classify`, because the API key is
 * server-side and the reader's page must not reach a third party directly.
 */

/** Jev's own decision endpoint. The preset workflows do not fit a topic choice. */
export const JEV_ENDPOINT = "https://www.jevai.org/api/v1/decisions";

/** The one model this feature asks for. */
export const JEV_MODEL = "typesafe-ai/jev";

/**
 * Below this, the classifier is guessing and the reader is shown a question
 * rather than an answer. Chosen from Jev's own `confidence`, not from the
 * per-topic probability: a twelve-way choice spreads probability thin even
 * when the model is sure, so the answer's confidence is the honest signal.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** A second topic is only kept when the distribution actually supports it. */
export const SECONDARY_TOPIC_MIN = 0.12;

/** An article rarely has more than a couple of real subjects. */
export const MAX_TOPICS_PER_ARTICLE = 3;

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifyError";
  }
}

/* ------------------------------------------------------------ topic set */

type TopicSeed = { slug: string; label: string; description: string };

/**
 * The set given the first time classification is switched on. It is broader
 * than the source folders on purpose: a story can be filed under a technology
 * feed and still be about policy, or a culture feed and still be about books.
 *
 * `id` equals `slug` for the built-ins — a slug is already a stable, readable
 * key, and a rename only ever changes the label.
 */
export const DEFAULT_TOPIC_SEEDS: readonly TopicSeed[] = [
  { slug: "news", label: "News", description: "current events and breaking stories" },
  { slug: "politics", label: "Politics", description: "government, policy and public life" },
  { slug: "business", label: "Business", description: "companies, markets and the economy" },
  { slug: "science", label: "Science", description: "research, discovery and the natural world" },
  {
    slug: "technology",
    label: "Technology",
    description: "software, hardware, the internet and computing",
  },
  { slug: "ai", label: "AI", description: "artificial intelligence and machine learning" },
  { slug: "health", label: "Health", description: "medicine, public health and wellbeing" },
  { slug: "environment", label: "Environment", description: "climate, conservation and nature" },
  { slug: "culture", label: "Culture", description: "arts, film, music and society" },
  {
    slug: "design",
    label: "Design",
    description: "craft, typography, products and the built world",
  },
  { slug: "ideas", label: "Ideas", description: "essays, philosophy and argument" },
  { slug: "books", label: "Books", description: "books, writing and publishing" },
];

/** The built-in set as storable records, stamped with one write time. */
export function defaultTopics(at: number): ArticleTopic[] {
  return DEFAULT_TOPIC_SEEDS.map((seed) => ({
    id: seed.slug,
    slug: seed.slug,
    label: seed.label,
    description: seed.description,
    builtin: true,
    updatedAt: at,
  }));
}

/* ---------------------------------------------------------- fingerprint */

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * What "the same article text" means for classification. A title or summary
 * that changes gets a new fingerprint, so an automatic pass can run again — but
 * a reader's confirmation is never invalidated by it.
 */
export function articleFingerprint(title: string, summary: string): string {
  return hashString(`${normalise(title)}\u0000${normalise(summary)}`).toString(36);
}

/** The most text we send: enough to disambiguate, well inside Jev's 32KiB cap. */
const SUMMARY_LIMIT = 600;

/**
 * The classifier's input. The reader may have the full text, but classification
 * never fetches it: a cached body is used when it is already on disk, and a
 * summary-only story is judged on its summary. That keeps classification a
 * local, offline-capable pass rather than a second crawler.
 */
export function classifyInputFor(article: {
  title: string;
  summary: string;
  body: ArticleRecord["body"];
}): { title: string; summary: string } {
  const summary = article.summary.trim() || blocksToText(article.body);
  return { title: article.title, summary: summary.slice(0, SUMMARY_LIMIT) };
}

/* -------------------------------------------------------- request build */

export type ApiTopic = { slug: string; label: string; description?: string };

export type JevRequest = {
  model: string;
  state: { title: string; summary: string; topics: { slug: string; label: string }[] };
  questions: {
    topic: { type: "choice"; instructions: string; criteria: Record<string, string> };
  };
};

const INSTRUCTIONS =
  "Choose the single topic that best fits this article. Judge only from the " +
  "title and summary. If the text does not clearly support a topic, choose the " +
  "closest one but answer with low confidence.";

export function buildClassifyRequest(
  input: { title: string; summary: string },
  topics: readonly ApiTopic[],
): JevRequest {
  const criteria: Record<string, string> = {};
  for (const topic of topics) {
    criteria[topic.slug] = topic.description
      ? `${topic.label} — ${topic.description}`
      : topic.label;
  }
  return {
    model: JEV_MODEL,
    state: {
      title: input.title,
      summary: input.summary,
      topics: topics.map((topic) => ({ slug: topic.slug, label: topic.label })),
    },
    questions: {
      topic: { type: "choice", instructions: INSTRUCTIONS, criteria },
    },
  };
}

/* ------------------------------------------------------- response parse */

export type ClassifySuggestion = {
  primarySlug: string;
  topicSlugs: string[];
  confidence: number;
  model?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function probabilityMap(value: unknown, knownSlugs: ReadonlySet<string>): Map<string, number> {
  const map = new Map<string, number>();
  const record = asRecord(value);
  if (!record) return map;
  for (const [slug, raw] of Object.entries(record)) {
    const probability = finiteNumber(raw);
    if (knownSlugs.has(slug) && probability !== undefined) map.set(slug, probability);
  }
  return map;
}

/**
 * Turn a Jev response into slugs, or refuse it. Anything that is not a
 * successful call with a known, closed-set choice is an error — the caller must
 * never guess on the classifier's behalf, and a topic outside the reader's own
 * set would be a fabricated answer.
 */
export function parseClassifyResponse(
  raw: unknown,
  knownSlugs: ReadonlySet<string>,
): ClassifySuggestion {
  const body = asRecord(raw);
  if (!body) throw new ClassifyError("Jev returned an unreadable response.");
  if (body.code !== 0) {
    const message = typeof body.message === "string" && body.message ? body.message : "";
    throw new ClassifyError(message || "Jev refused the request.");
  }

  const data = asRecord(body.data);
  const answers = asRecord(data?.answers);
  const answer = asRecord(answers?.topic);
  const choice = typeof answer?.choice === "string" ? answer.choice : undefined;
  if (!choice || !knownSlugs.has(choice)) {
    throw new ClassifyError("Jev did not choose one of the offered topics.");
  }

  const probabilities = probabilityMap(answer?.probabilities, knownSlugs);
  const confidence = clamp01(
    finiteNumber(answer?.confidence) ??
      probabilities.get(choice) ??
      finiteNumber(data?.confidence) ??
      0,
  );

  const ranked = [...probabilities.entries()]
    .filter(([slug]) => slug !== choice)
    .filter(([, probability]) => probability >= SECONDARY_TOPIC_MIN)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS_PER_ARTICLE - 1)
    .map(([slug]) => slug);

  const model = typeof data?.model === "string" && data.model ? data.model : undefined;
  return {
    primarySlug: choice,
    topicSlugs: [choice, ...ranked],
    confidence,
    ...(model ? { model } : {}),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* ----------------------------------------------------------- resolution */

export type ClassificationOutcome = {
  primaryTopicId: string;
  topicIds: string[];
  confidence: number;
  status: Extract<ClassificationStatus, "auto" | "needs_review">;
};

/**
 * Map the classifier's slugs onto the reader's topics and decide whether the
 * answer is a fact or a question.
 */
export function resolveClassification(
  suggestion: ClassifySuggestion,
  topics: readonly ArticleTopic[],
  threshold = CONFIDENCE_THRESHOLD,
): ClassificationOutcome {
  const bySlug = new Map(topics.map((topic) => [topic.slug, topic]));
  const primary = bySlug.get(suggestion.primarySlug);
  if (!primary) throw new ClassifyError("Jev chose a topic that is no longer in the set.");

  const topicIds = [primary.id];
  for (const slug of suggestion.topicSlugs) {
    if (topicIds.length >= MAX_TOPICS_PER_ARTICLE) break;
    const topic = bySlug.get(slug);
    if (topic && !topicIds.includes(topic.id)) topicIds.push(topic.id);
  }

  return {
    primaryTopicId: primary.id,
    topicIds,
    confidence: suggestion.confidence,
    status: suggestion.confidence >= threshold ? "auto" : "needs_review",
  };
}

/** Build the persistable record from an outcome, never before it is resolved. */
export function classificationFromOutcome(
  itemId: string,
  outcome: ClassificationOutcome,
  fingerprint: string,
  options: { model?: string; at?: number } = {},
): ArticleClassification {
  const record: ArticleClassification = {
    itemId,
    topicIds: outcome.topicIds,
    primaryTopicId: outcome.primaryTopicId,
    confidence: outcome.confidence,
    status: outcome.status,
    provider: "jev",
    contentFingerprint: fingerprint,
    updatedAt: options.at ?? Date.now(),
  };
  if (options.model) record.model = options.model;
  return record;
}

/** The record a reader's correction writes. It is never overwritten by `auto`. */
export function correctionRecord(
  itemId: string,
  topicIds: string[],
  fingerprint: string,
  at = Date.now(),
): ArticleClassification {
  const record: ArticleClassification = {
    itemId,
    topicIds,
    confidence: 1,
    status: "confirmed",
    provider: "jev",
    contentFingerprint: fingerprint,
    updatedAt: at,
  };
  if (topicIds[0]) record.primaryTopicId = topicIds[0];
  return record;
}

/* -------------------------------------------------------------- gating */

/**
 * Whether an automatic pass should run for this story.
 *
 * A story with no classification at all, or one whose text has changed since
 * it was classified, is a candidate. A story the reader has confirmed or
 * rejected is not: their answer outlives the text, and re-running would undo
 * the correction.
 */
export function needsClassification(
  article: { title: string; summary: string },
  existing: ArticleClassification | undefined,
  topics: readonly ArticleTopic[],
): boolean {
  if (topics.length === 0) return false;
  if (!existing || existing.deletedAt) return true;
  if (existing.status === "confirmed" || existing.status === "rejected") return false;
  return existing.contentFingerprint !== articleFingerprint(article.title, article.summary);
}

/**
 * Which record wins when an automatic result meets a stored one. Explicit and
 * small because it is the rule the whole feature rests on: a correction is not
 * a cache entry to be refreshed.
 */
export function mergeClassification(
  existing: ArticleClassification | undefined,
  incoming: ArticleClassification,
): ArticleClassification {
  if (
    existing &&
    !existing.deletedAt &&
    (existing.status === "confirmed" || existing.status === "rejected")
  ) {
    return existing;
  }
  return incoming;
}

/* ------------------------------------------------------- the proxy call */

export type ClassifyApiResult =
  { ok: true; classification: ClassifySuggestion } | { ok: false; error: string };

/**
 * The browser's only way to reach the classifier. The key, when the reader has
 * supplied their own, travels as a header to our own origin and is never
 * persisted server-side.
 */
export async function requestClassification(input: {
  title: string;
  summary: string;
  topics: ApiTopic[];
  key?: string;
}): Promise<ClassifyApiResult> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.key) headers["x-jev-key"] = input.key;
    const res = await fetch("/api/classify", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: input.title, summary: input.summary, topics: input.topics }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      classification?: ClassifySuggestion;
    };
    if (!data.ok || !data.classification) {
      return { ok: false, error: data.error ?? "Classification failed." };
    }
    return { ok: true, classification: data.classification };
  } catch {
    return { ok: false, error: "Could not reach the classification service." };
  }
}
