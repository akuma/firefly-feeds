"use client";

import { clsx } from "./clsx";
import { useReader } from "@/lib/store";
import { DIGEST_MIN_CANDIDATES, staleCount } from "@/lib/digest";
import { digestStrings } from "@/lib/languages";
import { formatPublished } from "@/lib/shaping";
import { findService, serviceReady } from "@/lib/llm";
import type { DigestRecord } from "@/lib/storage/types";

/**
 * Today's briefing, as a page of its own in the stream column.
 *
 * The page is the whole feature's restraint in one place: it is dated, so it
 * stays put while the reader works through it; every line is a link back to a
 * real story; and the last line says where the words came from. The one thing
 * it must never do is stand in for the story itself, so the gist is a sentence
 * and the reason is a sentence — enough to decide, not enough to skip.
 *
 * It is a page rather than a banner above the stream because the two answer
 * different questions: the stream is what arrived, this is what is worth
 * reading. Mixing them made one of them a decoration on the other.
 *
 * The page's own words follow the language the edition is written in, which is
 * the one setting that makes this page worth having for a reader who does not
 * read English first. Everything the reader is scanning is in one language; the
 * rest of the application keeps its own.
 */
export function Briefing() {
  const r = useReader();
  const t = digestStrings(r.digestLanguage);

  const record = r.viewedDigest;
  const today = r.digestDay === null;
  const candidates = r.digestCandidates;
  const configured = (() => {
    const service = findService(r.llmConfig.service);
    return service ? serviceReady(service, r.llmConfig) : false;
  })();
  const picks = record ? record.picks : [];
  const newSince = today ? staleCount(record ?? undefined, candidates) : 0;
  // An edition written before the reader changed their mind about language is
  // not wrong, but it is not what they asked for — so it says so rather than
  // leaving them to wonder whether the feature is broken.
  const otherLanguage = record ? (record.language ?? "source") !== r.digestLanguage : false;

  return (
    <div data-t="briefing" className="px-5 pt-5 pb-12 lg:px-6">
      {record && (
        <div className="flex items-baseline justify-between gap-4">
          <p className="max-w-[54ch] text-[13px] leading-[1.5] text-ink4">
            {t.edition(picks.length, record.offered, record.candidates.length)}
          </p>
          {/* A past edition is finished work: only today's can be rewritten. */}
          {today && (
            <button
              type="button"
              onClick={r.regenerateDigest}
              disabled={r.digestWorking || r.digestRunsLeft <= 0}
              title={r.digestRunsLeft <= 0 ? t.capTitle : t.regenerateTitle}
              className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-ink disabled:opacity-40"
            >
              {r.digestWorking ? t.rewriting : t.regenerate}
            </button>
          )}
        </div>
      )}

      {/* ------------------------------------------------------- states */}
      {!r.digestEnabled && (
        <EmptyState title={t.off}>
          <button
            type="button"
            onClick={() => r.setSettingsOpen(true)}
            className="mono mt-2 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            {t.offAction}
          </button>
        </EmptyState>
      )}

      {r.digestEnabled && !record && candidates.length < DIGEST_MIN_CANDIDATES && (
        <EmptyState title={t.quiet}>
          <p className="max-w-[46ch]">{t.quietNote}</p>
        </EmptyState>
      )}

      {r.digestEnabled && !record && !configured && candidates.length >= DIGEST_MIN_CANDIDATES && (
        <EmptyState title={t.unconfigured}>
          <p className="max-w-[46ch]">{t.unconfiguredNote}</p>
          <button
            type="button"
            onClick={() => r.setSettingsOpen(true)}
            className="mono mt-2 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            {t.offAction}
          </button>
        </EmptyState>
      )}

      {r.digestEnabled &&
        !record &&
        today &&
        (r.digestWorking || (configured && !r.digestError)) && (
          <p className="mono mt-4 text-[10px] tracking-[0.12em] text-ink4 uppercase">{t.writing}</p>
        )}

      {r.digestError && (
        <div className="mt-4 flex items-start justify-between gap-4 border-l-2 border-spark py-1 pl-4">
          <p className="text-[13.5px] leading-[1.5] text-ink2">{r.digestError}</p>
          <button
            type="button"
            onClick={r.retryDigest}
            className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            {t.retry}
          </button>
        </div>
      )}

      {/* -------------------------------------------------- the edition */}
      {record && (
        <ol className="mt-6 border-t border-rulesoft">
          {picks.map((id, index) => {
            const story = r.story(id);
            // A story the cache has dropped cannot be summarised any more, so
            // the line goes rather than pointing at something that is not there.
            if (!story) return null;
            return (
              <li key={id} className="border-b border-rulesoft py-5 last:border-b-0">
                <button
                  type="button"
                  onClick={() => openStory(r, id)}
                  className="group block w-full text-left"
                >
                  <div className="flex items-baseline gap-3.5">
                    <span className="mono shrink-0 text-[10px] tracking-[0.14em] text-ink4">
                      {index + 1}
                    </span>
                    <h2
                      className={clsx(
                        "display min-w-0 flex-1 text-[19px] leading-[1.24] tracking-[-0.014em] transition-colors",
                        "group-hover:text-spark",
                        r.state.read[id] ? "text-ink3" : "text-ink",
                      )}
                    >
                      {story.title}
                    </h2>
                  </div>
                  <p className="mt-2 pl-8 text-[15px] leading-[1.5] text-ink2">
                    {record.gists[id]}
                  </p>
                  <p className="mt-1.5 pl-8 text-[13px] leading-[1.5] text-ink4">
                    {record.reasons[id]}
                  </p>
                  <div className="mono mt-2.5 flex min-w-0 items-center gap-2 pl-8 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                    <span>{t.minutes(story.minutes)}</span>
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
        <p className="mono mt-6 max-w-[58ch] text-[9.5px] leading-[1.8] tracking-[0.08em] text-ink4 uppercase">
          {t.provenance}
        </p>
      )}

      {record && otherLanguage && (
        <p className="mono mt-2.5 text-[9.5px] tracking-[0.14em] text-spark uppercase">
          {t.otherLanguage}
        </p>
      )}

      {record && newSince > 0 && (
        <p className="mono mt-2.5 text-[9.5px] tracking-[0.14em] text-spark uppercase">
          {t.stale(newSince)}
        </p>
      )}

      <EarlierEditions
        records={r.digestHistory}
        onOpen={r.setDigestDay}
        todayLabel={t.today}
        heading={t.history}
        count={t.picks}
      />
    </div>
  );
}

/**
 * The editions that came before, as a list of past issues rather than a
 * calendar: a reader who wants a date goes looking for one, and a reader who
 * wants to know what they were given last Tuesday wants a name, not a widget.
 */
function EarlierEditions({
  records,
  onOpen,
  todayLabel,
  heading,
  count,
}: {
  records: DigestRecord[];
  onOpen: (day: string | null) => void;
  todayLabel: string;
  heading: string;
  count: (n: number) => string;
}) {
  const r = useReader();
  const today = r.digestDay === null;
  if (records.length === 0) return null;
  return (
    <div className="mt-10 border-t border-rule pt-5">
      <div className="label text-ink4">{heading}</div>
      <ul className="mt-3">
        {records.map((record) => {
          const isToday = record.day === r.digest?.day;
          return (
            <li key={record.day}>
              <button
                type="button"
                onClick={() => onOpen(record.day)}
                className="group flex h-[30px] w-full items-center gap-3 pr-4 text-left transition-colors hover:bg-hoverc"
              >
                <span className="mono min-w-0 flex-1 truncate text-[11.5px] leading-none text-ink2 transition-colors group-hover:text-ink">
                  {isToday ? todayLabel : formatPublished(dayToTime(record.day))}
                </span>
                <span className="mono tnum shrink-0 text-[10px] leading-none text-ink4">
                  {count(record.picks.length)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!today && (
        <button
          type="button"
          onClick={() => onOpen(null)}
          className="mono mt-3 text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
        >
          {todayLabel}
        </button>
      )}
    </div>
  );
}

/** A day key read at noon, so no timezone can put it on the wrong date. */
function dayToTime(day: string): number {
  return new Date(`${day}T12:00:00`).getTime();
}

/** An empty page still has to say why it is empty. */
function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 border-t border-rulesoft pt-6">
      <div className="label text-ink3">{title}</div>
      <div className="mt-3 max-w-[52ch] text-[14px] leading-[1.55] text-ink4">{children}</div>
    </div>
  );
}

/** Opening a pick is opening a story: the same click a row in the stream is. */
function openStory(r: ReturnType<typeof useReader>, id: string) {
  if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
  r.select(id);
  r.setMobileReading(true);
}
