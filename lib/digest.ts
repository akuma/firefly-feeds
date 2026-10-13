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
import type { FeedId, Story } from "./types";

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
 *   2. **Nothing is shown that cannot be traced.** The model is given titles,
 *      publications and summaries and nothing else, and its answer is accepted
 *      only where every picked id is one it was given and no more than two come
 *      from one publication. That is what keeps a gist a summary of a real
 *      story rather than a plausible sentence about nothing, and the edition a
 *      spread across the day's feeds rather than five stories from whichever
 *      publication sent most.
 */

/** How many stories make the edition. */
export const DIGEST_PICKS = 5;

/**
 * How many of those may come from one publication.
 *
 * The spread is the edition's value — five pieces from the publisher who sent
 * the most is a feed, not an edit — so the rule is in the prompt and held to in
 * the parser: without the publication's name in the prompt it could not be
 * followed at all, and without the parser it would only be advice.
 */
export const DIGEST_PER_PUBLICATION = 2;

/**
 * Below this there is no edition to write.
 *
 * The value of a briefing is the choosing: five out of many. Five out of eight
 * is barely a choice, and five out of three is not one at all — that is a list,
 * and the reader can read a list. Counted here is what can actually be chosen
 * from: today's unread. Read stories are not candidates, so a busy day read to
 * the end can still be too small to brief.
 */
export const DIGEST_MIN_CANDIDATES = 10;

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
 * How far back a day's edition reaches, in minutes — the same measure the
 * Today column uses, so the two never disagree about what today holds. The
 * parameter is the window rather than a fixed day because "today" is a
 * distance from midnight that grows until midnight comes round again.
 */

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

/** One story as the model sees it: an id to point back at, a title, the
 * publication it came from, and the article's own words where we have them. */
export type DigestCandidate = {
  id: string;
  title: string;
  /** The publication's name — the one fact the per-publication rule needs. */
  source: string;
  excerpt: string;
};

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
 * The raw material: today's unread stories from real subscriptions, newest
 * first, all of them.
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
  nameOf: (feedId: FeedId) => string,
): DigestCandidate[] {
  return stories
    .filter(
      (story) =>
        story.live === true &&
        !read[story.id] &&
        // Today, and nothing older. The day is what separates one edition
        // from the next: yesterday's stories were yesterday's edition to
        // choose from, so two days can never share a story and none falls
        // between them. Nothing is excluded for having been picked before —
        // there is nothing to exclude, because a story is offered to exactly
        // one day.
        story.minutesAgo <= maxAgeMinutes,
    )
    .toSorted((a, b) => a.minutesAgo - b.minutesAgo)
    .map((story) => ({
      id: story.id,
      title: story.title.slice(0, DIGEST_TITLE_LIMIT),
      // The publication travels with the story: a rule about spread cannot be
      // followed by a model that cannot tell which stories are whose.
      source: nameOf(story.feedId),
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

/** What a previous attempt got wrong, so the next call can say so. */
export type DigestReminder =
  { kind: "tighten" } | { kind: "spread"; source: string } | { kind: "few"; picked: number };

/**
 * The correction, in our words rather than the caller's.
 *
 * A request that carried its own instructions would be a general LLM proxy, so
 * the wire carries a kind and a number and every word of this is written here.
 * What it names is data, and only ever what the request itself offered.
 */
function reminderNote(reminder: DigestReminder, total: number): string {
  if (reminder.kind === "spread") {
    return `A previous attempt at this edition chose every story from ${reminder.source} and stopped — one publication's column, not an edition. Answer again: five stories in total, best first, at most two from any one publication, drawn from at least three of the publications listed above, and not more than two of them from ${reminder.source}.`;
  }
  if (reminder.kind === "few") {
    return `A previous attempt at this edition chose only ${reminder.picked} of the ${total} stories offered, though the day holds enough for ${DIGEST_PICKS}. Answer again with ${DIGEST_PICKS} stories, best first — at most two from any one publication, drawn from at least three publications where the list offers them — and stop only where the list genuinely cannot fill ${DIGEST_PICKS}.`;
  }
  return `A note on a previous attempt at this edition: it was not usable — it was not a JSON array of { "id", "gist", "why" } objects, or its lines were over the character limit. Answer again with the JSON array alone — five objects when the list justifies it — and keep every gist and why within the character limit stated above.`;
}

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
  return `You are the editor of a daily edition. You are given today's unread stories, grouped by publication: under each publication, a numbered list of its stories, each as an id in square brackets, a title, and a summary.

${about}Choose the ${DIGEST_PICKS} ${forWhom} would most want to read today, best first. ${weight} Five is the edition when the list holds five worth three minutes — it usually does: return fewer only when it genuinely does not, and never pad with a piece of a kind they skip to make up the count. The edition is a spread across the publications below, counted like this: at most ${DIGEST_PER_PUBLICATION} stories from any one publication — a good edition is 2 + 2 + 1 from three different publications — and never all ${DIGEST_PICKS} from one. Only when the whole list is a single publication do you take its best ${DIGEST_PICKS}. Prefer range over several pieces on the same subject.

For each chosen story write two fields:
- "gist": one sentence, at most ${language.lineLimit} characters, carrying the one specific detail that makes this piece worth three minutes — the number, the name, the finding, the mechanism. Not a description of a document: never "this article covers" or its equivalents, never the title in other words.
- "why": one sentence, at most ${language.lineLimit} characters, giving the stake in plain terms — what it changes, what is still open, what ${forWhom} will see or know after reading. It must add something the gist has not given: no restating the gist, no taste-talk such as "this fits your interest in X", and never "interesting", "important" or "worth reading". Stay inside the text: no claims about industries, history or society that it does not make. A piece with no stake is allowed to have none — say plainly what it is rather than manufacture one.

Rules:
- Use only the titles, summaries and publication names you were given. Never add a fact, number, quote, person or link that is not in them.
- ${writtenIn}
- Do not write the five in one shape: vary what each sentence leads with, in both fields.
- Reply with a JSON array of { "id", "gist", "why" } objects — ${DIGEST_PICKS} objects when the day offers ${DIGEST_PICKS} worth reading — in the order you chose them, and with the id copied exactly from the list.
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
  reminder?: DigestReminder,
): LlmMessage[] {
  const language = findLanguage(languageId);
  // Grouped, not interleaved: the per-publication rule is one a model follows
  // when the stories arrive in publication piles, and misreads when a long
  // flat list buries the name three lines above each title.
  const byPublication = new Map<string, DigestCandidate[]>();
  for (const candidate of candidates) {
    const group = byPublication.get(candidate.source) ?? [];
    group.push(candidate);
    byPublication.set(candidate.source, group);
  }
  let number = 0;
  const groups = [...byPublication.entries()];
  // A model that over-used one pile is shown the other piles first on the
  // second call, so its answer is not anchored on the same one again.
  if (reminder?.kind === "spread") {
    groups.sort(([a], [b]) => (a === reminder.source ? 1 : b === reminder.source ? -1 : 0));
  }
  const list = groups
    .map(([source, group]) => {
      const entries = group
        .map((candidate) => {
          number += 1;
          return `${number}. [${candidate.id}] ${candidate.title}\n${candidate.excerpt}`;
        })
        .join("\n\n");
      return `Publication: ${source || "unknown"}\n${entries}`;
    })
    .join("\n\n");
  return [
    {
      role: "system",
      content: reminder
        ? `${systemPrompt(language, interests)}\n\n${reminderNote(reminder, candidates.length)}`
        : systemPrompt(language, interests),
    },
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
 * no room for a sentence that had to be cut; a third story from one publication
 * is dropped, because the spread is the edition's promise and not a hope; and a
 * reply from which nothing survives is a failure, shown as one, rather than
 * half an edition. An edition-level question is left to the caller:
 * `concentratedPublication` says when what survived is one publisher's column.
 */
export function parseDigest(
  raw: string,
  /** Every offered id, mapped to the publication it came from. */
  offered: ReadonlyMap<string, string>,
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
  const perPublication = new Map<string, number>();
  // The spread rule binds only where there is a spread to keep: when the day
  // offered a single publication, its stories compete on merit alone.
  const spreadPossible = new Set(offered.values()).size > 1;
  for (const entry of parsed) {
    const record = asRecord(entry);
    const id = typeof record?.id === "string" ? record.id : "";
    const gist = text(record?.gist, lineLimit);
    const why = text(record?.why, lineLimit);
    if (!offered.has(id) || seen.has(id) || !gist || !why) continue;
    // The model is told this rule too; here is where it stops being advice. A
    // story whose publication is unknown is not capped — there is nothing to
    // count it against.
    const publication = offered.get(id) ?? "";
    const used = perPublication.get(publication) ?? 0;
    if (spreadPossible && publication && used >= DIGEST_PER_PUBLICATION) continue;
    if (publication) perPublication.set(publication, used + 1);
    seen.add(id);
    picks.push({ id, gist, why });
    if (picks.length >= DIGEST_PICKS) break;
  }
  return picks;
}

/**
 * Which publication an edition drew on alone, or null when it is a spread.
 *
 * Two or more picks from a single publisher are not an edition where the day
 * offered several — it is one publisher's column, and the reader who was
 * promised a spread is being shown something else. The answer is then refused
 * as a failure rather than written as a stub: half an edition is worse than
 * none, the name goes into what the next attempt is told, and the reader sees
 * both facts. One pick is not a column, and a day that offered a single
 * publication cannot spread at all; both are shown.
 */
export function concentratedPublication(
  picks: readonly DigestPick[],
  offered: ReadonlyMap<string, string>,
): string | null {
  if (picks.length < 2) return null;
  if (new Set(offered.values()).size <= 1) return null;
  const publications = new Set(picks.map((pick) => offered.get(pick.id) ?? ""));
  return publications.size === 1 ? [...publications][0] || null : null;
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
  /** What a previous attempt got wrong, told to the model in our words. */
  reminder?: DigestReminder;
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
    input.reminder,
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
        ...(input.reminder
          ? {
              reminder: input.reminder.kind,
              ...(input.reminder.kind === "spread"
                ? { reminderSource: input.reminder.source }
                : {}),
              ...(input.reminder.kind === "few" ? { reminderCount: input.reminder.picked } : {}),
            }
          : {}),
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
