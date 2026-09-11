"use client";

import {
  Bookmark,
  BookmarkCheck,
  Check,
  Clock,
  ExternalLink,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { clsx } from "./clsx";
import { IconButton } from "./brand";
import { Firefly, Media, hasArt } from "./plate";
import { agoLabel } from "@/lib/reading";
import { FOLDERS } from "@/lib/sources";
import { useReader } from "@/lib/store";
import type { FeedId, FolderId, Story } from "@/lib/types";

/* --------------------------------------------------------------- header */

const SMART_HEAD: Record<string, { kicker: string; title: string }> = {
  today: { kicker: "Today", title: "Reading Stream" },
  all: { kicker: "Archive", title: "All Stories" },
  saved: { kicker: "Kept", title: "Saved" },
  later: { kicker: "Queued", title: "Later" },
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function viewHead(
  view: string,
  feedById: (id: FeedId) => { host: string; name: string } | undefined,
) {
  if (view.startsWith("folder:")) {
    const f = FOLDERS.find((x) => x.id === (view.slice(7) as FolderId));
    return { kicker: "Folder", title: f?.name ?? "" };
  }
  if (view.startsWith("feed:")) {
    const f = feedById(view.slice(5));
    return { kicker: f?.host ?? "Source", title: f?.name ?? "" };
  }
  return SMART_HEAD[view] ?? SMART_HEAD.today;
}

function StreamHeader({
  count,
  minutes,
  sources,
}: {
  count: number;
  minutes: number;
  sources: number;
}) {
  const r = useReader();
  const head = viewHead(r.view, r.feedById);
  const hours = Math.floor(minutes / 60);

  return (
    <header className="shrink-0">
      <div className="hidden h-11 items-center justify-between gap-2 pr-3 pl-5 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            icon={PanelLeft}
            label={r.navOpen ? "Hide navigation" : "Show navigation"}
            size={24}
            active={!r.navOpen}
            onClick={() => r.setNavOpen(!r.navOpen)}
          />
          <span className="mono truncate text-[9.5px] tracking-[0.18em] text-ink4 uppercase">
            {r.edition.long}
          </span>
        </div>
        {/*
         * A fallback, and shown only when it is one. These three exist because
         * collapsing the navigation takes them with it — so they belong here
         * exactly when the navigation is closed, and are duplication the rest
         * of the time. Nothing that acts on the reading pane appears in this
         * column: the reader has its own controls.
         */}
        {!r.navOpen && (
          <div className="flex items-center gap-0.5">
            <IconButton
              icon={Plus}
              label="Add a feed or site"
              size={26}
              onClick={() => r.setAddOpen(true)}
            />
            <IconButton
              icon={Search}
              label="Search (⌘K)"
              size={26}
              onClick={() => r.setSearchOpen(true)}
            />
            <IconButton
              icon={r.theme === "dark" ? Sun : Moon}
              label={r.theme === "dark" ? "Switch to light (T)" : "Switch to dark (T)"}
              size={26}
              onClick={() => r.setTheme(r.theme === "dark" ? "light" : "dark")}
            />
          </div>
        )}
      </div>

      {/* --------------------------------------------------- date block */}
      <div className="flex items-end gap-4 px-5 pt-1 pb-4 lg:gap-5 lg:pb-6">
        <div className="shrink-0 select-none">
          <div
            data-t="day"
            className="display tnum text-[46px] leading-[0.82] font-medium tracking-[-0.03em] text-ink lg:text-[64px] lg:leading-[0.8]"
          >
            {r.edition.day}
          </div>
          <div className="label mt-1.5 text-ink4 lg:mt-2.5">{r.edition.month}</div>
        </div>
        <div className="min-w-0 flex-1 pb-[3px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="label text-spark">{head.kicker}</span>
            {r.sample && (
              <span className="label bg-ink px-1.5 py-1 text-canvas">Sample edition</span>
            )}
          </div>
          <h1
            data-t="viewtitle"
            className="display mt-2 text-[25px] leading-[1.1] font-medium tracking-[-0.016em] text-ink lg:text-[30px] lg:leading-[1.06]"
          >
            {head.title}
          </h1>
          <div className="mt-3 h-px w-full bg-rule" />
          <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tracking-[0.1em] text-ink4 uppercase">
            <span className="text-ink3">{plural(count, "story", "stories")}</span>
            <span aria-hidden>·</span>
            <span>{hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`} read</span>
            <span aria-hidden>·</span>
            <span>{plural(sources, "source", "sources")}</span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------- sample edition notice */}
      {r.sample && (
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-y border-rule px-5 py-2">
          <span className="mono text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
            Invented stories, invented writers — no real sources yet
          </span>
          <button
            type="button"
            onClick={() => r.setAddOpen(true)}
            className="mono text-[9.5px] tracking-[0.14em] text-spark uppercase transition-opacity hover:opacity-70"
          >
            Add one
          </button>
        </div>
      )}

      {/* ------------------------------------------------- filter rail */}
      <div className="flex h-9 items-stretch justify-between border-y border-rule pr-4 pl-5">
        <div className="flex items-stretch gap-4">
          {(
            [
              { id: "all", label: "All" },
              { id: "unread", label: "Unread" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => r.setStreamFilter(f.id)}
              className={clsx(
                "label relative flex items-center transition-colors",
                r.streamFilter === f.id ? "text-ink" : "text-ink4 hover:text-ink2",
              )}
            >
              {f.label}
              {r.streamFilter === f.id && (
                <span className="absolute -bottom-px left-0 h-px w-full bg-spark" />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => r.markAllRead(r.filtered.map((s) => s.id))}
          className="label flex items-center text-ink4 transition-colors hover:text-ink"
        >
          Mark all read
        </button>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- pieces */

function Kicker({ s, selected }: { s: Story; selected: boolean }) {
  const r = useReader();
  const unread = !r.state.read[s.id];
  return (
    <div
      data-t="kicker"
      className="mono flex min-w-0 items-center gap-2 text-[9.5px] tracking-[0.16em] uppercase"
    >
      {unread && <Firefly size={4.5} glow={false} pulse={selected} />}
      <span
        className={clsx(
          "truncate transition-colors",
          selected ? "text-spark" : unread ? "text-ink3" : "text-ink4",
        )}
      >
        {r.feedById(s.feedId)?.name ?? ""}
      </span>
      <span className="shrink-0 text-ink4" aria-hidden>
        ·
      </span>
      <span className="shrink-0 text-ink4">{agoLabel(s.minutesAgo)}</span>
      {selected && (
        <>
          <span className="shrink-0 text-ink4" aria-hidden>
            ·
          </span>
          <span className="shrink-0 text-spark">Reading</span>
        </>
      )}
    </div>
  );
}

function Meta({ s, className }: { s: Story; className?: string }) {
  const r = useReader();
  return (
    <div
      className={clsx(
        "mono flex items-center gap-2 text-[9.5px] tracking-[0.14em] text-ink4 uppercase",
        className,
      )}
    >
      <span>{s.minutes} min read</span>
      {r.state.saved[s.id] && (
        <>
          <span aria-hidden>·</span>
          <span className="text-spark">Saved</span>
        </>
      )}
      {r.state.later[s.id] && (
        <>
          <span aria-hidden>·</span>
          <span className="text-spark">Later</span>
        </>
      )}
    </div>
  );
}

function RowActions({ s }: { s: Story }) {
  const r = useReader();
  const pinned = r.state.saved[s.id] || r.state.later[s.id];
  const canonical = r.originalUrl(s);
  const isSample = Boolean(r.feedById(s.feedId)?.sample);
  return (
    <div
      // the whole row is a click target; the controls must not fall through to it
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        "hidden shrink-0 items-center gap-0.5 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 lg:flex",
        pinned ? "opacity-100" : "opacity-0",
      )}
    >
      <IconButton
        icon={ExternalLink}
        href={canonical}
        label={isSample ? "Sample story — no original" : "Open original (O)"}
        size={22}
        iconSize={13}
        disabled={!canonical}
      />
      <IconButton
        icon={r.state.saved[s.id] ? BookmarkCheck : Bookmark}
        label={r.state.saved[s.id] ? "Remove from saved (S)" : "Save (S)"}
        size={22}
        iconSize={13}
        active={r.state.saved[s.id]}
        onClick={() => r.toggle("saved", s.id)}
      />
      <IconButton
        icon={Clock}
        label={r.state.later[s.id] ? "Remove from Later (L)" : "Read later (L)"}
        size={22}
        iconSize={13}
        active={r.state.later[s.id]}
        onClick={() => r.toggle("later", s.id)}
      />
      <IconButton
        icon={Check}
        label={r.state.read[s.id] ? "Mark unread (M)" : "Mark read (M)"}
        size={22}
        iconSize={13}
        active={r.state.read[s.id]}
        onClick={() => r.toggle("read", s.id)}
      />
    </div>
  );
}

/* ------------------------------------------------------------- the row */

function StoryRow({ s, index }: { s: Story; index: number }) {
  const r = useReader();
  const selected = r.selectedId === s.id;
  const unread = !r.state.read[s.id];
  const dim = !unread && !selected;

  const open = () => {
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    r.select(s.id);
    r.setMobileReading(true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };

  const shell = clsx(
    "group relative w-full cursor-pointer border-t border-rule text-left transition-colors duration-150",
    selected ? "bg-activec" : "hover:bg-hoverc",
  );

  const rail = (
    <span
      aria-hidden
      className={clsx(
        "pointer-events-none absolute top-0 left-0 h-full w-[2px] origin-top transition-transform duration-200",
        selected ? "scale-y-100 bg-spark" : "scale-y-0 bg-rulestrong group-hover:scale-y-100",
      )}
    />
  );

  const a11y = {
    role: "button" as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: onKey,
    "aria-current": selected ? ("true" as const) : undefined,
    style: { animationDelay: `${Math.min(index, 12) * 22}ms` },
  };

  /* ------------------------------------------------------------ feature */
  if (s.layout === "feature") {
    return (
      <article className={clsx(shell, "ff-stagger")} {...a11y}>
        {rail}
        <div className="px-5 pt-5 pb-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <Kicker s={s} selected={selected} />
            <RowActions s={s} />
          </div>
          {hasArt(s) && (
            <Media
              seed={s.plate ?? 0}
              src={s.image}
              alt={s.title}
              big
              className="aspect-[16/10] w-full"
            />
          )}
          <h2
            data-t="feature-title"
            className={clsx(
              "mt-6 text-[30px] leading-[1.09] tracking-[-0.024em]",
              dim ? "text-ink2" : "text-ink",
            )}
          >
            {s.title}
          </h2>
          {s.dek && (
            <p className="mt-3 max-w-[46ch] text-[15px] leading-[1.55] text-ink3">{s.dek}</p>
          )}
          <Meta s={s} className="mt-4" />
        </div>
      </article>
    );
  }

  /* ------------------------------------------------------------- quote */
  if (s.layout === "quote" && s.pull) {
    return (
      <article className={clsx(shell, "ff-stagger")} {...a11y}>
        {rail}
        <div className="px-5 pt-5 pb-6">
          <div className="flex items-center justify-between gap-3">
            <Kicker s={s} selected={selected} />
            <RowActions s={s} />
          </div>
          <blockquote className="mt-3.5 border-l-2 border-spark pl-4 text-[18.5px] leading-[1.36] tracking-[-0.012em] text-ink italic">
            “{s.pull}”
          </blockquote>
          <h2 className="mt-3.5 text-[15px] leading-[1.35] text-ink2">{s.title}</h2>
          <Meta s={s} className="mt-2.5" />
        </div>
      </article>
    );
  }

  /* ------------------------------------------------------------- brief */
  if (s.layout === "brief") {
    return (
      <article className={clsx(shell, "ff-stagger")} {...a11y}>
        {rail}
        <div className="flex items-baseline gap-3 px-5 py-[13px]">
          {unread && <Firefly size={4.5} glow={false} className="-translate-y-[2px]" />}
          <h2
            className={clsx(
              "max-w-[58%] min-w-0 truncate text-[15px] leading-[1.35]",
              dim ? "text-ink3" : "text-ink",
            )}
          >
            {s.title}
          </h2>
          <span
            aria-hidden
            className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted border-rulestrong"
          />
          <span className="mono shrink-0 text-[9.5px] tracking-[0.14em] text-ink4 uppercase">
            {r.feedById(s.feedId)?.name ?? ""}
          </span>
          <RowActions s={s} />
        </div>
      </article>
    );
  }

  /* ----------------------------------------------------------- compact */
  if (s.layout === "compact") {
    return (
      <article className={clsx(shell, "ff-stagger")} {...a11y}>
        {rail}
        <div className="px-5 py-[15px]">
          <div className="flex items-center justify-between gap-3">
            <Kicker s={s} selected={selected} />
            <RowActions s={s} />
          </div>
          <h2
            className={clsx(
              "mt-2 text-[17.5px] leading-[1.22] tracking-[-0.014em]",
              dim ? "text-ink2" : "text-ink",
            )}
          >
            {s.title}
          </h2>
          {s.dek && (
            <p className="mt-2 line-clamp-2 max-w-[52ch] text-[13.5px] leading-[1.5] text-ink3">
              {s.dek}
            </p>
          )}
        </div>
      </article>
    );
  }

  /* ---------------------------------------------------------- standard */
  const withPlate = hasArt(s);
  return (
    <article className={clsx(shell, "ff-stagger")} {...a11y}>
      {rail}
      <div
        className={clsx(
          "px-5 py-[16px] lg:py-[18px]",
          withPlate &&
            "grid grid-cols-[minmax(0,1fr)_72px] gap-3.5 lg:grid-cols-[minmax(0,1fr)_84px] lg:gap-4",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <Kicker s={s} selected={selected} />
            <RowActions s={s} />
          </div>
          <h2
            data-t="std-title"
            className={clsx(
              "mt-2 text-[19.5px] leading-[1.2] tracking-[-0.016em]",
              dim ? "text-ink2" : "text-ink",
            )}
          >
            {s.title}
          </h2>
          {s.dek && (
            <p className="mt-2.5 line-clamp-3 max-w-[54ch] text-[13.5px] leading-[1.55] text-ink3">
              {s.dek}
            </p>
          )}
          <Meta s={s} className="mt-3" />
        </div>
        {withPlate && (
          <Media
            seed={s.plate ?? 0}
            src={s.image}
            alt={s.title}
            className="mt-[3px] aspect-[4/3] w-full self-start"
          />
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------ container */

export function StreamColumn() {
  const r = useReader();
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = r.filtered;
  const minutes = useMemo(() => filtered.reduce((n, s) => n + s.minutes, 0), [filtered]);
  // derived, not stored: there is no reason for this to cost a render pass
  const sources = useMemo(() => new Set(filtered.map((s) => s.feedId)).size, [filtered]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-story="${r.selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [r.selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-stream">
      <StreamHeader count={filtered.length} minutes={minutes} sources={sources} />

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!r.ready ? (
          <div className="flex flex-col items-center gap-4 px-8 py-24">
            <Firefly size={6} pulse />
            <span className="label text-ink4">Opening the edition</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-24 text-center">
            <Firefly size={7} glow />
            <div className="label mt-6 text-ink3">Nothing here</div>
            <p className="mt-3 max-w-[26ch] text-[14px] leading-[1.5] text-ink4">
              {r.query
                ? "No story matches that search."
                : "Stories you keep for later will collect in this column."}
            </p>
          </div>
        ) : (
          <>
            {filtered.map((s, i) => (
              <div key={s.id} data-story={s.id}>
                <StoryRow s={s} index={i} />
                {i === 4 && filtered.length > 6 && (
                  <div className="flex items-center gap-3 border-t border-rule px-5 py-3">
                    <span className="label text-ink4">Also in this edition</span>
                    <span className="h-px flex-1 bg-rule" />
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-col items-center gap-2.5 border-t border-rule px-5 py-10">
              <Firefly size={5} glow={false} />
              <div className="label text-ink4">End of stream</div>
              <div className="mono text-[10px] tracking-[0.1em] text-ink4 uppercase">
                {plural(filtered.length, "story", "stories")} · you are up to date
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
