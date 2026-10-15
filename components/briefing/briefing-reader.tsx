"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatBriefingText } from "@/lib/briefing/typography";
import { readingTime } from "@/lib/reading";
import { useReader } from "@/lib/store";
import { clsx } from "../clsx";
import type { BriefingEdition, BriefingSourceSnapshot, SupportedText } from "@/lib/briefing/types";
import type { useBriefing } from "@/lib/briefing/useBriefing";
import { canonicalUrl } from "@/lib/briefing/candidates";
import { localDate } from "@/lib/briefing/pipeline";
import { ArticlePane } from "../article-pane";

/**
 * The briefing's reading pane: the edition as a piece of writing, with every
 * claim traceable to the sources it rests on.
 *
 * The sources are the program's own metadata — publication, headline, link —
 * captured when the edition was published, never the model's words. When the
 * article behind a citation is still cached the reader opens it here; when the
 * cache has dropped it, the verified snapshot link still works; and when there
 * is no link at all, the row says so rather than inventing one.
 */

type Briefing = ReturnType<typeof useBriefing>;

function ReadingTime({ edition }: { edition: BriefingEdition }) {
  const words = [
    edition.bigPicture?.text,
    ...edition.topStories.flatMap((s) => [
      s.whatHappened.text,
      s.context?.text ?? "",
      s.whyItMatters?.text ?? "",
      ...s.perspectives.map((p) => p.text),
    ]),
    ...edition.worthReading.map((d) => d.whyRead.text),
  ].join(" ");
  const minutes = readingTime([{ kind: "p", text: words }]);
  return (
    <span className="mono tnum">
      {minutes} min read · {edition.stats.sourcesConsidered}{" "}
      {edition.stats.sourcesConsidered === 1 ? "source" : "sources"}
    </span>
  );
}

function SourceList({
  ids,
  snapshots,
  onOpen,
  showTitles = true,
}: {
  ids: string[];
  snapshots: BriefingSourceSnapshot[];
  onOpen: (articleId: string) => void;
  showTitles?: boolean;
}) {
  const r = useReader();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <ul className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
      {ids.map((id) => {
        const snapshot = snapshots.find((s) => s.articleId === id);
        if (!snapshot) return null;
        return (
          <li key={id} className="flex max-w-full min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label={!showTitles ? `${snapshot.sourceName}: ${snapshot.title}` : undefined}
              onClick={() => {
                // With no cached article and no verified link there is nothing
                // to open — and the row says so rather than inventing one.
                if (!r.story(id) && !snapshot.url) {
                  setFailed(id);
                  return;
                }
                onOpen(id);
              }}
              className="mono flex max-w-full min-w-0 items-center gap-1.5 text-[9.5px] tracking-[0.13em] text-ink4 uppercase transition-colors hover:text-spark"
            >
              <span className="min-w-0 truncate">{snapshot.sourceName}</span>
              {showTitles && (
                <span className="max-w-[24ch] truncate text-ink3">{snapshot.title}</span>
              )}
              <ExternalLink size={10} strokeWidth={1.8} aria-hidden />
            </button>
            {failed === id && (
              <span className="mono text-[9px] tracking-[0.12em] text-spark uppercase">
                Source no longer available
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Section({
  id,
  label,
  text,
  snapshots,
  onOpen,
  showSources = true,
  language,
}: {
  id: string;
  label: string;
  text: SupportedText;
  showSources?: boolean;
  language?: BriefingEdition["outputLanguage"];
  snapshots: BriefingSourceSnapshot[];
  onOpen: (articleId: string) => void;
}) {
  const Heading = label === "The Big Picture" ? "h2" : "h4";
  return (
    // Keep absolute sr-only headings inside the reader's clipped scroll area.
    <section id={id} className="relative mt-5">
      <Heading
        className={
          label === "The Big Picture"
            ? "display text-[24px] leading-tight font-medium tracking-normal text-ink"
            : "sr-only"
        }
      >
        {label}
      </Heading>
      <p
        className={clsx(
          "max-w-[62ch] tracking-[0.005em] text-ink",
          label === "The Big Picture"
            ? "mt-4 text-[length:calc(var(--reader-size,19px)*1.08)] leading-[1.6]"
            : "mt-2.5 text-[length:var(--reader-size,19px)] leading-[1.65]",
        )}
      >
        {formatBriefingText(text.text, language)}
      </p>
      {showSources && (
        <SourceList
          ids={[...new Set(text.evidence.map((e) => e.articleId))]}
          snapshots={snapshots}
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

export function BriefingReader({ briefing }: { briefing: Briefing }) {
  const r = useReader();
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const positions = useRef(new Map<string, number>());
  const [readingArticle, setReadingArticle] = useState(false);

  const edition = briefing.current;
  const [today] = useState(() =>
    localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const articleVisible = readingArticle && r.mobileReading;
  useLayoutEffect(() => {
    if (!articleVisible && scrollRef.current && edition)
      scrollRef.current.scrollTop = positions.current.get(edition.id) ?? 0;
  }, [edition, articleVisible]);
  const back = () => {
    setReadingArticle(false);
    r.setMobileReading(false);
    r.setImmersive(false);
  };

  // Opening a cited source and coming back must land the reader where they
  // were: the briefing is a page with a place in it, not a stream of rows.
  const openSource = (articleId: string) => {
    const snapshot = briefing.current?.sourceSnapshots.find((s) => s.articleId === articleId);
    if (r.story(articleId)) {
      savedScroll.current = scrollRef.current?.scrollTop ?? 0;
      if (edition) positions.current.set(edition.id, savedScroll.current);
      setReadingArticle(true);
      r.select(articleId);
      r.setMobileReading(true);
      return;
    }
    if (snapshot?.url && canonicalUrl(snapshot.url)) {
      window.open(snapshot.url, "_blank", "noreferrer");
      return;
    }
  };

  if (articleVisible) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-reader">
        <div className="hidden h-11 shrink-0 items-center border-b border-rule px-4 lg:flex">
          <button
            type="button"
            data-t="briefing-back"
            onClick={back}
            className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-spark"
          >
            <ArrowLeft size={12} strokeWidth={1.8} />
            Back to Briefing
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ArticlePane onBack={back} />
        </div>
      </div>
    );
  }

  if (!edition) {
    return (
      <div data-t="briefing-reader" className="flex h-full items-center justify-center bg-reader">
        <p className="label text-ink4">No edition yet</p>
      </div>
    );
  }

  const coverageFormat = new Intl.DateTimeFormat("en", {
    timeZone: edition.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return (
    <div
      data-t="briefing-reader"
      ref={scrollRef}
      onScroll={() => {
        savedScroll.current = scrollRef.current?.scrollTop ?? 0;
        if (edition) positions.current.set(edition.id, savedScroll.current);
      }}
      className="scroll-thin h-full overflow-y-auto overscroll-contain bg-reader"
    >
      <article
        lang={edition.outputLanguage === "source" ? undefined : (edition.outputLanguage ?? "en")}
        className="mx-auto max-w-[720px] px-6 pt-9 pb-16 lg:px-10 lg:pt-12"
      >
        <header className="mb-8 border-b border-spark/40 pb-7 lg:mb-10 lg:pb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="label text-spark">Daily Briefing</span>
            <span className="mono tnum text-[10px] tracking-[0.12em] text-ink4 uppercase">
              {edition.editionDate}
              {edition.revision > 1 ? ` · revision ${edition.revision}` : ""}
            </span>
          </div>
          <h1 className="mt-5 font-briefing-title text-[40px] leading-[1.04] font-normal tracking-[0.015em] text-ink lg:text-[52px]">
            {edition.editionDate === today ? "Today’s " : "Daily "}
            <span className="text-spark">Briefing</span>
          </h1>
          <div className="mono mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[9.5px] tracking-[0.13em] text-ink4 uppercase">
            <ReadingTime edition={edition} />
            <span aria-hidden>·</span>
            <span>{edition.model.model || edition.model.provider}</span>
            <time dateTime={new Date(edition.generatedAt).toISOString()}>
              Generated{" "}
              {new Intl.DateTimeFormat("en", {
                timeZone: edition.timezone,
                hour: "numeric",
                minute: "2-digit",
              }).format(edition.generatedAt)}{" "}
              · {edition.timezone}
            </time>
          </div>
          {edition.coverageStartedAt !== undefined && (
            <p
              data-t="briefing-coverage"
              className="mono mt-3 text-[9.5px] leading-[1.7] tracking-[0.08em] text-ink4 uppercase"
            >
              Coverage ·{" "}
              <time dateTime={new Date(edition.coverageStartedAt).toISOString()}>
                {coverageFormat.format(edition.coverageStartedAt)}
              </time>
              {" — "}
              <time dateTime={new Date(edition.cutoffAt).toISOString()}>
                {coverageFormat.format(edition.cutoffAt)}
              </time>
              {" · "}
              {edition.timezone}
            </p>
          )}
        </header>

        {edition.bigPicture && (
          <Section
            id="briefing-big-picture"
            label="The Big Picture"
            text={edition.bigPicture}
            language={edition.outputLanguage}
            snapshots={edition.sourceSnapshots}
            onOpen={openSource}
          />
        )}

        {edition.topStories.length > 0 && (
          <section aria-labelledby="briefing-news-heading" className="mt-12 lg:mt-14">
            <div className="mb-7 flex items-baseline justify-between gap-4 border-t-2 border-ink pt-4">
              <h2
                id="briefing-news-heading"
                className="display text-[28px] leading-tight font-medium tracking-normal text-ink"
              >
                Top Stories
              </h2>
              <span className="label shrink-0 text-spark">
                {edition.topStories.length} {edition.topStories.length === 1 ? "story" : "stories"}
              </span>
            </div>
            {edition.topStories.map((story, index) => (
              <div
                key={story.id}
                id={`briefing-${story.id}`}
                className={clsx(
                  "scroll-mt-6",
                  index > 0 && "mt-9 border-t border-rule pt-8 lg:mt-10",
                )}
              >
                <h3
                  className={clsx(
                    "display font-normal text-ink",
                    index === 0
                      ? "max-w-[24ch] text-[32px] leading-[1.12] tracking-normal lg:text-[38px]"
                      : "text-[25px] leading-[1.16] tracking-normal lg:text-[28px]",
                  )}
                >
                  {formatBriefingText(story.headline, edition.outputLanguage)}
                </h3>
                <Section
                  id={`briefing-${story.id}-what`}
                  label="What happened"
                  text={story.whatHappened}
                  snapshots={edition.sourceSnapshots}
                  language={edition.outputLanguage}
                  showSources={false}
                  onOpen={openSource}
                />
                {story.context && (
                  <Section
                    id={`briefing-${story.id}-context`}
                    label="Context"
                    text={story.context}
                    snapshots={edition.sourceSnapshots}
                    language={edition.outputLanguage}
                    showSources={false}
                    onOpen={openSource}
                  />
                )}
                {story.whyItMatters && (
                  <Section
                    id={`briefing-${story.id}-why`}
                    label="Why it matters"
                    text={story.whyItMatters}
                    snapshots={edition.sourceSnapshots}
                    language={edition.outputLanguage}
                    showSources={false}
                    onOpen={openSource}
                  />
                )}
                {story.perspectives.map((line) => (
                  <Section
                    key={`${story.id}-p-${line.text.slice(0, 24)}`}
                    id={`briefing-${story.id}-p-${line.text.slice(0, 12)}`}
                    label="Perspectives"
                    text={line}
                    snapshots={edition.sourceSnapshots}
                    language={edition.outputLanguage}
                    showSources={false}
                    onOpen={openSource}
                  />
                ))}
                <SourceList
                  ids={[
                    ...new Set([
                      ...story.sourceArticleIds,
                      ...[
                        story.whatHappened,
                        story.context,
                        story.whyItMatters,
                        ...story.perspectives,
                      ].flatMap((text) => text?.evidence.map((ref) => ref.articleId) ?? []),
                    ]),
                  ]}
                  snapshots={edition.sourceSnapshots}
                  onOpen={openSource}
                />
              </div>
            ))}
          </section>
        )}

        {edition.worthReading.length > 0 && (
          <section aria-labelledby="briefing-reading-heading" className="mt-14 lg:mt-16">
            <div className="border-t-2 border-ink pt-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2
                  id="briefing-reading-heading"
                  className="display text-[28px] leading-tight font-medium tracking-normal text-ink"
                >
                  Worth Reading
                </h2>
                <span className="label shrink-0 text-spark">
                  {edition.worthReading.length}{" "}
                  {edition.worthReading.length === 1 ? "pick" : "picks"}
                </span>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink3">
                Ideas to spend more time with.
              </p>
            </div>
            {edition.worthReading.map((deep, index) => {
              const snapshot = edition.sourceSnapshots.find((s) => s.articleId === deep.articleId);
              return (
                <div
                  key={deep.articleId}
                  id={`briefing-deep-${deep.articleId}`}
                  className="mt-6 grid scroll-mt-6 grid-cols-[30px_minmax(0,1fr)] gap-x-3 border-t border-rule pt-6 lg:grid-cols-[38px_minmax(0,1fr)] lg:gap-x-4"
                >
                  <span
                    aria-hidden
                    className="mono tnum row-span-3 pt-1 text-[14px] tracking-[-0.03em] text-spark"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="display text-[22px] leading-[1.2] font-normal tracking-normal text-ink lg:text-[24px]">
                    {snapshot
                      ? formatBriefingText(snapshot.title, edition.outputLanguage)
                      : deep.articleId}
                  </h3>
                  <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.6] text-ink2">
                    {formatBriefingText(deep.whyRead.text, edition.outputLanguage)}
                  </p>
                  <SourceList
                    ids={[deep.articleId]}
                    snapshots={edition.sourceSnapshots}
                    onOpen={openSource}
                    showTitles={false}
                  />
                </div>
              );
            })}
          </section>
        )}

        {edition.coverageIncomplete && (
          <p className="mt-8 border-l-2 border-spark pl-4 text-[14px] leading-relaxed text-ink3">
            Some feeds could not be refreshed before this edition. Coverage may be incomplete.
          </p>
        )}
        <p className="mono mt-12 max-w-[62ch] text-[9.5px] leading-[1.9] tracking-[0.08em] text-ink4 uppercase">
          Written from the selected stories&rsquo; own text and summaries, with every claim quoted
          from them. References and quoted excerpts were checked against the supplied material; AI
          interpretation can still contain errors.
          {!!edition.stats.omittedWeakItems &&
            ` ${edition.stats.omittedWeakItems} proposed topic${edition.stats.omittedWeakItems === 1 ? " was" : "s were"} omitted after editorial checks.`}
          {!!edition.stats.omittedUnsupportedSections &&
            ` ${edition.stats.omittedUnsupportedSections} optional section${edition.stats.omittedUnsupportedSections === 1 ? " was" : "s were"} omitted after evidence checks.`}
          {edition.stats.fullTextsFailed > 0 &&
            ` ${edition.stats.fullTextsFailed} source${edition.stats.fullTextsFailed === 1 ? "" : "s"} could not be read in full.`}
        </p>
      </article>
    </div>
  );
}
