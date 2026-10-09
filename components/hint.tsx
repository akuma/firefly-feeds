"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Wide enough for a sentence, narrow enough to sit over a row. */
const HINT_WIDTH = 232;
/** Roughly two lines at 12.5px, plus its padding — what the flip needs to know. */
const HINT_HEIGHT = 56;
const GAP = 8;

/**
 * A one-line explanation for a small icon.
 *
 * Shown on hover, on keyboard focus, and on a click — the last so a touch reader
 * gets it as well as a mouse. Rendered through a portal and positioned from the
 * trigger's own box, because every pane in this app scrolls: a tooltip left in
 * the flow would be clipped by the column it sits in, and one positioned against
 * the document would drift the moment the reader scrolls.
 */
export function Hint({
  label,
  name,
  children,
}: {
  label: string;
  /** The button's accessible name — the icon alone says nothing to a reader. */
  name: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const half = HINT_WIDTH / 2;
    setBox({
      // above the icon when there is room for it, below when there is not
      top: rect.top > HINT_HEIGHT + GAP ? rect.top - GAP : rect.bottom + GAP,
      left: Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // The pane scrolls under the tooltip, so it is closed rather than left
    // hanging over whatever the reader has scrolled to.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  return (
    <>
      <span
        ref={trigger}
        className="inline-flex shrink-0 items-center"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label={name}
          aria-describedby={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          // The accent, not a quiet grey: this mark means the answer is a guess,
          // which is the one thing on the row a reader should notice.
          className="flex items-center text-spark transition-opacity hover:opacity-80"
        >
          {children}
        </button>
      </span>
      {open &&
        box &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            style={{ top: box.top, left: box.left, width: HINT_WIDTH }}
            className="ff-rise pointer-events-none fixed z-[95] border border-rule bg-reader px-3 py-2 text-left text-[12.5px] leading-[1.45] tracking-normal text-ink2 normal-case shadow-[0_14px_30px_-22px_rgba(0,0,0,0.55)]"
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

/** What a low-confidence topic means, in the reader's terms rather than the model's. */
export const LOW_CONFIDENCE_HINT =
  "The classifier wasn't sure about this one, so the topic is a guess rather than " +
  "a fact. Correct it if it's wrong.";
