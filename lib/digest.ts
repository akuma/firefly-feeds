import { blocksToText } from "./feed-html";
import { findLanguage, type DigestLanguage, type DigestLanguageId } from "./languages";
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
 * The most one prompt ever carries: the newest stories, and never past the
 * point where the text stops fitting a context and a bill.
 *
 * Measured in characters rather than stories, because a count is not a bound:
 * a story with a long excerpt costs more than one with a short one. When it
 * bites, the copy says how many of the day were offered rather than quietly
 * counting them all.
 */
export const DIGEST_OFFER_LIMIT = 50;
export const DIGEST_OFFER_BUDGET = 24_000;

/**
 * What the first edition covers when there is no earlier one to abut: a day.
 * Every edition after it covers what arrived since the one before.
 */
export const DIGEST_FIRST_WINDOW_MINUTES = 60 * 24;

/** Input caps, enforced before anything leaves the device. */
export const DIGEST_TITLE_LIMIT = 300;

/** Output caps. An over-long line is dropped rather than truncated: a gist that
 * has to be cut off mid-sentence is not a gist, and the layout has no room for
 * one. The ceiling is per language — `DigestLanguage.lineLimit` — because a
 * sentence carries more per character where characters are words. */
export const DIGEST_GIST_LIMIT = 120;
export const DIGEST_WHY_LIMIT = 120;

/**
 * How long a briefing may take.
 *
 * This is a watchdog, not a budget: it stops a request that has hung, and it is
 * deliberately far past anything a decision takes. Measured on a real prompt —
 * five candidates and a paragraph of interests — a 27B thinking model on a
 * laptop needed more than the sixty seconds this used to allow, and DeepSeek's
 * own docs say a thinking answer takes longer than a plain one. Three minutes
 * is room for a model to think and still be worth waiting for; the page is
 * telling the reader it is writing the whole time.
 */
export const DIGEST_TIMEOUT_MS = 180_000;

/** One story as the model sees it: an id to point back at, a title, and the
 * article's own words where we have them. */
export type DigestCandidate = { id: string; title: string; excerpt: string };

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

/** The newest of a day's stories, and never more than one prompt carries. */
export function offerCandidates(
  candidates: readonly DigestCandidate[],
): readonly DigestCandidate[] {
  const offered: DigestCandidate[] = [];
  let spent = 0;
  for (const candidate of candidates) {
    const cost = candidate.title.length + candidate.excerpt.length;
    // One story is always offered, so a single long one cannot empty the day.
    if (offered.length > 0 && spent + cost > DIGEST_OFFER_BUDGET) break;
    offered.push(candidate);
    spent += cost;
  }
  return offered.slice(0, DIGEST_OFFER_LIMIT);
}

/** How much of a story the model is given. */
export const DIGEST_EXCERPT_LIMIT = 700;

/**
 * What the model is given about a story: the article itself where we have it.
 *
 * A feed's summary is what the publisher says about the piece and is usually a
 * teaser, so a gist written from one is a paraphrase of a paraphrase — which is
 * how a description ends up describing nothing. The body is where the number
 * and the name are, and the number and the name are what make a line worth
 * reading.
 */
export function excerptFor(story: Story): string {
  const body = blocksToText(story.body);
  return (body || story.dek.trim()).slice(0, DIGEST_EXCERPT_LIMIT);
}

/**
 * The raw material: the unread stories that have arrived since the last
 * edition, newest first, all of them.
 *
 * The sample edition is excluded for the same reason it is never classified —
 * its input would be invented, and a gist about a story that does not exist
 * reads as a claim about real writing. Nothing is fetched to fill a gap: a story
 * with no summary is judged on its cached body, exactly as classification is.
 */
export function selectCandidates(
  stories: readonly Story[],
  read: Readonly<Record<string, boolean>>,
  maxAgeMinutes: number,
): DigestCandidate[] {
  return stories
    .filter(
      (story) =>
        story.live === true &&
        !read[story.id] &&
        // Everything since the last edition, and nothing older. That is what
        // separates one day's edition from the next: the windows abut, so two
        // editions can never share a story and none can fall between them.
        // Nothing is excluded for having been picked before — there is nothing
        // to exclude, because a story is offered to exactly one edition.
        story.minutesAgo <= maxAgeMinutes,
    )
    .toSorted((a, b) => a.minutesAgo - b.minutesAgo)
    .map((story) => ({
      id: story.id,
      title: story.title.slice(0, DIGEST_TITLE_LIMIT),
      excerpt: excerptFor(story),
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

/** How much of themselves a reader may say. A paragraph, not an essay. */
export const DIGEST_INTERESTS_LIMIT = 600;

function systemPrompt(language: DigestLanguage, interests: string): string {
  // A named language is one instruction among the rest, not the whole prompt:
  // the contract stays in one language so it is readable where it is written,
  // and only the words the reader will see are asked for in theirs.
  const writtenIn = language.promptName
    ? `Write both fields in ${language.promptName}. Keep the names of people, companies, products and code in their original form.`
    : "Write both fields in the language of the story itself.";
  // A reader who has said what they care about has changed the job: the
  // edition is then for them, not for a reader nobody has met. Without it the
  // old job stands, because a guess at somebody's interests is worse than an
  // edition that makes no claim to know them.
  const about = interests.trim()
    ? `What this reader says about their taste:\n${interests.trim()}\n`
    : "";
  const forWhom = interests.trim() ? "this reader" : "a broadly curious reader";
  const weight = interests.trim()
    ? "Use it as taste, not as a list of subjects. Where it names a kind of piece they like or skip, that decides the pick: a piece of the kind they skip is out however big it is, and a piece of the kind they like beats one that is merely important. Where it names a subject, a story on it beats a story that is merely big."
    : "";
  return `You are the editor of a daily edition. You are given a numbered list of today's unread stories, each as an id in square brackets, a title, and a summary.

${about}Choose up to the ${DIGEST_PICKS} ${forWhom} would most want to read today, best first. ${weight} Never choose more than 2 stories from the same publication. Prefer range over several pieces on the same subject. Never pad the edition to reach the number: if fewer pass, return fewer, and a piece of a kind they skip is never included to make up the count.

For each chosen story write two fields:
- "gist": one sentence, at most ${language.lineLimit} characters, carrying the one specific detail that makes this piece worth three minutes — the number, the name, the finding, the mechanism. Not a description of a document: never "this article covers" or its equivalents, never the title in other words.
- "why": one sentence, at most ${language.lineLimit} characters, giving the stake in plain terms — what it changes, what is still open, what ${forWhom} will see or know after reading. It must add something the gist has not given: no restating the gist, no taste-talk such as "this fits your interest in X", and never "interesting", "important" or "worth reading". Stay inside the text: no claims about industries, history or society that it does not make. A piece with no stake is allowed to have none — say plainly what it is rather than manufacture one.

Rules:
- Use only the titles and summaries you were given. Never add a fact, number, quote, person or link that is not in them.
- ${writtenIn}
- Do not write the five in one shape: vary what each sentence leads with, in both fields.
- Reply with a JSON array of { "id", "gist", "why" } objects, in the order you chose them, and with the id copied exactly from the list.
- Nothing else in your reply: no prose before or after, and no markdown fence.`;
}

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
export function buildDigestMessages(
  candidates: readonly DigestCandidate[],
  languageId: DigestLanguageId = "source",
  interests = "",
): LlmMessage[] {
  const language = findLanguage(languageId);
  const list = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. [${candidate.id}] ${candidate.title}\n${candidate.excerpt}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: systemPrompt(language, interests) },
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
export function parseDigest(
  raw: string,
  knownIds: ReadonlySet<string>,
  lineLimit: number = DIGEST_GIST_LIMIT,
): DigestPick[] {
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
    const gist = text(record?.gist, lineLimit);
    const why = text(record?.why, lineLimit);
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
  language?: DigestLanguageId;
  interests?: string;
}): Promise<DigestResult> {
  const service = findService(input.llm.service);
  if (!service) return { ok: false, error: "Choose a model in Settings." };
  if (!serviceReady(service, input.llm)) {
    const missing = service.fields
      .filter((field) => !field.optional && !llmFieldValue(input.llm, field).trim())
      .map((field) => field.label);
    return { ok: false, error: `${service.label} still needs: ${missing.join(", ")}.` };
  }

  const messages = buildDigestMessages(
    input.candidates,
    input.language ?? "source",
    input.interests ?? "",
  );
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
        language: input.language ?? "source",
        interests: input.interests ?? "",
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
