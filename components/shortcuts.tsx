"use client";

import { ExternalLink, MousePointerClick, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { clsx } from "./clsx";
import { Firefly } from "./plate";
import { useReader } from "@/lib/store";

/**
 * The key set, presented as a printed legend rather than a settings dialog —
 * a printer's key is the right metaphor for a product whose whole visual
 * language is hairlines and mono metadata.
 *
 * Kept in one place, next to the reader, so it cannot drift from
 * `useKeyboardShortcuts` without someone noticing.
 */

type Entry = {
  /** Rendered as key caps, left to right. `null` means "a control on screen". */
  caps: (string | "external" | "pointer" | "plus")[];
  label: string;
  note?: string;
};

const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "Reading",
    entries: [
      { caps: ["J"], label: "Next story" },
      { caps: ["K"], label: "Previous story" },
      { caps: ["↑", "↓"], label: "Scroll the article" },
      { caps: ["O"], label: "Open the original in a new tab" },
      { caps: ["M"], label: "Mark read, or unread" },
      { caps: ["S"], label: "Save" },
      { caps: ["L"], label: "Queue for later" },
    ],
  },
  {
    title: "The edition",
    entries: [
      { caps: ["/"], label: "Search every story", note: "or ⌘K" },
      { caps: ["T"], label: "Light or dark" },
      { caps: ["[", "]"], label: "Smaller, or larger, reading text" },
      { caps: ["F"], label: "Immersive reading" },
      { caps: ["?"], label: "This legend" },
      { caps: ["Esc"], label: "Close search, this legend, or immersive mode" },
    ],
  },
  {
    title: "Pointer",
    entries: [
      { caps: ["pointer"], label: "Click a story to read it in this column" },
      { caps: ["external"], label: "Open the original without leaving the stream" },
      { caps: ["plus"], label: "Subscribe to a feed or a site" },
    ],
  },
];

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center border border-rule bg-canvas px-1.5 text-[10px] leading-none text-ink2">
      {children}
    </kbd>
  );
}

function renderCap(mark: Entry["caps"][number], index: number) {
  switch (mark) {
    case "external":
      return (
        <Cap key={index}>
          <ExternalLink size={11} strokeWidth={1.7} />
        </Cap>
      );
    case "pointer":
      return (
        <Cap key={index}>
          <MousePointerClick size={11} strokeWidth={1.7} />
        </Cap>
      );
    case "plus":
      return (
        <Cap key={index}>
          <Plus size={11} strokeWidth={2} />
        </Cap>
      );
    default:
      return <Cap key={index}>{mark}</Cap>;
  }
}

function renderGroup(group: (typeof GROUPS)[number]) {
  return (
    <section key={group.title} className="mt-7">
      <h3 className="label text-ink4">{group.title}</h3>
      <dl className="mt-3 border-t border-rule">
        {group.entries.map((entry) => (
          <div
            key={entry.label}
            className="flex items-baseline gap-4 border-b border-rulesoft py-2 last:border-0"
          >
            <dt className="flex w-[58px] shrink-0 items-center gap-1">
              {entry.caps.map(renderCap)}
            </dt>
            <dd
              className={clsx(
                "min-w-0 flex-1 text-[15px] leading-[1.35]",
                entry.caps[0] === "pointer" || entry.caps[0] === "external"
                  ? "text-ink3"
                  : "text-ink2",
              )}
            >
              {entry.label}
            </dd>
            {entry.note && (
              <span className="mono shrink-0 text-[9px] tracking-[0.14em] text-ink4 uppercase">
                {entry.note}
              </span>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Shortcuts() {
  const r = useReader();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[7vh] sm:pt-[10vh]">
      <button
        type="button"
        aria-label="Close the key legend"
        onClick={() => r.setShortcutsOpen(false)}
        className="absolute inset-0 cursor-default"
        style={{ background: "color-mix(in oklab, var(--c-canvas) 94%, transparent)" }}
      />

      <div className="ff-rise relative flex max-h-[86vh] w-full max-w-[720px] flex-col border border-rule bg-reader shadow-[0_30px_60px_-40px_rgba(0,0,0,0.5)]">
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-6 py-3">
          <span className="label flex items-center gap-2 text-ink4">
            <Firefly size={5} glow={false} />
            Key
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={() => r.setShortcutsOpen(false)}
            className="mono flex items-center gap-2 text-[9px] tracking-[0.18em] text-ink4 uppercase transition-colors hover:text-ink"
          >
            <Cap>Esc</Cap>
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-7">
          <h2 className="display text-[25px] leading-[1.12] font-medium tracking-[-0.016em] text-ink">
            Keyboard
          </h2>
          <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.5] text-ink3">
            Everything the reader does, without reaching for the pointer.
          </p>

          {/*
           * Two columns, the way a printer's key is set — the whole set is
           * visible at once instead of scrolling, which is the entire point of
           * a reference.
           */}
          <div className="grid gap-x-9 sm:grid-cols-2">
            <div>{renderGroup(GROUPS[0])}</div>
            <div>
              {renderGroup(GROUPS[1])}
              {renderGroup(GROUPS[2])}
            </div>
          </div>

          <p className="mono mt-7 border-t border-rule pt-4 text-[9.5px] leading-[1.8] tracking-[0.12em] text-ink4 uppercase">
            Nothing here needs a modifier except search. The reader takes no keystroke that a screen
            reader or a browser already uses.
          </p>
        </div>
      </div>
    </div>
  );
}
