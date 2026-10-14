"use client";

import type { BriefingRun, RunStatus } from "@/lib/briefing/types";
import type { useBriefing } from "@/lib/briefing/useBriefing";

/**
 * The run's status, in real counts. A briefing takes a while and spends the
 * reader's money doing it — the least it can do is say where it is.
 */

const STAGE_LABELS: Record<RunStatus, string> = {
  preparing: "Preparing",
  shortlisting: "Selecting",
  enriching: "Reading sources",
  composing: "Writing",
  validating: "Validating",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
  ready: "Ready",
};

type Briefing = ReturnType<typeof useBriefing>;

export function BriefingProgressLine({ briefing }: { briefing: Briefing }) {
  const { progress, error } = briefing;
  if (error) {
    return (
      <p
        role="alert"
        data-t="briefing-error"
        className="mono mt-3 max-w-[46ch] text-[9.5px] leading-[1.7] tracking-[0.12em] text-spark uppercase"
      >
        {error.message}
      </p>
    );
  }
  if (!progress) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      data-t="briefing-progress"
      className="mono mt-3 text-[9.5px] tracking-[0.12em] text-ink4 uppercase"
    >
      {STAGE_LABELS[progress.status]}
      {progress.detail ? ` · ${progress.detail}` : ""}
    </p>
  );
}

function pendingStage(run: BriefingRun): string {
  if (run.composed) return "Publishing";
  if (run.enrichmentComplete) return "Writing";
  if (run.shortlist) return "Reading sources";
  return "Selecting";
}

export function BriefingResumeNotice({ briefing }: { briefing: Briefing }) {
  if (briefing.running) return null;
  const { current, resumable } = briefing;
  if (!resumable)
    return current ? (
      <p role="status" className="mono mb-3 text-[9.5px] tracking-[0.12em] text-ink4 uppercase">
        r{current.revision} · Saved
      </p>
    ) : null;
  const status =
    resumable.status === "failed"
      ? "interrupted"
      : resumable.status === "cancelled"
        ? "cancelled"
        : resumable.status === "paused"
          ? "paused"
          : "unfinished";
  const saved = current
    ? `${current.editionKey === resumable.editionKey ? "" : `${current.editionDate} · ${current.timezone} · `}r${current.revision}`
    : null;
  const taskIssue =
    current && current.editionKey !== resumable.editionKey
      ? `${resumable.editionKey.replace("@", " · ")} · `
      : "";
  return (
    <div
      role="status"
      data-t="briefing-resume-notice"
      className="mb-3 text-[13px] leading-relaxed text-ink3"
    >
      <p>{saved ? `Showing ${saved} (saved).` : "No completed edition yet."}</p>
      <p className="text-ink2">
        {taskIssue}r{resumable.revision} {status} · {pendingStage(resumable)}.
      </p>
      {resumable.status === "cancelled" && (
        <p className="mt-1 text-ink4">
          Completed work is saved; a model request already sent may still be billed.
        </p>
      )}
    </div>
  );
}
