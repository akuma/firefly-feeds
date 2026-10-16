import { staleSourceIds } from "../refreshing";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { DigestLanguageId } from "../languages";
import type { LlmConfig } from "../llm";
import * as repo from "../storage/repository";
import { generatePhase } from "./generate";
import {
  loadBriefings,
  loadResumableRun,
  localDate,
  runBriefing,
  type BriefingProgress,
} from "./pipeline";
import type { BriefingEdition, BriefingHistoryDigest, BriefingRun } from "./types";

/**
 * The briefing's React surface — deliberately not part of the reading store.
 * The pipeline is a sequence of expensive, cancellable steps; the reading
 * state is a synchronous picture of what is on screen. Mixing them produced
 * the giant store this module refuses to grow into.
 */

export type BriefingError = { code: string; message: string; retryable: boolean };

function todayEditionKey(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${localDate(Date.now(), timezone)}@${timezone}`;
}

function isGenerationClick(event: MouseEvent<HTMLButtonElement> | undefined, button: string) {
  // Effects and timers must not be able to invoke these handlers without a button event.
  return (
    event?.type === "click" &&
    event.currentTarget.tagName === "BUTTON" &&
    event.currentTarget.dataset.t === button
  );
}

export function useBriefing(
  llm: LlmConfig,
  focusTopicIds: readonly string[],
  refresh?: (id: string, signal?: AbortSignal) => Promise<void>,
  enabled = true,
  outputLanguage: DigestLanguageId = "en",
) {
  const [editions, setEditions] = useState<BriefingEdition[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BriefingProgress | null>(null);
  const [error, setError] = useState<BriefingError | null>(null);
  const [resumable, setResumable] = useState<BriefingRun | undefined>(undefined);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const [list, resume] = await Promise.all([
      loadBriefings(),
      loadResumableRun(todayEditionKey()),
    ]);
    setEditions(list);
    setResumable(resume);
    setCurrentId((id) => (id && list.some((e) => e.id === id) ? id : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      return;
    }
    // Synchronizing with an external system (the database) is what effects are
    // for; the state lands when the read does.
    /* oxlint-disable-next-line react/set-state-in-effect */
    void reload().catch(() =>
      setError({
        code: "STORAGE_UNAVAILABLE",
        message: "Browser storage is unavailable. Enable local storage to save a briefing.",
        retryable: false,
      }),
    );
  }, [reload, enabled]);

  /** Every earlier edition's coverage, so a story is not recommended twice. */
  const historyOf = useCallback(
    (list: readonly BriefingEdition[]): BriefingHistoryDigest[] =>
      list.flatMap((edition) => [
        ...edition.topStories.map((story) => ({
          editionDate: edition.editionDate,
          headline: story.headline,
          sourceArticleIds: story.sourceArticleIds,
          kind: "news" as const,
        })),
        ...edition.worthReading.map((deep) => ({
          editionDate: edition.editionDate,
          headline:
            edition.sourceSnapshots.find((s) => s.articleId === deep.articleId)?.title ?? "",
          sourceArticleIds: [deep.articleId],
          kind: "insight" as const,
        })),
      ]),
    [],
  );

  const start = useCallback(
    async (trigger: NonNullable<BriefingRun["trigger"]>, resume?: BriefingRun) => {
      if (!enabled || running.current) return;
      running.current = true;
      setError(null);
      setProgress({ runId: resume?.runId ?? "", status: "preparing" });
      const controllerNow = new AbortController();
      controller.current = controllerNow;
      try {
        // Another tab may have completed a newer edition since this button rendered.
        const target = resume ? await loadResumableRun(todayEditionKey()) : undefined;
        if (resume && target?.runId !== resume.runId) {
          await reload();
          return;
        }
        // The frozen snapshot is read at the press, not before: what the
        // edition is written from is exactly what the library held then.
        let snapshot = await repo.loadAll();
        if (!resume && refresh) {
          const stale = staleSourceIds(snapshot.sources, Date.now());
          const signal = AbortSignal.any([controllerNow.signal, AbortSignal.timeout(10_000)]);
          // At most five stale feeds and ten seconds; use the reader's refresh path.
          for (const id of stale.slice(0, 5)) {
            if (signal.aborted) break;
            /* oxlint-disable-next-line no-await-in-loop */
            await refresh(id, signal);
          }
          snapshot = await repo.loadAll();
        }
        if (controllerNow.signal.aborted) return;
        const outcome = await runBriefing({
          articles: snapshot.articles,
          sources: snapshot.sources.filter((source) => !source.deletedAt),
          classifications: snapshot.classifications.filter((c) => !c.deletedAt),
          history: historyOf(await loadBriefings()),
          focusTopicIds: focusTopicIds.filter((id) =>
            snapshot.topics.some((topic) => topic.id === id),
          ),
          topics: snapshot.topics.map(({ id, label }) => ({ id, label })),
          outputLanguage,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          llm,
          generate: (call) =>
            generatePhase({
              phase: call.phase,
              payload: call.payload,
              llm,
              retryFeedback: call.retryFeedback,
              repairOutput: call.repairOutput,
              runId: call.runId,
              attempt: call.attempt,
              signal: controllerNow.signal,
            }),
          signal: controllerNow.signal,
          onProgress: setProgress,
          resume: target,
          trigger,
        });
        if (outcome.error && outcome.error.code !== "CANCELLED") setError(outcome.error);
        if (outcome.edition) setCurrentId(outcome.edition.id);
        await reload();
      } catch (cause) {
        setError({
          code: "PIPELINE_ERROR",
          message: cause instanceof Error ? cause.message : "The briefing could not be written.",
          retryable: true,
        });
      } finally {
        running.current = false;
        controller.current = null;
        setProgress(null);
      }
    },
    [focusTopicIds, historyOf, llm, reload, refresh, enabled, outputLanguage],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  return {
    editions,
    current: editions.find((edition) => edition.id === currentId) ?? editions[0],
    progress,
    // Derived from the run state rather than a ref: render must not read refs.
    running: progress !== null,
    error,
    resumable,
    generate: (event: MouseEvent<HTMLButtonElement>) =>
      isGenerationClick(event, "briefing-generate")
        ? start({ type: "manual", action: "generate", at: Date.now() })
        : Promise.resolve(),
    resume: (event: MouseEvent<HTMLButtonElement>) =>
      resumable && isGenerationClick(event, "briefing-resume")
        ? start({ type: "manual", action: "resume", at: Date.now() }, resumable)
        : Promise.resolve(),
    cancel,
    open: (id: string) => setCurrentId(id),
    reload,
  };
}
