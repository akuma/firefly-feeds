import { useCallback, useEffect, useRef, useState } from "react";
import type { LlmConfig } from "../llm";
import * as repo from "../storage/repository";
import { generatePhase } from "./generate";
import { loadBriefings, loadResumableRun, runBriefing, type BriefingProgress } from "./pipeline";
import type { BriefingEdition, BriefingHistoryDigest, BriefingRun } from "./types";

/**
 * The briefing's React surface — deliberately not part of the reading store.
 * The pipeline is a sequence of expensive, cancellable steps; the reading
 * state is a synchronous picture of what is on screen. Mixing them produced
 * the giant store this module refuses to grow into.
 */

export type BriefingError = { code: string; message: string; retryable: boolean };

export function useBriefing(llm: LlmConfig, focusTopicIds: readonly string[]) {
  const [editions, setEditions] = useState<BriefingEdition[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BriefingProgress | null>(null);
  const [error, setError] = useState<BriefingError | null>(null);
  const [resumable, setResumable] = useState<BriefingRun | undefined>(undefined);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const [list, resume] = await Promise.all([loadBriefings(), loadResumableRun()]);
    setEditions(list);
    setResumable(resume);
    setCurrentId((id) => (id && list.some((e) => e.id === id) ? id : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    // Synchronizing with an external system (the database) is what effects are
    // for; the state lands when the read does.
    /* oxlint-disable-next-line react/set-state-in-effect */
    void reload();
  }, [reload]);

  /** Every earlier edition's coverage, so a story is not recommended twice. */
  const historyOf = useCallback(
    (list: readonly BriefingEdition[]): BriefingHistoryDigest[] =>
      list.map((edition) => ({
        editionDate: edition.editionDate,
        headline: edition.topStories[0]?.headline ?? edition.bigPicture?.text.slice(0, 120) ?? "",
        sourceArticleIds: [
          ...new Set([
            ...edition.topStories.flatMap((story) => story.sourceArticleIds),
            ...edition.worthReading.map((deep) => deep.articleId),
          ]),
        ],
      })),
    [],
  );

  const start = useCallback(
    async (resume?: BriefingRun) => {
      if (running.current) return;
      running.current = true;
      setError(null);
      setProgress({ runId: resume?.runId ?? "", status: "preparing" });
      const controllerNow = new AbortController();
      controller.current = controllerNow;
      try {
        // The frozen snapshot is read at the press, not before: what the
        // edition is written from is exactly what the library held then.
        const snapshot = await repo.loadAll();
        const outcome = await runBriefing({
          articles: snapshot.articles,
          sources: snapshot.sources.filter((source) => !source.deletedAt),
          classifications: snapshot.classifications.filter((c) => !c.deletedAt),
          history: historyOf(editions),
          focusTopicIds: [...focusTopicIds],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          llm,
          generate: (call) =>
            generatePhase({
              phase: call.phase,
              payload: call.payload,
              llm,
              retryFeedback: call.retryFeedback,
              signal: controllerNow.signal,
            }),
          signal: controllerNow.signal,
          onProgress: setProgress,
          resume,
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
    [editions, focusTopicIds, historyOf, llm, reload],
  );

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
    generate: () => start(),
    resume: () => (resumable ? start(resumable) : start()),
    cancel,
    open: (id: string) => setCurrentId(id),
    reload,
  };
}
