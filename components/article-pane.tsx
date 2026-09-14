"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  Maximize2,
  Minimize2,
  Moon,
  Play,
  Sun,
  Type,
  ExternalLink,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "./clsx";
import { IconButton, Rule } from "./brand";
import { Media, hasArt } from "./plate";
import { FOLDERS } from "@/lib/sources";
import { DWELL_MS, progressFor, readSignal } from "@/lib/reading";
import { FONT_SIZES, useReader, type ReaderFont } from "@/lib/store";
import type { Block } from "@/lib/types";

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A cross-origin player needs `allow-scripts` to run and `allow-same-origin`
 * to keep its own storage. The usual objection — that a frame could remove its
 * own sandbox — only applies when it shares our origin, which an allowlisted
 * provider never does.
 */
/* oxlint-disable react/iframe-missing-sandbox */
function VideoEmbed({
  provider,
  id,
  title,
}: {
  provider: "youtube" | "vimeo";
  id: string;
  title?: string;
}) {
  const src =
    provider === "vimeo"
      ? `https://player.vimeo.com/video/${id}`
      : `https://www.youtube-nocookie.com/embed/${id}`;
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-plate">
      <iframe
        src={src}
        title={title ?? "Video"}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
/* oxlint-enable react/iframe-missing-sandbox */

/* ------------------------------------------------------------- font menu */

/**
 * Rendered exactly once, from <ArticlePane>, never from the toolbars. The
 * toolbars exist twice in the DOM (desktop + mobile, one hidden by CSS), and a
 * popover inside a shared fragment gets two outside-click listeners — the wrong
 * one closes the menu on mousedown, unmounting the button before its click
 * lands. That is why text size used to appear broken.
 */
function FontMenu({ onClose }: { onClose: () => void }) {
  const r = useReader();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || ref.current?.contains(t)) return;
      if (t.closest("[data-font-trigger]")) return; // the trigger toggles itself
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="w-[196px] border border-rule bg-reader p-3.5 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)]"
    >
      <div className="label text-ink4">Text size</div>
      <div className="mt-3 grid grid-cols-4 items-end gap-1">
        {FONT_SIZES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => r.setFont(i as ReaderFont)}
            className={clsx(
              "flex items-end justify-center pt-2 pb-1.5 transition-colors",
              r.font === i
                ? "bg-ink text-canvas"
                : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc",
            )}
            style={{ height: 38 }}
            aria-label={`Text size ${i + 1}`}
          >
            <span style={{ fontSize: 11 + i * 2.5, lineHeight: 1 }}>A</span>
          </button>
        ))}
      </div>
      <div className="mt-3.5 h-px w-full bg-rule" />
      <div className="mono mt-3 flex items-center justify-between text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
        <span className="flex items-center gap-1.5">
          <Sun size={11} strokeWidth={1.6} />
          <Moon size={11} strokeWidth={1.6} />
          Theme
        </span>
        <span>T</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- block render */

function Blocks({ blocks }: { blocks: Block[] }) {
  const lede = blocks[0]?.kind === "p";

  return (
    <div className={clsx("reading", lede && "lede")}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "p":
            return <p key={i}>{b.text}</p>;

          case "h2":
            return (
              <h2
                key={i}
                className="relative before:absolute before:top-[0.7em] before:-left-5 before:h-px before:w-3 before:bg-spark before:content-['']"
              >
                {b.text}
              </h2>
            );

          case "quote":
            return (
              <blockquote key={i} className="my-[2.2em] border-l-2 border-spark pl-5">
                <p className="text-[1.16em] leading-[1.45] text-ink italic">“{b.text}”</p>
                {b.cite && (
                  <footer className="mono mt-3 text-[10px] tracking-[0.14em] text-ink4 uppercase">
                    — {b.cite}
                  </footer>
                )}
              </blockquote>
            );

          case "list":
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );

          case "figure":
            return (
              <figure key={i} className="my-[2.4em]">
                <Media
                  seed={b.seed}
                  src={b.src}
                  alt={b.caption}
                  big
                  className="aspect-[16/9] w-full"
                />
                <figcaption className="mono mt-3 max-w-[62ch] text-[10px] leading-[1.75] tracking-[0.08em] text-ink4 uppercase">
                  {b.caption}
                </figcaption>
              </figure>
            );

          case "video":
            return (
              <figure key={i} className="my-[2.4em]">
                <VideoEmbed provider={b.provider} id={b.id} title={b.title} />
                {b.title && (
                  <figcaption className="mono mt-3 max-w-[62ch] text-[10px] leading-[1.75] tracking-[0.08em] text-ink4 uppercase">
                    {b.title}
                  </figcaption>
                )}
              </figure>
            );

          case "note":
            return (
              <aside key={i} className="my-[2.3em] border-y border-rule py-5">
                <div className="label mb-3 flex items-center gap-2 text-spark">Note</div>
                <div className="mono text-[12.5px] leading-[1.75] text-ink3">{b.text}</div>
              </aside>
            );

          case "code":
            return (
              <pre
                key={i}
                className="my-[2.2em] overflow-x-auto border-l-2 border-spark bg-hoverc px-4 py-3.5"
              >
                <code className="mono block text-[12.5px] leading-[1.8] text-ink2">{b.text}</code>
              </pre>
            );

          case "rule":
            return <hr key={i} className="my-10 h-px border-0 bg-rule" />;

          default:
            return null;
        }
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- pane */

export function ArticlePane() {
  const r = useReader();
  const s = r.story(r.selectedId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [fontOpen, setFontOpen] = useState(false);
  /** Stories already credited by the scroll-to-end rule, so it fires once each. */
  const credited = useRef(new Set<string>());

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setProgress(progressFor(el));
  }, []);

  /*
   * The scroll container is an external system, and its extent changes when the
   * story changes or immersive mode removes the toolbars — hence the extra
   * dependencies. Resetting and re-measuring here is the point of the effect.
   *
   * `ready` is one of those dependencies for a reason that is easy to miss: the
   * container does not exist until storage has loaded, so on the first pass the
   * ref is null and there is nothing to listen to. Without `ready` here the
   * effect never runs again — which is exactly how the progress bar spent a
   * while doing nothing at all.
   */
  /* oxlint-disable react/set-state-in-effect, react/exhaustive-effect-dependencies */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setProgress(0);
    setFontOpen(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll, r.selectedId, r.immersive, r.ready]);
  /* oxlint-enable react/set-state-in-effect, react/exhaustive-effect-dependencies */

  /*
   * The read trigger. `readSignal` decides between the two kinds of evidence —
   * arriving at the end of something long, or staying with something short —
   * and this only has to apply the answer. It runs on `progress` so it consults
   * committed geometry rather than measuring mid-scroll.
   */
  const registerReaderScroll = r.registerReaderScroll;
  // `ready` is the trigger, not a read: the container does not exist until
  // storage has loaded, so there is nothing to hand over before that.
  /* oxlint-disable react/exhaustive-effect-dependencies */
  useEffect(() => {
    registerReaderScroll(scrollRef.current);
    return () => registerReaderScroll(null);
  }, [registerReaderScroll, r.ready]);
  /* oxlint-enable react/exhaustive-effect-dependencies */

  const creditRead = r.markRead;
  // `progress` is the scroll signal this runs on; `readSignal` re-reads the
  // committed geometry itself, so the value is not used in the body.
  /* oxlint-disable react/exhaustive-effect-dependencies */
  useEffect(() => {
    if (!s || credited.current.has(s.id)) return;
    const el = scrollRef.current;
    if (!el) return;

    // `readSignal` owns the geometry, including the tolerance for landing a few
    // pixels short of the end. Gating on `progress === 1` first would defeat
    // that tolerance, leaving a long story unread after the reader had in fact
    // reached the bottom.
    const signal = readSignal(el);
    if (signal === "none") return;
    if (signal === "now") {
      credited.current.add(s.id);
      creditRead(s.id);
      return;
    }
    const timer = window.setTimeout(() => {
      credited.current.add(s.id);
      creditRead(s.id);
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [progress, s, creditRead]);
  /* oxlint-enable react/exhaustive-effect-dependencies */

  if (!r.ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-reader">
        <span className="label text-ink4">Opening the edition</span>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="flex h-full items-center justify-center bg-reader">
        <span className="label text-ink4">Select a story</span>
      </div>
    );
  }

  const feed = r.feedById(s.feedId);
  if (!feed) return null;
  const folder = FOLDERS.find((f) => f.id === feed.folder) ?? FOLDERS[0];
  // invented content: there is no original to open, and saying so is the point
  const isSample = Boolean(feed.sample);
  const saved = r.state.saved[s.id];
  const later = r.state.later[s.id];
  const read = r.state.read[s.id];

  const idx = r.filtered.findIndex((x) => x.id === s.id);
  const next = idx >= 0 ? r.filtered[idx + 1] : undefined;
  const pct = Math.round(progress * 100);

  /* ---------------------------------------------------------- toolbar */
  const canonical = r.originalUrl(s);
  // Open original only exists when the feed gave an article URL: a feed-native
  // entry has no original, and its source's homepage is not one.
  const articleHref = r.articleUrl(s);

  const actions = (
    <div className="flex items-center gap-0.5">
      <IconButton
        icon={ExternalLink}
        href={articleHref}
        label={isSample ? "Sample story — no original" : "Open original (O)"}
        disabled={!articleHref}
      />
      <IconButton
        icon={saved ? BookmarkCheck : Bookmark}
        label={saved ? "Remove from saved (S)" : "Save (S)"}
        active={saved}
        onClick={() => r.toggle("saved", s.id)}
      />
      <IconButton
        icon={Clock}
        label={later ? "Remove from Later (L)" : "Read later (L)"}
        active={later}
        onClick={() => r.toggle("later", s.id)}
      />
      <IconButton
        icon={Check}
        label={read ? "Mark unread (M)" : "Mark read (M)"}
        active={read}
        onClick={() => r.toggle("read", s.id)}
      />
      <div className="relative" data-font-trigger>
        <IconButton
          icon={Type}
          label="Text size"
          active={fontOpen}
          onClick={() => setFontOpen((v) => !v)}
        />
      </div>
      <IconButton
        icon={r.immersive ? Minimize2 : Maximize2}
        label={r.immersive ? "Exit immersive (Esc)" : "Immersive reading (F)"}
        active={r.immersive}
        onClick={() => r.setImmersive(!r.immersive)}
      />
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-reader">
      {/* ------------------------------------------------------ progress */}
      <div className="pointer-events-none absolute top-0 left-0 z-30 h-[2px] w-full bg-transparent">
        <div
          className="h-full bg-spark transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* ----------------------------------------------- desktop toolbar */}
      {!r.immersive && (
        <div className="hidden h-12 shrink-0 items-center gap-3 border-b border-rule pr-2.5 pl-6 lg:flex">
          <div className="mono flex min-w-0 items-center gap-2 text-[9.5px] tracking-[0.16em] uppercase">
            <span className="truncate text-ink3">{feed.name}</span>
            <span className="text-ink4" aria-hidden>
              ·
            </span>
            <span className="shrink-0 text-ink4">{folder.name}</span>
          </div>
          <div className="min-w-4 flex-1" />
          <span className="mono tnum shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
            {pct}%
          </span>
          {actions}
        </div>
      )}

      {/* ------------------------------------------------ mobile toolbar */}
      {!r.immersive && (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-rule px-1.5 lg:hidden">
          <IconButton
            icon={ArrowLeft}
            label="Back to stream"
            size={32}
            iconSize={17}
            onClick={() => r.setMobileReading(false)}
          />
          <div className="min-w-0 flex-1">
            <div className="mono truncate text-[9.5px] tracking-[0.16em] text-ink3 uppercase">
              {feed.name}
            </div>
            <div className="mono tnum truncate text-[9px] tracking-[0.14em] text-ink4 uppercase">
              {s.minutes} min · {pct}%
            </div>
          </div>
          {actions}
        </div>
      )}

      {/* ------------------------------------------------- immersive bar */}
      {r.immersive && (
        <div className="absolute top-0 right-0 z-30 flex items-center gap-1 p-2 opacity-25 transition-opacity duration-200 hover:opacity-100">
          {actions}
        </div>
      )}

      {/* --------------------------------------------- text size popover */}
      {fontOpen && (
        <div className="absolute right-3 z-40" style={{ top: r.immersive ? 46 : 52 }}>
          <FontMenu onClose={() => setFontOpen(false)} />
        </div>
      )}

      {/* ------------------------------------------------------ article */}
      <div
        ref={scrollRef}
        data-t="reader-scroll"
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <article
          key={s.id}
          className={clsx(
            "ff-rise mx-auto w-full",
            r.immersive
              ? "max-w-[724px] px-6 pt-16 pb-28 lg:px-11 lg:pt-24"
              : "max-w-[680px] px-6 pt-9 pb-24 lg:px-10 lg:pt-12",
          )}
        >
          <div className="label flex flex-wrap items-center gap-2.5 text-spark">
            <span>{feed.name}</span>
            <span className="h-px w-4 bg-spark opacity-60" aria-hidden />
            <span className="text-ink4">{folder.name}</span>
            {isSample && (
              <span className="bg-ink px-1.5 py-1 text-canvas" data-t="sample-tag">
                Sample
              </span>
            )}
          </div>

          <h1
            data-t="reader-title"
            className={clsx(
              "mt-5 text-ink",
              r.immersive
                ? "text-[34px] leading-[1.06] tracking-[-0.028em] lg:text-[46px]"
                : "text-[30px] leading-[1.07] tracking-[-0.026em] lg:text-[39px]",
            )}
          >
            {s.title}
          </h1>

          {s.dek && (
            <p className="mt-5 max-w-[54ch] text-[17px] leading-[1.5] tracking-[-0.006em] text-ink3 italic">
              {s.dek}
            </p>
          )}

          <div className="mt-7 h-px w-full bg-rule" />

          <div className="mono mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[9.5px] tracking-[0.15em] text-ink4 uppercase">
            <span>By {s.byline ?? feed.name}</span>
            <span className="tnum">
              {s.publishedLabel ?? r.edition.long} · {s.minutes} min read
            </span>
          </div>

          {hasArt(s) && (
            <figure className="mt-8">
              <div className="relative">
                <Media
                  seed={s.plate ?? 0}
                  src={s.image}
                  alt={s.title}
                  big
                  className="aspect-[16/9] w-full"
                />
                {s.videoPage && articleHref && (
                  <a
                    href={articleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Watch on ${hostOf(articleHref)}`}
                    className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/40"
                  >
                    <span className="flex items-center gap-2 bg-ink px-4 py-2.5 text-canvas">
                      <Play size={13} strokeWidth={2} fill="currentColor" />
                      <span className="mono text-[10px] tracking-[0.14em] uppercase">
                        Watch on {hostOf(articleHref)}
                      </span>
                    </span>
                  </a>
                )}
              </div>
              {isSample ? (
                <figcaption className="mono mt-2.5 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                  Sample edition
                </figcaption>
              ) : (
                s.imageCaption && (
                  <figcaption className="mono mt-3 max-w-[62ch] text-[10px] leading-[1.75] tracking-[0.04em] text-ink4">
                    {s.imageCaption}
                  </figcaption>
                )
              )}
            </figure>
          )}

          {!hasArt(s) && s.videoPage && articleHref && (
            <a
              href={articleHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 flex items-center justify-center gap-2 border border-rule py-4 text-ink3 transition-colors hover:text-spark"
            >
              <Play size={13} strokeWidth={2} fill="currentColor" />
              <span className="mono text-[10px] tracking-[0.14em] uppercase">
                Watch on {hostOf(articleHref)}
              </span>
            </a>
          )}

          <div className="mt-9" data-t="reader-body">
            {r.extracting === s.id && (
              <div className="mono mb-6 text-[10px] tracking-[0.14em] text-ink4 uppercase">
                Reading the full article…
              </div>
            )}
            <Blocks blocks={s.body} />
          </div>

          {/* ------------------------------------------------------ closer */}
          <div className="mt-16 flex flex-col items-center gap-3">
            <span className="label text-ink4">
              {s.contentState === "full" ? "End of story" : "Excerpt"}
            </span>
            {s.contentState !== "full" && articleHref && (
              <a
                href={articleHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mono mt-1 flex items-center gap-1.5 text-[9.5px] tracking-[0.14em] text-ink3 uppercase transition-colors hover:text-spark"
              >
                Continues at {hostOf(articleHref)}
                <ArrowUpRight size={10} strokeWidth={1.7} />
              </a>
            )}
            {s.extractionState === "failed" && (
              <span className="mono text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                Full text was unavailable
              </span>
            )}
          </div>

          <div className="mt-14">
            <Rule />
            {isSample ? (
              <div className="flex items-center justify-between gap-4 py-4">
                <span className="label text-ink4">Sample story</span>
                <span className="mono text-[10px] tracking-[0.08em] text-ink4">
                  Invented · no original
                </span>
              </div>
            ) : (
              <a
                href={canonical}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-4 py-4"
              >
                <span className="label text-ink4 transition-colors group-hover:text-ink2">
                  {s.live ? "Read the full piece" : "Original source"}
                </span>
                <span className="mono flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-ink3 transition-colors group-hover:text-spark">
                  {hostOf(canonical ?? feed.host)}
                  <ArrowUpRight size={11} strokeWidth={1.7} />
                </span>
              </a>
            )}

            {next && (
              <button
                type="button"
                onClick={() => {
                  r.select(next.id);
                  r.setMobileReading(true);
                  scrollRef.current?.scrollTo({ top: 0 });
                }}
                className="group block w-full border-t border-rule pt-5 text-left"
              >
                <div className="label flex items-center justify-between text-ink4">
                  <span>Next up</span>
                  <span className="transition-colors group-hover:text-spark">Press J</span>
                </div>
                <h3 className="mt-3 text-[23px] leading-[1.18] tracking-[-0.02em] text-ink transition-colors group-hover:text-ink2">
                  {next.title}
                </h3>
                <div className="mono mt-2.5 flex flex-wrap items-center gap-2 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
                  <span>{r.feedById(next.feedId)?.name ?? ""}</span>
                  <span aria-hidden>·</span>
                  <span>{next.minutes} min</span>
                </div>
              </button>
            )}
          </div>
        </article>
      </div>

      {/* ------------------------------------------- mobile action bar */}
      {!r.immersive && (
        <div className="flex h-[58px] shrink-0 items-stretch border-t border-rule bg-reader lg:hidden">
          {[
            {
              key: "saved",
              icon: saved ? BookmarkCheck : Bookmark,
              label: saved ? "Saved" : "Save",
              active: saved,
              onClick: () => r.toggle("saved", s.id),
            },
            {
              key: "later",
              icon: Clock,
              label: later ? "Queued" : "Later",
              active: later,
              onClick: () => r.toggle("later", s.id),
            },
            {
              key: "read",
              icon: Check,
              label: read ? "Read" : "Unread",
              active: read,
              onClick: () => r.toggle("read", s.id),
            },
            {
              key: "immersive",
              icon: Maximize2,
              label: "Focus",
              active: false,
              onClick: () => r.setImmersive(true),
            },
          ].map((a, i) => (
            <button
              key={a.key}
              type="button"
              onClick={a.onClick}
              className={clsx(
                "flex flex-1 flex-col items-center justify-center gap-1.5 transition-colors",
                i > 0 && "border-l border-rule",
                a.active ? "text-spark" : "text-ink3 active:bg-hoverc",
              )}
            >
              <a.icon size={16} strokeWidth={1.6} />
              <span className="mono text-[8.5px] tracking-[0.14em] uppercase">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
