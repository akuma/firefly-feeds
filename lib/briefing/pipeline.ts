import { ensureArticleContent, type ArticleContentResult } from "../article-content";
import type { DigestLanguageId } from "../languages";
import { hashString } from "../hash";
import type { LlmConfig } from "../llm";
import * as repo from "../storage/repository";
import type { ArticleClassification, ArticleRecord, SourceRecord } from "../storage/types";
import { canonicalUrl, prepareCandidates } from "./candidates";
import {
  BRIEFING_LEASE_MS,
  BRIEFING_LIMITS,
  BRIEFING_RUN_TTL_MS,
  PROMPT_VERSIONS,
} from "./constants";
import { isCompactReply } from "./prompts";
import { createArticleMaterial, fitComposeInput } from "./materials";
import { rankGroups } from "./score";
import {
  citedArticleIds,
  pruneWeakComposition,
  validateComposition,
  validateShortlist,
} from "./validate";
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
  topics?: Array<{ id: string; label: string }>;
  timezone: string;
  outputLanguage?: DigestLanguageId;
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
  const [editions, runs] = await Promise.all([repo.getBriefings(), repo.listBriefingRuns()]);
  return (
    [...editions, ...runs]
      .filter((record) => record.editionKey === editionKey)
      .reduce((n, record) => Math.max(n, record.revision), 0) + 1
  );
}

export async function runBriefing(input: RunBriefingInput): Promise<BriefingOutcome> {
  const started = Date.now();
  const focusTopicIds = [...new Set(input.focusTopicIds)]
    .filter((id) => !input.topics || input.topics.some((topic) => topic.id === id))
    .slice(0, BRIEFING_LIMITS.maxFocusTopics);
  const owner = input.owner ?? `tab:${hashString(`${started}:${Math.random()}`)}`;
  const timezone = input.resume?.prepared?.timezone ?? input.timezone;
  const resume = input.resume;
  const outputLanguage = resume?.prepared?.outputLanguage ?? input.outputLanguage ?? "en";
  const cutoffAt = resume?.cutoffAt ?? Date.now();
  const editionDate = resume ? resume.editionKey.slice(0, 10) : localDate(cutoffAt, timezone);
  const editionKey = resume?.editionKey ?? `${editionDate}@${timezone}`;
  const revision = resume?.revision ?? (await nextRevision(editionKey));
  const promptVersion = `${PROMPT_VERSIONS.shortlist}/${PROMPT_VERSIONS.compose}`;

  // Failed and cancelled runs are working state; only they get cleaned up.
  await repo.cleanupBriefingRuns(Date.now() - BRIEFING_RUN_TTL_MS);

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
        message: "This task is already saved, active elsewhere, or superseded by a newer attempt.",
        retryable: true,
      },
    };
  }
  run = {
    ...((await repo.getBriefingRun(run.runId)) ?? run),
    lease: { ownerId: owner, expiresAt: Date.now() + BRIEFING_LEASE_MS },
  };

  // Two normal calls, one repair call for the whole run — the reader's key is
  // theirs, and "no ceiling on how often" is about pressing the button, not
  // about one press looping at their expense.
  let repairUsed = run.repairUsed ?? (resume?.callsUsed ?? 0) >= 2;
  let modelRef: { provider: string; model: string } = {
    provider: run.providerId,
    model: run.modelId,
  };
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void repo
      .renewBriefingLease(run.runId, owner, Date.now() + BRIEFING_LEASE_MS)
      .then((owned) => {
        if (!owned) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, BRIEFING_LEASE_MS / 3);
  const check = () => {
    if (input.signal?.aborted) throw new Error("cancelled");
    if (leaseLost) throw new Error("The briefing lease was lost. Resume in the active tab.");
  };
  const checkpoint = async () => {
    check();
    run = { ...run, lease: { ownerId: owner, expiresAt: Date.now() + BRIEFING_LEASE_MS } };
    await repo.putBriefingRun(run);
  };

  const emit = (status: RunStatus, detail?: string, error?: BriefingProgress["error"]) => {
    run = { ...run, status, updatedAt: Date.now(), ...(error ? { error } : {}) };
    input.onProgress?.({ runId: run.runId, status, detail, error });
  };
  const fail = async (code: string, message: string, retryable: boolean) => {
    const error = { code, message, retryable };
    run = {
      ...run,
      stats: { ...run.stats, durationMs: (run.stats?.durationMs ?? 0) + Date.now() - started },
      status: "failed",
      error,
      updatedAt: Date.now(),
    };
    await repo.putBriefingRun(run);
    return { run, error } satisfies BriefingOutcome;
  };

  try {
    check();
    /* ------------------------------------------------------------ prepare */
    let prepared = run.prepared;
    if (!prepared) {
      emit("preparing");
      const set = prepareCandidates({
        articles: input.articles,
        sources: input.sources,
        classifications: input.classifications,
        focusTopicIds,
        activeTopicIds: input.topics?.map((topic) => topic.id),
        cutoffAt,
      });
      if (set.candidates.length === 0) {
        return await fail(
          "INSUFFICIENT_CONTENT",
          focusTopicIds.length
            ? "No subscribed material matches the selected topics yet. Change your focus topics or try again when more articles arrive."
            : "There is not enough subscribed material to write a briefing yet.",
          true,
        );
      }
      prepared = {
        schemaVersion: 1,
        editionDate,
        cutoffAt,
        timezone,
        outputLanguage,
        focusTopicIds,
        focusOnly: focusTopicIds.length > 0,
        focusTopics: focusTopicIds.map((id) => ({
          id,
          label: (input.topics?.find((topic) => topic.id === id)?.label ?? id).slice(0, 200),
        })),
        candidates: set.candidates,
        previousStories: [
          ...new Map(
            [...input.history]
              .filter((entry) => entry.editionDate >= localDate(cutoffAt - 7 * 86400_000, timezone))
              .map((entry) => [
                `${entry.kind ?? "news"}:${[...entry.sourceArticleIds].toSorted().join(",")}`,
                entry,
              ]),
          ).values(),
        ]
          .toSorted((a, b) => b.editionDate.localeCompare(a.editionDate))
          .slice(0, 200),
      };
      run = {
        ...run,
        prepared,
        coverageIncomplete: input.sources.some(
          (source) => Boolean(source.error) || cutoffAt - source.fetchedAt >= 30 * 60_000,
        ),
        frozenArticles: structuredClone(
          input.articles.filter((a) => set.candidates.some((c) => c.articleId === a.id)),
        ),
        frozenSources: structuredClone([...input.sources]),
        sourceSnapshots: set.candidates.map((candidate) => ({
          articleId: candidate.articleId,
          sourceId: candidate.sourceId,
          sourceName: candidate.sourceName,
          title: candidate.title,
          url: canonicalUrl(input.articles.find((a) => a.id === candidate.articleId)?.link ?? ""),
          publishedAt: candidate.publishedAt,
        })),
        // A consistency tag over the frozen inputs, not a security hash.
        snapshotHash: hashString(
          JSON.stringify([
            set.candidates,
            input.articles
              .filter((a) => set.candidates.some((c) => c.articleId === a.id))
              .map((a) => [a.id, a.body, a.summary]),
            prepared.focusTopicIds,
            prepared.focusTopics,
            prepared.focusOnly,
            promptVersion,
          ]),
        ).toString(36),
      };
      await checkpoint();
    }
    const frozenById = new Map(prepared.candidates.map((c) => [c.articleId, c]));
    const articleById = new Map((run.frozenArticles ?? input.articles).map((a) => [a.id, a]));
    const sourceById = new Map((run.frozenSources ?? input.sources).map((s) => [s.id, s]));

    /* --------------------------------------------------------- shortlist */
    let shortlist: ShortlistOutput | undefined = run.shortlist;
    if (!shortlist) {
      emit("shortlisting");
      const answer = await callPhase(run, input, "shortlist", prepared, repairUsed);
      run = answer.run;
      check();
      repairUsed = answer.repairUsed;
      if (!answer.result) {
        return await fail(
          answer.error?.code ?? "INVALID_OUTPUT",
          `Selecting: ${answer.error?.message ?? "The model's answer could not be used."}${answer.error?.errors?.length ? " " + answer.error.errors.slice(0, 3).join("; ") : ""}`,
          answer.error?.retryable ?? true,
        );
      }
      shortlist = answer.result as ShortlistOutput;
      modelRef = { provider: answer.provider, model: answer.model };
      run = { ...run, shortlist, updatedAt: Date.now() };
      await checkpoint();
    }

    /* ----------------------------------------------------------- enrich */
    const fetchContent = input.fetchContent ?? ensureArticleContent;
    let materials = [...(run.materials ?? [])];
    if (!run.enrichmentComplete) {
      const wanted = [...new Set(shortlist.groups.flatMap((group) => group.articleIds))];
      const mayFetch = new Set(
        shortlist.extractArticleIds.slice(0, BRIEFING_LIMITS.maxNewExtracts),
      );
      const completed = new Set(materials.map((m) => m.articleId));
      const pending = wanted.filter((id) => !completed.has(id));
      emit("enriching", `${completed.size} of ${wanted.length} articles checked`);
      /* oxlint-disable no-await-in-loop */
      for (let i = 0; i < pending.length; i += BRIEFING_LIMITS.extractConcurrency) {
        check();
        const done = await Promise.allSettled(
          pending.slice(i, i + BRIEFING_LIMITS.extractConcurrency).map(async (articleId) => {
            const article = articleById.get(articleId);
            const source = article ? sourceById.get(article.sourceId) : undefined;
            if (!article || !source) return;
            let material = createArticleMaterial({ article, sourceName: source.title });
            const attempts = run.extractAttempts ?? [];
            if (
              mayFetch.has(articleId) &&
              (!attempts.includes(articleId) || run.cancelledExtracts?.includes(articleId)) &&
              attempts.length < BRIEFING_LIMITS.maxNewExtracts
            ) {
              // Reserve before sending, so a closed tab cannot spend this slot twice.
              run = {
                ...run,
                extractAttempts: [...attempts, articleId],
                cancelledExtracts: run.cancelledExtracts?.filter((id) => id !== articleId),
              };
              await checkpoint();
              const result = await fetchContent({
                article,
                source,
                purpose: "briefing",
                signal: input.signal,
              });
              if (result.error === "cancelled") {
                run = {
                  ...run,
                  cancelledExtracts: [...(run.cancelledExtracts ?? []), articleId],
                };
                throw new Error("cancelled");
              }
              const stats = run.stats ?? {};
              run = {
                ...run,
                stats: {
                  ...stats,
                  fullTextsFetched:
                    (stats.fullTextsFetched ?? 0) +
                    (result.fetched && result.availability !== "summary" ? 1 : 0),
                  fullTextsFailed:
                    (stats.fullTextsFailed ?? 0) +
                    (result.error || (result.fetched && result.availability === "summary") ? 1 : 0),
                },
              };
              material = createArticleMaterial({
                article: result.article,
                sourceName: source.title,
              });
            }
            materials.push(material);
            run = { ...run, materials: [...materials], updatedAt: Date.now() };
            // Preserve a sibling's completed work even if cancellation just arrived.
            await repo.putBriefingRun(run);
            emit("enriching", `${materials.length} of ${wanted.length} articles checked`);
          }),
        );
        const rejected = done.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      }
      /* oxlint-enable no-await-in-loop */
      check();
      materials = materials.filter((m) => m.text.trim().length > 0);
      const kept = new Set(materials.map((m) => m.articleId));
      shortlist = {
        ...shortlist,
        groups: shortlist.groups
          .map((group) => ({ ...group, articleIds: group.articleIds.filter((id) => kept.has(id)) }))
          .filter((group) => group.articleIds.length > 0),
        extractArticleIds: shortlist.extractArticleIds.filter((id) => kept.has(id)),
      };
      run = { ...run, materials, shortlist, enrichmentComplete: true, updatedAt: Date.now() };
      await checkpoint();
    }

    const topicsByGroup = new Map(
      shortlist.groups.map((g) => [
        g.groupId,
        g.articleIds.flatMap((id) => frozenById.get(id)?.topicIds ?? []),
      ]),
    );
    shortlist = {
      ...shortlist,
      groups: rankGroups(shortlist.groups, prepared.focusTopicIds, topicsByGroup).map(
        (entry) => entry.group,
      ),
    };

    const previouslyRecommendedArticleIds = [
      ...new Set(
        prepared.previousStories
          .filter((entry) => entry.kind !== "news")
          .flatMap((entry) => entry.sourceArticleIds),
      ),
    ].filter((id) => materials.some((material) => material.articleId === id));

    /* ---------------------------------------------------------- compose */
    let composed = run.composed;
    if (composed) {
      const trimmed = pruneWeakComposition(composed, {
        schemaVersion: 1,
        editionDate,
        timezone,
        cutoffAt,
        outputLanguage,
        previouslyRecommendedArticleIds,
        shortlist,
        materials,
        limits: {
          maxStories: BRIEFING_LIMITS.maxStories,
          maxDeepReads: BRIEFING_LIMITS.maxDeepReads,
          targetReadingMinutes: 4,
        },
      });
      composed = trimmed.output as ComposeOutput;
      if (trimmed.omitted)
        run = {
          ...run,
          composed,
          stats: {
            ...run.stats,
            omittedWeakItems: (run.stats?.omittedWeakItems ?? 0) + trimmed.omitted,
          },
        };
    }
    if (!composed) {
      emit("composing");
      const payload: ComposeInput = fitComposeInput({
        schemaVersion: 1,
        editionDate,
        timezone,
        cutoffAt,
        outputLanguage,
        previouslyRecommendedArticleIds,
        ...(prepared.focusTopics ? { focusTopics: prepared.focusTopics } : {}),
        ...(prepared.focusOnly !== undefined ? { focusOnly: prepared.focusOnly } : {}),
        shortlist,
        materials,
        limits: {
          maxStories: BRIEFING_LIMITS.maxStories,
          maxDeepReads: BRIEFING_LIMITS.maxDeepReads,
          targetReadingMinutes: 4,
        },
      });
      materials = payload.materials;
      run = { ...run, materials };
      await checkpoint();
      const answer = await callPhase(run, input, "compose", payload, repairUsed);
      run = answer.run;
      check();
      repairUsed = answer.repairUsed;
      if (!answer.result) {
        return await fail(
          answer.error?.code ?? "INVALID_OUTPUT",
          `Writing: ${answer.error?.message ?? "The model's answer could not be used."}${answer.error?.errors?.length ? " " + answer.error.errors.slice(0, 3).join("; ") : ""}`,
          answer.error?.retryable ?? true,
        );
      }
      composed = answer.result as ComposeOutput;
      modelRef = { provider: answer.provider, model: answer.model };

      // The no-repeat rule needs the history the model was not given: a deep
      // read already recommended is refused here, deterministically.
      const alreadyDeepRead = prepared.previousStories
        .filter((entry) => entry.kind !== "news")
        .flatMap((entry) => entry.sourceArticleIds);
      const recheck = validateComposition(composed, payload, alreadyDeepRead);
      if (!recheck.ok) {
        return await fail("INVALID_OUTPUT", recheck.errors[0] ?? "Not publishable.", true);
      }
      run = { ...run, composed, updatedAt: Date.now() };
      await checkpoint();
    }

    /* ---------------------------------------------------------- publish */
    check();
    emit("validating");
    const verified = validateComposition(
      composed,
      {
        schemaVersion: 1,
        editionDate,
        timezone,
        cutoffAt,
        outputLanguage,
        previouslyRecommendedArticleIds,
        ...(prepared.focusTopics ? { focusTopics: prepared.focusTopics } : {}),
        ...(prepared.focusOnly !== undefined ? { focusOnly: prepared.focusOnly } : {}),
        shortlist,
        materials,
        limits: {
          maxStories: BRIEFING_LIMITS.maxStories,
          maxDeepReads: BRIEFING_LIMITS.maxDeepReads,
          targetReadingMinutes: 4,
        },
      },
      prepared.previousStories
        .filter((entry) => entry.kind !== "news")
        .flatMap((entry) => entry.sourceArticleIds),
    );
    if (!verified.ok) {
      if (verified.errors.every((error) => error.startsWith("INSUFFICIENT_CONTENT")))
        return await fail(
          "INSUFFICIENT_CONTENT",
          "No new evidenced content remains to publish. Try generating a new edition when more articles arrive.",
          false,
        );
      return await fail("INVALID_OUTPUT", verified.errors[0], true);
    }
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
        url: canonicalUrl(
          run.sourceSnapshots.find((snapshot) => snapshot.articleId === articleId)?.url ??
            article?.link ??
            "",
        ),
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
      outputLanguage,
      schemaVersion: 1,
      promptVersion,
      model: modelRef,
      coverageIncomplete:
        run.coverageIncomplete ?? input.sources.some((source) => Boolean(source.error)),
      sourceSnapshots: cited
        .map(snapshotFor)
        .filter((s): s is BriefingSourceSnapshot => s !== null),
      bigPicture: composed.bigPicture,
      topStories: composed.topStories.map((story, index) => ({
        ...story,
        id: `s${index + 1}`,
        sourceArticleIds: storyCited([
          story.whatHappened,
          story.context,
          story.whyItMatters,
          ...story.perspectives,
        ]),
      })),
      worthReading: composed.worthReading,
      stats: {
        candidates: prepared.candidates.length,
        sourcesConsidered: new Set(prepared.candidates.map((c) => c.sourceId)).size,
        fullTextsFetched: run.stats?.fullTextsFetched ?? 0,
        fullTextsFailed: run.stats?.fullTextsFailed ?? 0,
        ...(run.stats?.inputTokens !== undefined ? { inputTokens: run.stats.inputTokens } : {}),
        ...(run.stats?.outputTokens !== undefined ? { outputTokens: run.stats.outputTokens } : {}),
        llmRequests: run.callsUsed,
        ...(run.stats?.omittedWeakItems ? { omittedWeakItems: run.stats.omittedWeakItems } : {}),
        durationMs: (run.stats?.durationMs ?? 0) + now - started,
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
    const latest = await repo.getBriefingRun(run.runId);
    run = {
      ...run,
      callsUsed: latest?.callsUsed ?? run.callsUsed,
      repairUsed: latest?.repairUsed ?? run.repairUsed,
      truncatedPhases: latest?.truncatedPhases ?? run.truncatedPhases,
    };
    if (input.signal?.aborted || (error instanceof Error && error.message === "cancelled")) {
      run = {
        ...run,
        stats: { ...run.stats, durationMs: (run.stats?.durationMs ?? 0) + Date.now() - started },
        status: "cancelled",
        updatedAt: Date.now(),
      };
      await repo.putBriefingRun(run);
      return {
        run,
        error: { code: "CANCELLED", message: "The run was cancelled.", retryable: true },
      };
    }
    return await fail("PROVIDER_ERROR", error instanceof Error ? error.message : "failed", true);
  } finally {
    clearInterval(heartbeat);
    await repo.releaseBriefingLease(run.runId, owner);
    delete run.lease;
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
  error?: { code: string; message: string; retryable: boolean; errors?: string[] };
}> {
  let nextRun = run;
  const previouslyTruncated =
    run.truncatedPhases?.includes(phase) ||
    (run.error?.code === "OUTPUT_TRUNCATED" && phase === (run.shortlist ? "compose" : "shortlist"));
  let feedback: string[] | undefined = previouslyTruncated
    ? ["OUTPUT_TRUNCATED"]
    : phase === "compose" && (repairUsed || run.callsUsed >= 2)
      ? ["COMPACT_OUTPUT"]
      : undefined;
  /* oxlint-disable no-await-in-loop */
  while (nextRun.callsUsed < (phase === "shortlist" ? 2 : 3)) {
    if (phase === "compose" && nextRun.callsUsed >= 2 && !isCompactReply(feedback ?? []))
      feedback = [...(feedback ?? []), "COMPACT_OUTPUT"];
    if (input.signal?.aborted) throw new Error("cancelled");
    nextRun = Object.assign({}, nextRun, {
      callsUsed: nextRun.callsUsed + 1,
      repairUsed,
      updatedAt: Date.now(),
    });
    // Count before dispatch: even a lost reply may have been billed.
    await repo.putBriefingRun(nextRun);
    let answer = await input.generate({
      phase,
      payload,
      retryFeedback: feedback,
      signal: input.signal,
    });
    if (answer.ok) {
      const trimmed =
        phase === "compose"
          ? pruneWeakComposition(answer.result, payload as ComposeInput)
          : { output: answer.result, omitted: 0 };
      const checked =
        phase === "shortlist"
          ? validateShortlist(trimmed.output, payload as ShortlistInput)
          : validateComposition(
              trimmed.output,
              payload as ComposeInput,
              (run.prepared?.previousStories ?? [])
                .filter((entry) => entry.kind !== "news")
                .flatMap((entry) => entry.sourceArticleIds),
            );
      if (answer.phase !== phase || !checked.ok)
        answer = {
          ok: false,
          code:
            !checked.ok && checked.errors.every((e) => e.startsWith("INSUFFICIENT_CONTENT"))
              ? "INSUFFICIENT_CONTENT"
              : "INVALID_OUTPUT",
          message:
            !checked.ok && checked.errors.every((e) => e.startsWith("INSUFFICIENT_CONTENT"))
              ? "No proposed topic meets the editorial and evidence requirements yet. There is no minimum article count."
              : "The model output failed publication checks.",
          retryable:
            checked.ok || !checked.errors.every((e) => e.startsWith("INSUFFICIENT_CONTENT")),
          errors: checked.ok ? ["output.phase: wrong phase"] : checked.errors,
        };
      else if (checked.ok)
        answer = {
          ...answer,
          result: checked.value,
          omittedWeakItems: (answer.omittedWeakItems ?? 0) + trimmed.omitted,
        };
    }
    if (!answer.ok && answer.code === "OUTPUT_TRUNCATED") {
      nextRun = {
        ...nextRun,
        truncatedPhases: [...new Set([...(nextRun.truncatedPhases ?? []), phase])],
      };
      await repo.putBriefingRun(nextRun);
    }
    if (input.signal?.aborted) throw new Error("cancelled");
    if (answer.ok) {
      const stats = nextRun.stats ?? {};
      /* oxlint-disable-next-line oxc/no-accumulating-spread */
      nextRun = {
        ...nextRun,
        providerId: answer.provider,
        modelId: answer.model,
        stats: {
          ...stats,
          omittedWeakItems: (stats.omittedWeakItems ?? 0) + (answer.omittedWeakItems ?? 0),
          ...(answer.usage?.inputTokens !== undefined
            ? { inputTokens: (stats.inputTokens ?? 0) + answer.usage.inputTokens }
            : {}),
          ...(answer.usage?.outputTokens !== undefined
            ? { outputTokens: (stats.outputTokens ?? 0) + answer.usage.outputTokens }
            : {}),
        },
      };
      return {
        run: nextRun,
        result: answer.result,
        repairUsed,
        provider: answer.provider,
        model: answer.model,
      };
    }
    if (
      !answer.retryable ||
      !["INVALID_OUTPUT", "OUTPUT_TRUNCATED"].includes(answer.code) ||
      repairUsed ||
      nextRun.callsUsed >= 3
    ) {
      return { run: nextRun, repairUsed, provider: "", model: "", error: answer };
    }
    repairUsed = true;
    feedback = answer.errors ?? [answer.code];
  }
  /* oxlint-enable no-await-in-loop */
  return {
    run: nextRun,
    repairUsed,
    provider: "",
    model: "",
    error: {
      code: "CALL_LIMIT",
      message: "This run has used its three model calls. Generate a new edition to try again.",
      retryable: false,
    },
  };
}

/** Everything an edition's history list needs, newest first. */
export async function loadBriefings(): Promise<BriefingEdition[]> {
  const editions = await repo.getBriefings();
  return editions.toSorted((a, b) => b.generatedAt - a.generatedAt);
}

/** Only the newest attempt for an issue can be resumed; saved editions supersede older work. */
export async function loadResumableRun(editionKey?: string): Promise<BriefingRun | undefined> {
  const [runs, editions] = await Promise.all([repo.listBriefingRuns(), repo.getBriefings()]);
  const published = new Map<string, number>();
  for (const edition of editions)
    published.set(
      edition.editionKey,
      Math.max(published.get(edition.editionKey) ?? 0, edition.revision),
    );
  const latest = new Map<string, BriefingRun>();
  for (const run of runs) {
    if (editionKey && run.editionKey !== editionKey) continue;
    const previous = latest.get(run.editionKey);
    if (
      !previous ||
      run.revision > previous.revision ||
      (run.revision === previous.revision && run.updatedAt > previous.updatedAt)
    )
      latest.set(run.editionKey, run);
  }
  return [...latest.values()]
    .filter(
      (run) =>
        run.status !== "ready" &&
        run.error?.code !== "INSUFFICIENT_CONTENT" &&
        run.revision > (published.get(run.editionKey) ?? 0) &&
        Boolean(run.prepared) &&
        (Boolean(run.composed) || run.callsUsed + (run.shortlist ? 1 : 2) <= 3),
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision)[0];
}
