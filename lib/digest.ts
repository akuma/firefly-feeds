import { blocksToText } from "./feed-html";
import {
  findService,
  llmFieldValue,
  readLlmReply,
  serviceReady,
  type LlmConfig,
  type LlmMessage,
} from "./llm";
import type { DigestRecord } from "./storage/types";
import type { Story } from "./types";

/**
 * Today's briefing: which of today's stories are worth a reader's time, and one
 * line each on what they are and why.
 *
 * The whole module is pure except `requestDigest`, so the rules that matter —
 * what counts as a candidate, what the model is allowed to say, and which of its
 * answers may be shown — are testable without a network, a database or a DOM.
 *
 * Two of those rules are the feature:
 *
 *   1. **One edition a day.** A briefing is dated, not live. It does not move
 *      when a feed refreshes, because a reader who has already read it should
 *      not find it rewritten underneath them, and because "regenerate on every
 *      refresh" is how a paid key gets spent.
 *   2. **Nothing is shown that cannot be traced.** The model is given titles and
 *      summaries and nothing else, and its answer is accepted only where every
 *      picked id is one it was given. That is what keeps a gist a summary of a
 *      real story rather than a plausible sentence about nothing.
 */

/** How many stories make the edition. */
export const DIGEST_PICKS = 5;

/**
 * Below this there is no edition to write. Three unread stories is a quiet day,
 * and "your three stories, ranked" is not an editorial act — it is a list.
 */
export const DIGEST_MIN_CANDIDATES = 3;

/**
 * The most stories sent in one call. This is half the cost control for the
 * feature; `LLM_MAX_TOKENS` is the other half. Between them, the worst a single
 * request can cost is knowable in advance, which is why the endpoint needs no
 * rate limiter of its own.
 */
export const DIGEST_MAX_CANDIDATES = 20;

/** A day, for "today's stories". */
const DAY_MINUTES = 60 * 24;

/** Input caps, enforced before anything leaves the device. */
export const DIGEST_TITLE_LIMIT = 300;
export const DIGEST_SUMMARY_LIMIT = 300;

/** Output caps. An over-long line is dropped rather than truncated: a gist that
 * has to be cut off mid-sentence is not a gist, and the layout has no room for
 * one. */
export const DIGEST_GIST_LIMIT = 120;
export const DIGEST_WHY_LIMIT = 120;

/**
 * Manual rewrites a reader gets in a day. The daily edition itself is not
 * counted: it is written once, on its own, whether or not the reader is watching.
 */
export const DIGEST_MAX_PER_DAY = 6;

/**
 * How long a briefing may take. Longer than a decision by an order of magnitude,
 * because writing five sentences is not choosing one slug — and a local model on
 * a laptop is slower still.
 */
export const DIGEST_TIMEOUT_MS = 60_000;

/** One story as the model sees it: an id to point back at, a title, a summary. */
export type DigestCandidate = { id: string; title: string; summary: string };

/** One accepted line of the edition. */
export type DigestPick = { id: string; gist: string; why: string };

/* ------------------------------------------------------------------- day */

/**
 * The reader's own calendar day, not a UTC one.
 *
 * "Today's edition" means the day the reader is living in, so a reader in Tokyo
 * at 01:00 gets the edition for that date and not for yesterday's UTC one.
 */
export function dayKey(at: number = Date.now()): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/* ------------------------------------------------------------- candidates */

/**
 * The raw material: today's unread stories from real subscriptions, newest first.
 *
 * The sample edition is excluded for the same reason it is never classified —
 * its input would be invented, and a gist about a story that does not exist
 * reads as a claim about real writing. Nothing is fetched to fill a gap: a story
 * with no summary is judged on its cached body, exactly as classification is.
 */
export function selectCandidates(
  stories: readonly Story[],
  read: Readonly<Record<string, boolean>>,
): DigestCandidate[] {
  return stories
    .filter((story) => story.live === true && !read[story.id] && story.minutesAgo < DAY_MINUTES)
    .toSorted((a, b) => a.minutesAgo - b.minutesAgo)
    .slice(0, DIGEST_MAX_CANDIDATES)
    .map((story) => ({
      id: story.id,
      title: story.title.slice(0, DIGEST_TITLE_LIMIT),
      summary: (story.dek.trim() || blocksToText(story.body)).slice(0, DIGEST_SUMMARY_LIMIT),
    }));
}

/** Whether today's edition is missing a story that has since arrived. */
export function digestIsStale(
  record: DigestRecord | undefined,
  candidates: readonly DigestCandidate[],
): boolean {
  return staleCount(record, candidates) > 0;
}

/**
 * How many candidates arrived after this edition was written.
 *
 * Arrival, not any change: a story that has since been read and dropped out of
 * the list does not make an edition the reader has already read wrong, and
 * saying so would invite a rewrite that adds nothing.
 */
export function staleCount(
  record: DigestRecord | undefined,
  candidates: readonly DigestCandidate[],
): number {
  if (!record) return 0;
  const written = new Set(record.candidates);
  return candidates.filter((candidate) => !written.has(candidate.id)).length;
}

/* ------------------------------------------------------------------ prompt */

const SYSTEM = `You are the editor of a daily edition. You are given a numbered list of today's unread stories, each as an id in square brackets, a title, and a summary.

Choose the ${DIGEST_PICKS} a broadly curious reader would most want to read today, best first. Never choose more than 2 stories from the same publication. Prefer range over several pieces on the same subject.

For each chosen story write two fields:
- "gist": one sentence, at most ${DIGEST_GIST_LIMIT} characters, saying what the piece is.
- "why": one sentence, at most ${DIGEST_WHY_LIMIT} characters, saying why this reader might want it. Never write "interesting", "important" or "worth reading" — those say nothing.

Rules:
- Use only the titles and summaries you were given. Never add a fact, number, quote, person or link that is not in them.
- Write the gist in the language of the story itself.
- Reply with a JSON array of { "id", "gist", "why" } objects, in the order you chose them, and with the id copied exactly from the list.
- Nothing else in your reply: no prose before or after, and no markdown fence.`;

/**
 * The messages, built by one function both callers use.
 *
 * The server writes the prompt for the same reason it writes the classification
 * question: a request that carried its own instructions would be a general LLM
 * proxy with our domain on it. A local Ollama is called straight from the
 * browser, because our own server cannot reach the reader's machine — so the
 * browser builds the messages too, from this same function, and the prompt is
 * still not something a caller can supply.
 */
export function buildDigestMessages(candidates: readonly DigestCandidate[]): LlmMessage[] {
  const list = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. [${candidate.id}] ${candidate.title}\n${candidate.summary}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Today's unread stories:\n\n${list}` },
  ];
}

/* ----------------------------------------------------------------- parsing */

/**
 * Turn a model's reply into the lines that may be shown, or into nothing.
 *
 * Every rule here exists to refuse rather than to repair. An id the model was
 * not given is dropped, because a gist attached to the wrong story is worse than
 * no gist; a field over its limit is dropped, because the edition's layout has
 * no room for a sentence that had to be cut; and a reply from which nothing
 * survives is a failure, shown as one, rather than half an edition.
 */
export function parseDigest(raw: string, knownIds: ReadonlySet<string>): DigestPick[] {
  const json = firstJSONArray(raw);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const picks: DigestPick[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const record = asRecord(entry);
    const id = typeof record?.id === "string" ? record.id : "";
    const gist = text(record?.gist, DIGEST_GIST_LIMIT);
    const why = text(record?.why, DIGEST_WHY_LIMIT);
    if (!knownIds.has(id) || seen.has(id) || !gist || !why) continue;
    seen.add(id);
    picks.push({ id, gist, why });
    if (picks.length >= DIGEST_PICKS) break;
  }
  return picks;
}

/**
 * The first JSON array in a reply, fences and all.
 *
 * Models wrap JSON in markdown despite being told not to, and some preface it
 * with a sentence. Slicing from the first `[` to the last `]` accepts both
 * without teaching the parser anything about prose.
 */
function firstJSONArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A trimmed string within its limit, or empty — never a truncated sentence. */
function text(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : "";
}

/* ------------------------------------------------------------------- call */

export type DigestResult =
  { ok: true; text: string; provider?: string; model?: string } | { ok: false; error: string };

/**
 * Ask the reader's own model to write today's edition.
 *
 * A local Ollama is reached straight from the browser — the request leaves from
 * the reader's machine either way, and it is the one address our own server
 * cannot see. Everything else goes to this app's own endpoint, which is what
 * keeps a credential off the page: the reader's key travels in the body of a
 * same-origin request and is never persisted anywhere server-side.
 */
export async function requestDigest(input: {
  candidates: readonly DigestCandidate[];
  llm: LlmConfig;
}): Promise<DigestResult> {
  const service = findService(input.llm.service);
  if (!service) return { ok: false, error: "Choose a model in Settings." };
  if (!serviceReady(service, input.llm)) {
    const missing = service.fields
      .filter((field) => !field.optional && !llmFieldValue(input.llm, field).trim())
      .map((field) => field.label);
    return { ok: false, error: `${service.label} still needs: ${missing.join(", ")}.` };
  }

  const messages = buildDigestMessages(input.candidates);
  const direct = service.direct?.(input.llm) === true;

  try {
    if (direct) {
      const call = service.call(input.llm, messages);
      const res = await fetch(call.url, {
        method: "POST",
        headers: call.headers,
        body: JSON.stringify(call.body),
        signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
      });
      const reply = await readLlmReply(res, service, input.llm);
      if (!reply.ok) return { ok: false, error: reply.error };
      return { ok: true, text: reply.text, provider: service.id };
    }

    const res = await fetch("/api/digest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidates: input.candidates,
        ...input.llm,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      text?: string;
      provider?: string;
      model?: string;
    };
    if (!data.ok || typeof data.text !== "string") {
      return { ok: false, error: data.error ?? "Today's briefing could not be written." };
    }
    return {
      ok: true,
      text: data.text,
      ...(data.provider ? { provider: data.provider } : {}),
      ...(data.model ? { model: data.model } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && direct
          ? "Could not reach Ollama. Is it running, and does it allow this page? Set OLLAMA_ORIGINS to this site's address."
          : "Could not reach the model.",
    };
  }
}
