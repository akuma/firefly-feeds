"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  Maximize2,
  Minimize2,
  Moon,
  Sun,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "./clsx";
import { IconButton, Rule } from "./brand";
import { Firefly, Media, hasArt } from "./plate";
import { EDITION, FOLDER_BY_ID } from "@/lib/feeds";
import { FONT_SIZES, useReader, type ReaderFont } from "@/lib/store";
import type { Block } from "@/lib/types";

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
              "flex items-end justify-center pb-1.5 pt-2 transition-colors",
              r.font === i ? "bg-ink text-canvas" : "text-ink3 ring-1 ring-rule ring-inset hover:bg-hoverc",
            )}
            style={{ height: 38 }}
            aria-label={`Text size ${i + 1}`}
          >
            <span style={{ fontSize: 11 + i * 2.5, lineHeight: 1 }}>A</span>
          </button>
        ))}
      </div>
      <div className="mt-3.5 h-px w-full bg-rule" />
      <div className="mono mt-3 flex items-center justify-between text-[9.5px] uppercase tracking-[0.14em] text-ink4">
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
                className="relative before:absolute before:-left-5 before:top-[0.7em] before:h-px before:w-3 before:bg-spark before:content-['']"
              >
                {b.text}
              </h2>
            );

          case "quote":
            return (
              <blockquote key={i} className="my-[2.2em] border-l-2 border-spark pl-5">
                <p className="text-[1.16em] italic leading-[1.45] text-ink">“{b.text}”</p>
                {b.cite && (
                  <footer className="mono mt-3 text-[10px] uppercase tracking-[0.14em] text-ink4">
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
                <Media seed={b.seed} src={b.src} alt={b.caption} big className="aspect-[16/9] w-full" />
                <figcaption className="mono mt-3 max-w-[62ch] text-[10px] uppercase leading-[1.75] tracking-[0.08em] text-ink4">
                  {b.caption}
                </figcaption>
              </figure>
            );

          case "note":
            return (
              <aside key={i} className="my-[2.3em] border-y border-rule py-5">
                <div className="label mb-3 flex items-center gap-2 text-spark">
                  <Firefly size={4.5} glow={false} />
                  Note
                </div>
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

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 8 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    setProgress(0);
    setFontOpen(false);
  }, [r.selectedId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll, r.selectedId, r.immersive]);

  if (!r.ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-reader">
        <Firefly size={6} pulse />
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
  const folder = FOLDER_BY_ID[feed.folder];
  const saved = r.state.saved[s.id];
  const later = r.state.later[s.id];
  const read = r.state.read[s.id];

  const idx = r.filtered.findIndex((x) => x.id === s.id);
  const next = idx >= 0 ? r.filtered[idx + 1] : undefined;
  const pct = Math.round(progress * 100);

  /* ---------------------------------------------------------- toolbar */
  const canonical = r.originalUrl(s);

  const actions = (
    <div className="flex items-center gap-0.5">
      <IconButton
        icon={ExternalLink}
        href={canonical}
        label="Open original (O)"
        disabled={!canonical}
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
      <div className="pointer-events-none absolute left-0 top-0 z-30 h-[2px] w-full bg-transparent">
        <div
          className="h-full bg-spark transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* ----------------------------------------------- desktop toolbar */}
      {!r.immersive && (
        <div className="hidden h-12 shrink-0 items-center gap-3 border-b border-rule pl-6 pr-2.5 lg:flex">
          <div className="mono flex min-w-0 items-center gap-2 text-[9.5px] uppercase tracking-[0.16em]">
            <Firefly size={4.5} glow={false} />
            <span className="truncate text-ink3">{feed.name}</span>
            <span className="text-ink4" aria-hidden>
              ·
            </span>
            <span className="shrink-0 text-ink4">{folder.name}</span>
          </div>
          <div className="min-w-4 flex-1" />
          <span className="mono shrink-0 text-[9.5px] uppercase tracking-[0.14em] text-ink4 tnum">
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
            <div className="mono truncate text-[9.5px] uppercase tracking-[0.16em] text-ink3">
              {feed.name}
            </div>
            <div className="mono truncate text-[9px] uppercase tracking-[0.14em] text-ink4 tnum">
              {s.minutes} min · {pct}%
            </div>
          </div>
          {actions}
        </div>
      )}

      {/* ------------------------------------------------- immersive bar */}
      {r.immersive && (
        <div className="absolute right-0 top-0 z-30 flex items-center gap-1 p-2 opacity-25 transition-opacity duration-200 hover:opacity-100">
          {actions}
        </div>
      )}

      {/* --------------------------------------------- text size popover */}
      {fontOpen && (
        <div
          className="absolute right-3 z-40"
          style={{ top: r.immersive ? 46 : 52 }}
        >
          <FontMenu onClose={() => setFontOpen(false)} />
        </div>
      )}

      {/* ------------------------------------------------------ article */}
      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <article
          key={s.id}
          className={clsx(
            "ff-rise mx-auto w-full",
            r.immersive ? "max-w-[724px] px-6 pb-28 pt-16 lg:px-11 lg:pt-24" : "max-w-[680px] px-6 pb-24 pt-9 lg:px-10 lg:pt-12",
          )}
        >
          <div className="label flex flex-wrap items-center gap-2.5 text-spark">
            <span>{feed.name}</span>
            <span className="h-px w-4 bg-spark opacity-60" aria-hidden />
            <span className="text-ink4">{folder.name}</span>
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

          <p className="mt-5 max-w-[54ch] text-[17px] italic leading-[1.5] tracking-[-0.006em] text-ink3">
            {s.dek}
          </p>

          <div className="mt-7 h-px w-full bg-rule" />

          <div className="mono mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[9.5px] uppercase tracking-[0.15em] text-ink4">
            <span>By {s.byline ?? feed.name}</span>
            <span className="tnum">
              {s.publishedLabel ?? EDITION.long} · {s.minutes} min read
            </span>
          </div>

          {hasArt(s) && (
            <figure className="mt-8">
              <Media
                seed={s.plate ?? 0}
                src={s.image}
                alt={s.title}
                big
                className="aspect-[16/9] w-full"
              />
              <figcaption className="mono mt-2.5 text-[9.5px] uppercase tracking-[0.14em] text-ink4">
                {s.image ? feed.name : "Illustration · Firefly Studio"}
              </figcaption>
            </figure>
          )}

          <div className="mt-9" data-t="reader-body">
            <Blocks blocks={s.body} />
          </div>

          {/* ------------------------------------------------------ closer */}
          <div className="mt-16 flex flex-col items-center gap-3">
            <Firefly size={6} glow />
            <span className="label text-ink4">
              {s.truncated ? "Excerpt" : "End of story"}
            </span>
            {s.truncated && (
              <a
                href={canonical}
                target="_blank"
                rel="noopener noreferrer"
                className="mono mt-1 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.14em] text-ink3 transition-colors hover:text-spark"
              >
                Continues at {hostOf(canonical ?? feed.host)}
                <ArrowUpRight size={10} strokeWidth={1.7} />
              </a>
            )}
          </div>

          <div className="mt-14">
            <Rule />
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
                <div className="mono mt-2.5 flex flex-wrap items-center gap-2 text-[9.5px] uppercase tracking-[0.14em] text-ink4">
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
              <span className="mono text-[8.5px] uppercase tracking-[0.14em]">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
