"use client";

import type { RunStatus } from "@/lib/briefing/types";
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
      data-t="briefing-progress"
      className="mono mt-3 text-[9.5px] tracking-[0.12em] text-ink4 uppercase"
    >
      {STAGE_LABELS[progress.status]}
      {progress.detail ? ` · ${progress.detail}` : ""}
    </p>
  );
}
