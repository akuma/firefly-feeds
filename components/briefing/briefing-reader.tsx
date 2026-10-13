"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { useReader } from "@/lib/store";
import type { BriefingEdition, BriefingSourceSnapshot, SupportedText } from "@/lib/briefing/types";
import type { useBriefing } from "@/lib/briefing/useBriefing";
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
  const minutes = Math.max(1, Math.round(words.split(/\s+/).length / 200));
  return (
    <span className="mono tnum">
      {minutes} min read · {edition.stats.sourcesConsidered} sources
    </span>
  );
}

function SourceList({
  ids,
  snapshots,
  onOpen,
}: {
  ids: string[];
  snapshots: BriefingSourceSnapshot[];
  onOpen: (articleId: string) => void;
}) {
  const r = useReader();
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {ids.map((id) => {
        const snapshot = snapshots.find((s) => s.articleId === id);
        if (!snapshot) return null;
        return (
          <li key={id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // With no cached article and no verified link there is nothing
                // to open — and the row says so rather than inventing one.
                if (!r.story(id) && !snapshot.url) {
                  setFailed(id);
                  return;
                }
                onOpen(id);
              }}
              className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.13em] text-ink4 uppercase transition-colors hover:text-spark"
            >
              {snapshot.sourceName}
              <span className="max-w-[24ch] truncate text-ink3">{snapshot.title}</span>
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
}: {
  id: string;
  label: string;
  text: SupportedText;
  snapshots: BriefingSourceSnapshot[];
  onOpen: (articleId: string) => void;
}) {
  return (
    <section id={id} className="mt-8">
      <h3 className="label text-spark">{label}</h3>
      <p className="mt-2.5 max-w-[62ch] text-[17px] leading-[1.62] text-ink">{text.text}</p>
      <SourceList
        ids={[...new Set(text.evidence.map((e) => e.articleId))]}
        snapshots={snapshots}
        onOpen={onOpen}
      />
    </section>
  );
}

export function BriefingReader({ briefing }: { briefing: Briefing }) {
  const r = useReader();
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const [readingArticle, setReadingArticle] = useState(false);

  // Opening a cited source and coming back must land the reader where they
  // were: the briefing is a page with a place in it, not a stream of rows.
  const openSource = (articleId: string) => {
    const snapshot = briefing.current?.sourceSnapshots.find((s) => s.articleId === articleId);
    if (r.story(articleId)) {
      savedScroll.current = scrollRef.current?.scrollTop ?? 0;
      setReadingArticle(true);
      r.select(articleId);
      r.setMobileReading(true);
      return;
    }
    if (snapshot?.url) {
      window.open(snapshot.url, "_blank", "noreferrer");
      return;
    }
  };

  const edition = briefing.current;

  if (readingArticle) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-reader">
        <div className="flex h-11 shrink-0 items-center border-b border-rule px-4">
          <button
            type="button"
            onClick={() => {
              setReadingArticle(false);
              requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
              });
            }}
            className="mono flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase transition-colors hover:text-spark"
          >
            <ArrowLeft size={12} strokeWidth={1.8} />
            Back to Briefing
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ArticlePane />
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

  return (
    <div
      data-t="briefing-reader"
      ref={scrollRef}
      onScroll={() => {
        savedScroll.current = scrollRef.current?.scrollTop ?? 0;
      }}
      className="scroll-thin h-full overflow-y-auto overscroll-contain bg-reader"
    >
      <article className="mx-auto max-w-[720px] px-6 pt-8 pb-16 lg:px-10">
        <header className="border-b border-rule pb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="label text-spark">Daily Briefing</span>
            <span className="mono tnum text-[10px] tracking-[0.12em] text-ink4 uppercase">
              {edition.editionDate}
              {edition.revision > 1 ? ` · revision ${edition.revision}` : ""}
            </span>
          </div>
          <h1 className="display mt-3 text-[32px] leading-[1.08] font-medium tracking-[-0.02em] text-ink">
            Today&apos;s Briefing
          </h1>
          <div className="mono mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] tracking-[0.13em] text-ink4 uppercase">
            <ReadingTime edition={edition} />
            <span aria-hidden>·</span>
            <span>{edition.model.model || edition.model.provider}</span>
          </div>
        </header>

        {edition.bigPicture && (
          <Section
            id="briefing-big-picture"
            label="The Big Picture"
            text={edition.bigPicture}
            snapshots={edition.sourceSnapshots}
            onOpen={openSource}
          />
        )}

        {edition.topStories.length > 0 && (
          <div className="mt-10">
            <h2 className="label text-ink4">Top Stories</h2>
            {edition.topStories.map((story) => (
              <div key={story.id} className="mt-6 border-t border-rulesoft pt-6 first:border-0">
                <h2 className="display text-[24px] leading-[1.14] font-medium tracking-[-0.016em] text-ink">
                  {story.headline}
                </h2>
                <Section
                  id={`briefing-${story.id}`}
                  label="What happened"
                  text={story.whatHappened}
                  snapshots={edition.sourceSnapshots}
                  onOpen={openSource}
                />
                {story.context && (
                  <Section
                    id={`briefing-${story.id}-context`}
                    label="Context"
                    text={story.context}
                    snapshots={edition.sourceSnapshots}
                    onOpen={openSource}
                  />
                )}
                {story.whyItMatters && (
                  <Section
                    id={`briefing-${story.id}-why`}
                    label="Why it matters"
                    text={story.whyItMatters}
                    snapshots={edition.sourceSnapshots}
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
                    onOpen={openSource}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {edition.worthReading.length > 0 && (
          <div className="mt-10">
            <h2 className="label text-ink4">Worth Reading</h2>
            {edition.worthReading.map((deep) => {
              const snapshot = edition.sourceSnapshots.find((s) => s.articleId === deep.articleId);
              return (
                <div
                  key={deep.articleId}
                  id={`briefing-deep-${deep.articleId}`}
                  className="mt-6 border-t border-rulesoft pt-6 first:border-0"
                >
                  <h3 className="display text-[19px] leading-[1.3] font-medium text-ink">
                    {snapshot?.title ?? deep.articleId}
                  </h3>
                  <p className="mt-2 max-w-[62ch] text-[15.5px] leading-[1.58] text-ink3">
                    {deep.whyRead.text}
                  </p>
                  <SourceList
                    ids={[deep.articleId]}
                    snapshots={edition.sourceSnapshots}
                    onOpen={openSource}
                  />
                </div>
              );
            })}
          </div>
        )}

        <p className="mono mt-12 max-w-[62ch] text-[9.5px] leading-[1.9] tracking-[0.08em] text-ink4 uppercase">
          Written from the selected stories&rsquo; own text and summaries, with every claim quoted
          from them. Nothing was fetched beyond those stories, and nothing was invented.
          {edition.stats.fullTextsFailed > 0 &&
            ` ${edition.stats.fullTextsFailed} source${edition.stats.fullTextsFailed === 1 ? "" : "s"} could not be read in full.`}
        </p>
      </article>
    </div>
  );
}
