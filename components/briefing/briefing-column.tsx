"use client";

import { useState } from "react";
import { ChevronDown, FileText, Plus, RotateCcw, Settings as SettingsIcon, X } from "lucide-react";
import { clsx } from "../clsx";
import { useReader } from "@/lib/store";
import { findService, serviceReady } from "@/lib/llm";
import type { useBriefing } from "@/lib/briefing/useBriefing";
import { localDate } from "@/lib/briefing/pipeline";
import { formatBriefingText } from "@/lib/briefing/typography";
import { BriefingProgressLine, BriefingResumeNotice } from "./briefing-progress";

/**
 * The briefing's middle column: what this edition is made of, and what the
 * run is doing about it. The reading pane beside it is the writing; this is
 * the table of contents and the press room.
 */

type Briefing = ReturnType<typeof useBriefing>;

export function BriefingColumn({
  briefing,
  onOpenSection,
}: {
  briefing: Briefing;
  onOpenSection: (id: string) => void;
}) {
  const r = useReader();
  const [historyOpen, setHistoryOpen] = useState(false);
  const edition = briefing.current;
  const [today] = useState(() =>
    localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const isToday = edition?.editionDate === today;
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
            {edition ? edition.editionDate : (briefing.resumable?.editionKey.slice(0, 10) ?? "—")}
          </span>
        </div>
        <h1
          className={clsx(
            "mt-2 font-briefing-title text-[25px] leading-[1.1] font-normal tracking-[0.015em] text-ink",
            edition && "hidden lg:block",
          )}
        >
          {edition
            ? isToday
              ? "Today's Briefing"
              : "From the archive"
            : "A daily edition of your own reading"}
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
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-rule pt-3">
              <div className="min-w-0 flex-1 basis-32">
                <BriefingResumeNotice briefing={briefing} />
                <BriefingProgressLine briefing={briefing} />
                {!edition &&
                  !briefing.running &&
                  !briefing.resumable &&
                  !briefing.progress &&
                  !briefing.error && (
                    <span className="mono text-[9.5px] tracking-[0.12em] text-ink4 uppercase">
                      From {subscribed} subscribed source{subscribed === 1 ? "" : "s"}
                    </span>
                  )}
              </div>
              <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
                {!briefing.running && (
                  <button
                    type="button"
                    data-t="briefing-generate"
                    onClick={briefing.generate}
                    className={clsx(
                      "mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] uppercase transition-opacity hover:opacity-70",
                      briefing.resumable ? "text-ink4" : "text-spark",
                    )}
                  >
                    <FileText size={11} strokeWidth={1.8} />
                    {briefing.resumable && !edition
                      ? "Start over"
                      : isToday
                        ? "Regenerate"
                        : "Generate today's briefing"}
                  </button>
                )}
                {briefing.running && (
                  <button
                    type="button"
                    data-t="briefing-cancel"
                    onClick={briefing.cancel}
                    className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
                  >
                    <X size={11} strokeWidth={1.8} />
                    Cancel
                  </button>
                )}
                {briefing.resumable && !briefing.running && (
                  <button
                    type="button"
                    data-t="briefing-resume"
                    onClick={briefing.resume}
                    className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
                  >
                    <RotateCcw size={11} strokeWidth={1.8} />
                    Resume r{briefing.resumable.revision}
                  </button>
                )}
              </div>
            </div>
          )}

          {(subscribed === 0 || !configured) && (
            <div className="mt-3">
              <BriefingResumeNotice briefing={briefing} />
              <BriefingProgressLine briefing={briefing} />
            </div>
          )}
        </div>
      </header>

      {briefing.editions.length > 1 && (
        <label className="mono flex items-center gap-3 border-t border-rule px-5 py-3 text-[10px] text-ink4 lg:hidden">
          Editions
          <select
            aria-label="Briefing edition"
            value={edition?.id ?? ""}
            onChange={(e) => briefing.open(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-ink2"
          >
            {briefing.editions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.editionDate} · r{item.revision} · {item.timezone}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        {/* ------------------------------------------------------- contents */}
        {edition && (
          <nav
            aria-label="Briefing contents"
            className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-rule px-5 py-4"
          >
            {edition.bigPicture && (
              <button
                type="button"
                onClick={() => onOpenSection("briefing-big-picture")}
                className="display w-full border-b border-rule pb-4 text-left text-[18px] leading-tight text-ink2 transition-colors hover:text-spark"
              >
                The Big Picture
              </button>
            )}
            {edition.topStories.length > 0 && (
              <section aria-labelledby="briefing-contents-news" className="mt-4">
                <h3 id="briefing-contents-news" className="label text-ink4">
                  Top Stories
                </h3>
                <ol className="mt-2 divide-y divide-rule">
                  {edition.topStories.map((story, index) => (
                    <li key={story.id}>
                      <button
                        type="button"
                        onClick={() => onOpenSection(`briefing-${story.id}`)}
                        className="grid w-full grid-cols-[20px_1fr] items-baseline gap-2.5 py-3 text-left text-ink2 transition-colors hover:text-spark"
                      >
                        <span aria-hidden="true" className="mono tnum text-[10px] text-ink4">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 text-[16px] leading-[1.35]">
                          {formatBriefingText(story.headline, edition.outputLanguage)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {edition.worthReading.length > 0 && (
              <section
                aria-labelledby="briefing-contents-reading"
                className="mt-4 border-t border-rule pt-4"
              >
                <h3 id="briefing-contents-reading" className="label text-ink4">
                  Worth Reading
                </h3>
                <ol className="mt-2 divide-y divide-rule">
                  {edition.worthReading.map((deep, index) => {
                    const snapshot = edition.sourceSnapshots.find(
                      (source) => source.articleId === deep.articleId,
                    );
                    return (
                      <li key={deep.articleId}>
                        <button
                          type="button"
                          onClick={() => onOpenSection(`briefing-deep-${deep.articleId}`)}
                          className="grid w-full grid-cols-[20px_1fr] items-baseline gap-2.5 py-3 text-left text-ink2 transition-colors hover:text-spark"
                        >
                          <span aria-hidden="true" className="mono tnum text-[10px] text-ink4">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 text-[16px] leading-[1.35]">
                            {snapshot
                              ? formatBriefingText(snapshot.title, edition.outputLanguage)
                              : deep.articleId}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
            <div className="mono mt-3 text-[9.5px] tracking-[0.12em] text-ink4 uppercase">
              {edition.stats.candidates} stories considered · {edition.stats.fullTextsFetched}{" "}
              fetched · {edition.stats.llmRequests} model calls
            </div>
          </nav>
        )}

        {/* --------------------------------------------------------- history */}
        {briefing.editions.length > 1 && (
          <div className="flex max-h-[40%] shrink-0 flex-col border-t border-rule px-5 py-4">
            <button
              type="button"
              aria-expanded={historyOpen}
              aria-controls="briefing-history"
              onClick={() => setHistoryOpen((open) => !open)}
              className="label flex shrink-0 items-center gap-2 text-left text-ink4 transition-colors hover:text-spark"
            >
              <span className="flex-1">Earlier editions</span>
              <span className="tnum">{briefing.editions.length}</span>
              <ChevronDown
                size={12}
                strokeWidth={1.6}
                className={clsx("transition-transform", historyOpen && "rotate-180")}
              />
            </button>
            {historyOpen && (
              <ul
                id="briefing-history"
                className="scroll-thin mt-2 min-h-0 overflow-y-auto overscroll-contain"
              >
                {briefing.editions.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === edition?.id ? "page" : undefined}
                      onClick={() => briefing.open(item.id)}
                      className={clsx(
                        "flex h-[30px] w-full items-center gap-3 border-l-2 pr-2 pl-2 text-left transition-colors hover:bg-hoverc",
                        item.id === edition?.id
                          ? "border-spark text-spark"
                          : "border-transparent text-ink2",
                      )}
                    >
                      <span className="mono tnum min-w-0 flex-1 truncate text-[11.5px] leading-none">
                        {item.editionDate} · r{item.revision}
                      </span>
                      <span className="mono tnum shrink-0 text-[10px] leading-none text-ink4">
                        {item.topStories.length + item.worthReading.length} items
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
