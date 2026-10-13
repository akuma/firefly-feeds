"use client";

import { FileText, Plus, RotateCcw, Settings as SettingsIcon, X } from "lucide-react";
import { clsx } from "../clsx";
import { useReader } from "@/lib/store";
import { findService, serviceReady } from "@/lib/llm";
import type { useBriefing } from "@/lib/briefing/useBriefing";
import { BriefingProgressLine } from "./briefing-progress";

/**
 * The briefing's middle column: what this edition is made of, and what the
 * run is doing about it. The reading pane beside it is the writing; this is
 * the table of contents and the press room.
 */

type Briefing = ReturnType<typeof useBriefing>;

function gotoSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function BriefingColumn({ briefing }: { briefing: Briefing }) {
  const r = useReader();
  const edition = briefing.current;
  const configured = (() => {
    const service = findService(r.llmConfig.service);
    return service ? serviceReady(service, r.llmConfig) : false;
  })();
  const subscribed = r.sources.filter((source) => !source.deletedAt).length;

  return (
    <div data-t="briefing-column" className="flex h-full min-h-0 flex-col bg-stream">
      <header className="shrink-0 px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label text-spark">Briefing</span>
          <span className="mono tnum text-[10px] tracking-[0.12em] text-ink4 uppercase">
            {edition ? edition.editionDate : "—"}
          </span>
        </div>
        <h1 className="display mt-2 text-[25px] leading-[1.1] font-medium tracking-[-0.016em] text-ink">
          {edition ? "Today's Briefing" : "A daily edition of your own reading"}
        </h1>

        {/* ------------------------------------------------------- controls */}
        <div className="mt-4">
          {subscribed === 0 ? (
            <div className="border-t border-rule pt-4">
              <p className="text-[13.5px] leading-[1.5] text-ink3">
                Add a source to create your briefing.
              </p>
              <button
                type="button"
                onClick={() => r.setAddOpen(true)}
                className="mono mt-2.5 flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
              >
                <Plus size={11} strokeWidth={1.8} />
                Add a source
              </button>
            </div>
          ) : !configured ? (
            <div className="border-t border-rule pt-4">
              <p className="max-w-[42ch] text-[13.5px] leading-[1.5] text-ink3">
                A briefing is written by a model of your own choosing. The stories you select —
                titles, summaries and limited text — are sent to that provider; your key stays in
                this browser.
              </p>
              <button
                type="button"
                onClick={() => r.setSettingsOpen(true)}
                className="mono mt-2.5 flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
              >
                <SettingsIcon size={11} strokeWidth={1.8} />
                Set up a model
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-4">
              {!briefing.running && (
                <button
                  type="button"
                  data-t="briefing-generate"
                  onClick={briefing.generate}
                  className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
                >
                  <FileText size={11} strokeWidth={1.8} />
                  {edition ? "Regenerate" : "Generate today's briefing"}
                </button>
              )}
              {briefing.resumable && !briefing.running && (
                <button
                  type="button"
                  data-t="briefing-resume"
                  onClick={briefing.resume}
                  className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
                >
                  <RotateCcw size={11} strokeWidth={1.8} />
                  Resume briefing
                </button>
              )}
              {briefing.running && (
                <button
                  type="button"
                  data-t="briefing-cancel"
                  onClick={briefing.cancel}
                  className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink"
                >
                  <X size={11} strokeWidth={1.8} />
                  Cancel
                </button>
              )}
              {!edition && !briefing.running && (
                <span className="mono text-[9.5px] tracking-[0.12em] text-ink4 uppercase">
                  From {subscribed} subscribed source{subscribed === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}

          <BriefingProgressLine briefing={briefing} />
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* ------------------------------------------------------- contents */}
        {edition && (
          <nav className="border-t border-rule px-5 py-4">
            <div className="label text-ink4">In this edition</div>
            <ul className="mt-2.5 flex flex-col gap-1">
              {edition.bigPicture && (
                <li>
                  <button
                    type="button"
                    onClick={() => gotoSection("briefing-big-picture")}
                    className="mono w-full truncate py-1 text-left text-[10px] tracking-[0.12em] text-ink3 uppercase transition-colors hover:text-spark"
                  >
                    The Big Picture
                  </button>
                </li>
              )}
              {edition.topStories.map((story) => (
                <li key={story.id}>
                  <button
                    type="button"
                    onClick={() => gotoSection(`briefing-${story.id}`)}
                    className="w-full truncate py-1 text-left text-[14px] leading-[1.35] text-ink2 transition-colors hover:text-spark"
                  >
                    {story.headline}
                  </button>
                </li>
              ))}
              {edition.worthReading.map((deep) => {
                const snapshot = edition.sourceSnapshots.find(
                  (s) => s.articleId === deep.articleId,
                );
                return (
                  <li key={deep.articleId}>
                    <button
                      type="button"
                      onClick={() => gotoSection(`briefing-deep-${deep.articleId}`)}
                      className="w-full truncate py-1 text-left text-[14px] leading-[1.35] text-ink2 transition-colors hover:text-spark"
                    >
                      {snapshot?.title ?? deep.articleId}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mono mt-3 text-[9.5px] tracking-[0.12em] text-ink4 uppercase">
              {edition.stats.candidates} stories considered · {edition.stats.fullTextsFetched}{" "}
              fetched · {edition.stats.llmRequests} model calls
            </div>
          </nav>
        )}

        {/* --------------------------------------------------------- history */}
        {briefing.editions.length > 1 && (
          <div className="border-t border-rule px-5 py-4">
            <div className="label text-ink4">Earlier editions</div>
            <ul className="mt-2">
              {briefing.editions.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => briefing.open(item.id)}
                    className={clsx(
                      "flex h-[30px] w-full items-center gap-3 pr-2 text-left transition-colors hover:bg-hoverc",
                      item.id === edition?.id && "text-spark",
                    )}
                  >
                    <span className="mono tnum min-w-0 flex-1 truncate text-[11.5px] leading-none text-ink2">
                      {item.editionDate} · r{item.revision}
                    </span>
                    <span className="mono tnum shrink-0 text-[10px] leading-none text-ink4">
                      {item.topStories.length + item.worthReading.length} items
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
