"use client";

import { clsx } from "./clsx";
import { useReader } from "@/lib/store";
import { DIGEST_MIN_CANDIDATES, staleCount } from "@/lib/digest";
import { findService, serviceReady } from "@/lib/llm";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Today's briefing, at the head of the Today column.
 *
 * The block is the whole feature's restraint in one place: it is dated, so it
 * stays put while the reader works through it; every line is a link back to a
 * real story; and the last line says where the words came from. The one thing
 * it must never do is stand in for the story itself, so the gist is a sentence
 * and the reason is a sentence — enough to decide, not enough to skip.
 */
export function Briefing() {
  const r = useReader();

  // Only Today has a "today", and the other views are not decorated with one.
  if (r.view !== "today") return null;
  if (!r.digestEnabled) return null;

  const record = r.digest;
  const candidates = r.digestCandidates;
  const configured = (() => {
    const service = findService(r.llmConfig.service);
    return service ? serviceReady(service, r.llmConfig) : false;
  })();

  // A quiet day needs no edition, and one written anyway would be a ranking of
  // three stories pretending to be a choice.
  if (!record && candidates.length < DIGEST_MIN_CANDIDATES) return null;

  const picks = record ? record.picks : [];
  const newSince = staleCount(record ?? undefined, candidates);

  return (
    <section data-t="briefing" className="border-b border-rule px-5 pt-5 pb-6 lg:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label text-spark">Today&apos;s briefing</h2>
        {record && (
          <button
            type="button"
            onClick={r.regenerateDigest}
            disabled={r.digestWorking || r.digestRunsLeft <= 0}
            title={
              r.digestRunsLeft <= 0
                ? "No rewrites left today"
                : "Write today's edition again from the current stories"
            }
            className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink disabled:opacity-40"
          >
            {r.digestWorking ? "Writing…" : "Regenerate"}
          </button>
        )}
      </div>

      {record && (
        <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.5] text-ink4">
          {plural(picks.length, "story", "stories")} of today&apos;s{" "}
          {plural(record.candidates.length, "story", "stories")}, chosen and summarised from your
          own feeds.
        </p>
      )}

      {/* ------------------------------------------------------- states */}
      {!record && (r.digestWorking || (configured && !r.digestError)) && (
        <p className="mono mt-3 text-[10px] tracking-[0.12em] text-ink4 uppercase">
          Writing today&apos;s edition…
        </p>
      )}

      {!record && !configured && (
        <div className="mt-3">
          <p className="max-w-[52ch] text-[13.5px] leading-[1.5] text-ink3">
            No model is set up yet, so no briefing can be written.
          </p>
          <button
            type="button"
            onClick={() => r.setSettingsOpen(true)}
            className="mono mt-2 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            Open settings
          </button>
        </div>
      )}

      {r.digestError && (
        <div className="mt-4 flex items-start justify-between gap-4 border-l-2 border-spark py-1 pl-4">
          <p className="text-[13.5px] leading-[1.5] text-ink2">{r.digestError}</p>
          <button
            type="button"
            onClick={r.retryDigest}
            className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            Retry
          </button>
        </div>
      )}

      {/* ------------------------------------------------------- the edition */}
      {record && (
        <ol className="mt-5 border-t border-rulesoft">
          {picks.map((id, index) => {
            const story = r.story(id);
            // A story the cache has dropped cannot be summarised any more, so
            // the line goes rather than pointing at something that is not there.
            if (!story) return null;
            return (
              <li key={id} className="border-b border-rulesoft py-3.5 last:border-b-0">
                <button
                  type="button"
                  onClick={() => r.select(id)}
                  className="group block w-full text-left"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="mono shrink-0 text-[10px] tracking-[0.14em] text-ink4">
                      {index + 1}
                    </span>
                    <h3
                      className={clsx(
                        "display min-w-0 flex-1 text-[16.5px] leading-[1.28] tracking-[-0.012em] transition-colors",
                        "group-hover:text-spark",
                        r.state.read[id] ? "text-ink3" : "text-ink",
                      )}
                    >
                      {story.title}
                    </h3>
                  </div>
                  <p className="mt-1.5 pl-7 text-[14px] leading-[1.45] text-ink2">
                    {record.gists[id]}
                  </p>
                  <p className="mt-1 pl-7 text-[12.5px] leading-[1.45] text-ink4">
                    {record.reasons[id]}
                  </p>
                  <div className="mono mt-2 flex min-w-0 items-center gap-2 pl-7 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                    <span>{plural(story.minutes, "min", "mins")} read</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{r.feedById(story.feedId)?.name ?? ""}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {/* ------------------------------------- provenance, and what is new */}
      {record && (
        <p className="mono mt-5 max-w-[58ch] text-[9.5px] leading-[1.8] tracking-[0.08em] text-ink4 uppercase">
          Written from each story&apos;s title and summary. Nothing fetched, nothing invented.
        </p>
      )}

      {record && newSince > 0 && (
        <p className="mono mt-2.5 text-[9.5px] tracking-[0.14em] text-spark uppercase">
          {plural(newSince, "new story", "new stories")} since this edition was written
        </p>
      )}
    </section>
  );
}
