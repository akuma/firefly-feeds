"use client";

import { CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "./clsx";
import { Firefly } from "./plate";
import { agoLabel } from "@/lib/articles";

import { useReader } from "@/lib/store";

export function SearchPalette() {
  const r = useReader();
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = r.query.trim().toLowerCase();
    if (!q) return r.stories.slice(0, 7);
    return r.stories
      .filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.dek.toLowerCase().includes(q) ||
          (s.byline ?? "").toLowerCase().includes(q) ||
          (r.feedById(s.feedId)?.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 24);
  }, [r.query, r.stories, r.feedById]);

  useEffect(() => {
    if (r.searchOpen) {
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [r.searchOpen]);

  useEffect(() => setCursor(0), [r.query]);

  if (!r.searchOpen) return null;

  const choose = (id: string) => {
    r.select(id);
    r.setSearchOpen(false);
    r.setMobileReading(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      choose(results[cursor].id);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center px-4 pt-[9vh] sm:pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={() => r.setSearchOpen(false)}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in oklab, var(--c-canvas) 94%, transparent)" }}
      />

      <div className="ff-rise relative flex w-full max-w-[660px] flex-col">
        <div className="flex items-center gap-3.5 border-b border-rulestrong pb-3.5">
          <Search size={17} strokeWidth={1.6} className="shrink-0 text-spark" />
          <input
            ref={inputRef}
            value={r.query}
            onChange={(e) => r.setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search every story, source, author…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[21px] leading-[1.3] tracking-[-0.014em] text-ink outline-none placeholder:text-ink4 lg:text-[24px]"
          />
          <button
            type="button"
            onClick={() => r.setSearchOpen(false)}
            className="mono shrink-0 text-[9px] uppercase tracking-[0.18em] text-ink4 transition-colors hover:text-ink"
          >
            Esc
          </button>
        </div>

        <div className="mono flex items-center justify-between py-3 text-[9.5px] uppercase tracking-[0.16em] text-ink4">
          <span>
            {r.query.trim()
              ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
              : "Recently published"}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <CornerDownLeft size={10} strokeWidth={1.6} /> Open
            </span>
            <span>↑↓ Move</span>
          </span>
        </div>

        <div className="max-h-[54vh] overflow-y-auto overscroll-contain border-t border-rule">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16">
              <Firefly size={6} glow />
              <p className="text-[15px] text-ink4">Nothing found for “{r.query}”</p>
            </div>
          ) : (
            results.map((s, i) => {
              const feed = r.feedById(s.feedId);
              if (!feed) return null;
              const unread = !r.state.read[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(s.id)}
                  className={clsx(
                    "group relative flex w-full items-center gap-3.5 border-b border-rule py-3 pl-4 pr-3 text-left transition-colors",
                    i === cursor ? "bg-activec" : "hover:bg-hoverc",
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      "absolute left-0 top-0 h-full w-[2px] transition-colors",
                      i === cursor ? "bg-spark" : "bg-transparent",
                    )}
                  />
                  <span className="flex w-[7px] shrink-0 justify-start">
                    {unread && <Firefly size={4.5} glow={false} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        "block truncate text-[16.5px] leading-[1.28] tracking-[-0.012em]",
                        unread ? "text-ink" : "text-ink3",
                      )}
                    >
                      {s.title}
                    </span>
                    <span className="mono mt-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.15em] text-ink4">
                      <span>{feed.name}</span>
                      <span aria-hidden>·</span>
                      <span>{agoLabel(s.minutesAgo)}</span>
                      <span aria-hidden>·</span>
                      <span>{s.minutes} min</span>
                    </span>
                  </span>
                  {r.state.saved[s.id] && (
                    <span className="label shrink-0 text-spark">Saved</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
