import { ensureArticleContent, type ArticleContentResult } from "../article-content";
import { hashString } from "../hash";
import type { LlmConfig } from "../llm";
import * as repo from "../storage/repository";
import type { ArticleClassification, ArticleRecord, SourceRecord } from "../storage/types";
import { prepareCandidates } from "./candidates";
import {
  BRIEFING_LEASE_MS,
  BRIEFING_LIMITS,
  BRIEFING_RUN_TTL_MS,
  PROMPT_VERSIONS,
} from "./constants";
import { createArticleMaterial } from "./materials";
import { citedArticleIds, validateComposition } from "./validate";
import type {
  BriefingEdition,
  BriefingHistoryDigest,
  BriefingRun,
  BriefingSourceSnapshot,
  ComposeInput,
  ComposeOutput,
  GenerateResult,
  RunStatus,
  ShortlistInput,
  ShortlistOutput,
  SupportedText,
} from "./types";

/**
 * The run: Prepare → Shortlist → Enrich → Compose → Validate → Publish.
 *
 * Two rules hold the whole thing together. The inputs are frozen when the
 * reader presses the button — a later RSS refresh may not change what an
 * edition was written from — and every stage that costs money or network
 * writes its checkpoint first, so a crash, a closed tab or a cancelled run can
 * resume on the same frozen input instead of starting the billing again.
 * See docs/specs/ai-daily-briefing.md §9.
 */

export type GenerateFn = (call: {
  phase: "shortlist" | "compose";
  payload: ShortlistInput | ComposeInput;
  retryFeedback?: string[];
  signal?: AbortSignal;
}) => Promise<GenerateResult>;

export type FetchContentFn = (input: {
  article: ArticleRecord;
  source: SourceRecord;
  purpose: "briefing";
  signal?: AbortSignal;
}) => Promise<ArticleContentResult>;

export type BriefingProgress = {
  runId: string;
  status: RunStatus;
  /** Real counts only: "3 of 8 articles checked", never a made-up percentage. */
  detail?: string;
  error?: { code: string; message: string; retryable: boolean };
};

export type BriefingOutcome = {
  run: BriefingRun;
  edition?: BriefingEdition;
  error?: { code: string; message: string; retryable: boolean };
};

export type RunBriefingInput = {
  articles: readonly ArticleRecord[];
  sources: readonly SourceRecord[];
  classifications: readonly ArticleClassification[];
  /** What earlier editions already covered, for the no-repeat rules. */
  history: readonly BriefingHistoryDigest[];
  focusTopicIds: readonly string[];
  timezone: string;
  llm: LlmConfig;
  generate: GenerateFn;
  fetchContent?: FetchContentFn;
  signal?: AbortSignal;
  onProgress?: (progress: BriefingProgress) => void;
  /** Continue a paused/cancelled run on its own frozen input. */
  resume?: BriefingRun;
  owner?: string;
};

/** The reader's local calendar day, never UTC — the date on the masthead. */
export function localDate(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

function storyCited(texts: (SupportedText | null)[]): string[] {
  const ids = new Set<string>();
  for (const text of texts) for (const ref of text?.evidence ?? []) ids.add(ref.articleId);
  return [...ids];
}

function editionIdFor(editionKey: string, revision: number): string {
  return `${editionKey}#r${revision}`;
}

async function nextRevision(editionKey: string): Promise<number> {
  const editions = await repo.getBriefings();
  const mine = editions.filter((edition) => edition.editionKey === editionKey);
  return mine.reduce((n, edition) => Math.max(n, edition.revision), 0) + 1;
}

export async function runBriefing(input: RunBriefingInput): Promise<BriefingOutcome> {
  const started = Date.now();
  const owner = input.owner ?? `tab:${hashString(`${started}:${Math.random()}`)}`;
  const timezone = input.timezone;
  const resume = input.resume;
  const cutoffAt = resume?.cutoffAt ?? Date.now();
  const editionDate = resume ? resume.editionKey.slice(0, 10) : localDate(cutoffAt, timezone);
  const editionKey = resume?.editionKey ?? `${editionDate}@${timezone}`;
  const revision = resume?.revision ?? (await nextRevision(editionKey));
  const promptVersion = `${PROMPT_VERSIONS.shortlist}/${PROMPT_VERSIONS.compose}`;

  // Failed and cancelled runs are working state; only they get cleaned up.
  void repo.cleanupBriefingRuns(Date.now() - BRIEFING_RUN_TTL_MS);

  let run: BriefingRun = resume ?? {
    // The id names the edition slot, not the attempt: two tabs reaching for
    // today's first revision collide on the lease instead of racing.
    runId: editionIdFor(editionKey, revision),
    editionKey,
    revision,
    status: "preparing",
    createdAt: started,
    updatedAt: started,
    cutoffAt,
    snapshotHash: "",
    sourceSnapshots: [],
    promptVersion,
    providerId: input.llm.service,
    modelId: input.llm.models[input.llm.service] ?? "",
    callsUsed: 0,
  };

  // One run at a time across tabs: the lease lives in IndexedDB, where an
  // atomic transaction can actually decide it.
  const claimed = await repo.claimBriefingRun(run, owner, Date.now(), BRIEFING_LEASE_MS);
  if (!claimed) {
    return {
      run,
      error: {
        code: "IN_USE",
        message: "Another tab is already writing this edition.",
        retryable: true,
      },
    };
  }
  run = { ...run, lease: { ownerId: owner, expiresAt: Date.now() + BRIEFING_LEASE_MS } };

  // Two normal calls, one repair call for the whole run — the reader's key is
  // theirs, and "no ceiling on how often" is about pressing the button, not
  // about one press looping at their expense.
  let repairUsed = (resume?.callsUsed ?? 0) >= 2;
  let modelRef: { provider: string; model: string } = {
    provider: run.providerId,
    model: run.modelId,
  };
  let fullTextsFetched = 0;
  let fullTextsFailed = 0;

  const emit = (status: RunStatus, detail?: string, error?: BriefingProgress["error"]) => {
    run = { ...run, status, updatedAt: Date.now(), ...(error ? { error } : {}) };
    input.onProgress?.({ runId: run.runId, status, detail, error });
  };
  const fail = async (code: string, message: string, retryable: boolean) => {
    const error = { code, message, retryable };
    run = { ...run, status: "failed", error, updatedAt: Date.now() };
    await repo.putBriefingRun(run);
    return { run, error } satisfies BriefingOutcome;
  };

  try {
    /* ------------------------------------------------------------ prepare */
    let prepared = run.prepared;
    if (!prepared) {
      emit("preparing");
      const set = prepareCandidates({
        articles: input.articles,
        sources: input.sources,
        classifications: input.classifications,
        cutoffAt,
      });
      if (set.candidates.length === 0) {
        return await fail(
          "INSUFFICIENT_CONTENT",
          "There is not enough subscribed material to write a briefing yet.",
          true,
        );
      }
      prepared = {
        schemaVersion: 1,
        editionDate,
        cutoffAt,
        timezone,
        outputLanguage: "en",
        focusTopicIds: [...input.focusTopicIds].slice(0, BRIEFING_LIMITS.maxFocusTopics),
        candidates: set.candidates,
        previousStories: [...input.history],
      };
      run = {
        ...run,
        prepared,
        sourceSnapshots: set.candidates.map((candidate) => ({
          articleId: candidate.articleId,
          sourceId: candidate.sourceId,
          sourceName: candidate.sourceName,
          title: candidate.title,
          url: null,
          publishedAt: candidate.publishedAt,
        })),
        // A consistency tag over the frozen inputs, not a security hash.
        snapshotHash: hashString(
          JSON.stringify([
            set.candidates.map((c) => c.articleId),
            prepared.focusTopicIds,
            promptVersion,
          ]),
        ).toString(36),
      };
      await repo.putBriefingRun(run);
    }
    const frozenById = new Map(prepared.candidates.map((c) => [c.articleId, c]));
    const articleById = new Map(input.articles.map((a) => [a.id, a]));
    const sourceById = new Map(input.sources.map((s) => [s.id, s]));

    /* --------------------------------------------------------- shortlist */
    let shortlist: ShortlistOutput | undefined = run.shortlist;
    if (!shortlist) {
      emit("shortlisting");
      const answer = await callPhase(run, input, "shortlist", prepared, repairUsed);
      run = answer.run;
      repairUsed = answer.repairUsed;
      if (!answer.result) {
        return await fail(
          answer.error?.code ?? "INVALID_OUTPUT",
          answer.error?.message ?? "The model's answer could not be used.",
          answer.error?.retryable ?? true,
        );
      }
      shortlist = answer.result as ShortlistOutput;
      modelRef = { provider: answer.provider, model: answer.model };
      run = { ...run, shortlist, updatedAt: Date.now() };
      await repo.putBriefingRun(run);
    }

    /* ----------------------------------------------------------- enrich */
    const fetchContent = input.fetchContent ?? ensureArticleContent;
    let materials = run.materials;
    if (!materials) {
      const wanted = [...new Set(shortlist.groups.flatMap((group) => group.articleIds))];
      const mayFetch = new Set(shortlist.extractArticleIds);
      materials = [];
      emit("enriching", `0 of ${wanted.length} articles checked`);
      // The order is the model's priority order; concurrency is bounded and
      // only the extraction list may ever touch the network — one batch at a
      // time is the bound, not an accident.
      /* oxlint-disable no-await-in-loop */
      for (let i = 0; i < wanted.length; i += BRIEFING_LIMITS.extractConcurrency) {
        const slice = wanted.slice(i, i + BRIEFING_LIMITS.extractConcurrency);
        const done = await Promise.all(
          slice.map(async (articleId) => {
            const article = articleById.get(articleId);
            const source = article ? sourceById.get(article.sourceId) : undefined;
            if (!article || !source) return null;
            if (!mayFetch.has(articleId)) {
              return createArticleMaterial({
                article,
                sourceName: source.title,
              });
            }
            const result = await fetchContent({
              article,
              source,
              purpose: "briefing",
              signal: input.signal,
            });
            if (result.error === "cancelled") throw new Error("cancelled");
            if (result.fetched) fullTextsFetched += 1;
            else if (result.error) fullTextsFailed += 1;
            return createArticleMaterial({ article: result.article, sourceName: source.title });
          }),
        );
        for (const material of done) if (material) materials.push(material);
        run = { ...run, materials, updatedAt: Date.now() };
        await repo.putBriefingRun(run);
        const checked = Math.min(i + slice.length, wanted.length);
        emit("enriching", `${checked} of ${wanted.length} articles checked`);
      }
      /* oxlint-enable no-await-in-loop */
      // A group whose every article lost its material cannot be written up.
      materials = materials.filter((m) => m.text.trim().length > 0);
      const kept = new Set(materials.map((m) => m.articleId));
      shortlist = {
        ...shortlist,
        groups: shortlist.groups
          .map((group) => ({
            ...group,
            articleIds: group.articleIds.filter((id) => kept.has(id)),
          }))
          .filter((group) => group.articleIds.length > 0),
        extractArticleIds: shortlist.extractArticleIds.filter((id) => kept.has(id)),
      };
      run = { ...run, materials, shortlist, updatedAt: Date.now() };
      await repo.putBriefingRun(run);
    }

    /* ---------------------------------------------------------- compose */
    let composed = run.composed;
    if (!composed) {
      emit("composing");
      const payload: ComposeInput = {
        schemaVersion: 1,
        editionDate,
        timezone,
        cutoffAt,
        outputLanguage: "en",
        shortlist,
        materials,
        limits: {
          maxStories: BRIEFING_LIMITS.maxStories,
          maxDeepReads: BRIEFING_LIMITS.maxDeepReads,
          targetReadingMinutes: 4,
        },
      };
      const answer = await callPhase(run, input, "compose", payload, repairUsed);
      run = answer.run;
      repairUsed = answer.repairUsed;
      if (!answer.result) {
        return await fail(
          answer.error?.code ?? "INVALID_OUTPUT",
          answer.error?.message ?? "The model's answer could not be used.",
          answer.error?.retryable ?? true,
        );
      }
      composed = answer.result as ComposeOutput;
      modelRef = { provider: answer.provider, model: answer.model };

      // The no-repeat rule needs the history the model was not given: a deep
      // read already recommended is refused here, deterministically.
      const alreadyDeepRead = input.history.flatMap((entry) => entry.sourceArticleIds);
      const recheck = validateComposition(composed, payload, alreadyDeepRead);
      if (!recheck.ok) {
        return await fail("INVALID_OUTPUT", recheck.errors[0] ?? "Not publishable.", true);
      }
      run = { ...run, composed, updatedAt: Date.now() };
      await repo.putBriefingRun(run);
    }

    /* ---------------------------------------------------------- publish */
    emit("validating");
    const cited = citedArticleIds(composed);
    const snapshotFor = (articleId: string): BriefingSourceSnapshot | null => {
      const candidate = frozenById.get(articleId);
      const article = articleById.get(articleId);
      const sourceId = article?.sourceId ?? candidate?.sourceId ?? "";
      return {
        articleId,
        sourceId,
        sourceName: candidate?.sourceName ?? sourceById.get(sourceId)?.title ?? "",
        title: candidate?.title ?? article?.title ?? "",
        url: article?.link ?? null,
        publishedAt: candidate?.publishedAt ?? article?.publishedAt ?? null,
      };
    };
    const now = Date.now();
    const edition: BriefingEdition = {
      id: editionIdFor(editionKey, revision),
      editionKey,
      editionDate,
      timezone,
      revision,
      cutoffAt,
      generatedAt: now,
      schemaVersion: 1,
      promptVersion,
      model: modelRef,
      sourceSnapshots: cited
        .map(snapshotFor)
        .filter((s): s is BriefingSourceSnapshot => s !== null),
      bigPicture: composed.bigPicture,
      topStories: composed.topStories.map((story, index) => ({
        ...story,
        id: `s${index + 1}`,
        sourceArticleIds: storyCited([story.whatHappened, story.context, story.whyItMatters]),
      })),
      worthReading: composed.worthReading,
      stats: {
        candidates: prepared.candidates.length,
        sourcesConsidered: new Set(prepared.candidates.map((c) => c.sourceId)).size,
        fullTextsFetched,
        fullTextsFailed,
        llmRequests: run.callsUsed,
        durationMs: now - started,
      },
      updatedAt: now,
    };
    run = { ...run, status: "ready", error: undefined, updatedAt: now };
    // One transaction: a published edition and its run's `ready` marker land
    // together, or neither does.
    await repo.publishBriefing(edition, run);
    emit("ready");
    return { run, edition };
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.message === "cancelled")) {
      run = { ...run, status: "cancelled", updatedAt: Date.now() };
      await repo.putBriefingRun(run);
      return {
        run,
        error: { code: "CANCELLED", message: "The run was cancelled.", retryable: true },
      };
    }
    return await fail("PROVIDER_ERROR", error instanceof Error ? error.message : "failed", true);
  }
}

/**
 * One phase with at most one repair call. The repair repeats the very same
 * frozen input with the validator's field-level complaints attached — it never
 * changes the question to get a prettier answer.
 */
async function callPhase(
  run: BriefingRun,
  input: RunBriefingInput,
  phase: "shortlist" | "compose",
  payload: ShortlistInput | ComposeInput,
  repairUsed: boolean,
): Promise<{
  run: BriefingRun;
  result?: ShortlistOutput | ComposeOutput;
  repairUsed: boolean;
  provider: string;
  model: string;
  error?: { code: string; message: string; retryable: boolean };
}> {
  let calls = run.callsUsed;
  const ask = (feedback?: string[]) =>
    input.generate({ phase, payload, retryFeedback: feedback, signal: input.signal });

  let answer = await ask();
  calls += 1;
  let nextRun = { ...run, callsUsed: calls, updatedAt: Date.now() };
  if (answer.ok) {
    return {
      run: nextRun,
      result: answer.result,
      repairUsed,
      provider: answer.provider,
      model: answer.model,
    };
  }

  if (answer.retryable && !repairUsed && calls < 3) {
    const feedback = answer.errors ?? [answer.code];
    const retry = await ask(feedback);
    calls += 1;
    nextRun = { ...nextRun, callsUsed: calls };
    if (retry.ok) {
      return {
        run: nextRun,
        result: retry.result,
        repairUsed: true,
        provider: retry.provider,
        model: retry.model,
      };
    }
    return {
      run: nextRun,
      repairUsed: true,
      provider: "",
      model: "",
      error: { code: retry.code, message: retry.message, retryable: retry.retryable },
    };
  }

  return {
    run: nextRun,
    repairUsed,
    provider: "",
    model: "",
    error: { code: answer.code, message: answer.message, retryable: answer.retryable },
  };
}

/** Everything an edition's history list needs, newest first. */
export async function loadBriefings(): Promise<BriefingEdition[]> {
  const editions = await repo.getBriefings();
  return editions.toSorted((a, b) => b.generatedAt - a.generatedAt);
}

/** A run worth resuming is one that stopped with its input frozen. */
export async function loadResumableRun(): Promise<BriefingRun | undefined> {
  const runs = await repo.listBriefingRuns();
  return runs
    .filter((run) => run.status !== "ready" && Boolean(run.prepared))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
}
