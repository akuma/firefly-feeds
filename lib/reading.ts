import type { Block } from "./types";

/**
 * Time and reading-time helpers. Deliberately separate from any content: the
 * sample edition can be deleted wholesale without touching these.
 */

const DAY = 60 * 24;

export function agoLabel(minutesAgo: number): string {
  if (minutesAgo < 60) {
    const m = Math.max(1, Math.round(minutesAgo));
    return `${m} min ago`;
  }
  if (minutesAgo < DAY) {
    const h = Math.round(minutesAgo / 60);
    return `${h} ${h === 1 ? "hr" : "hrs"} ago`;
  }
  const d = Math.round(minutesAgo / DAY);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 365) {
    const w = Math.round(d / 7);
    return `${w} ${w === 1 ? "week" : "weeks"} ago`;
  }
  const y = Math.floor(d / 365);
  return `${y} ${y === 1 ? "year" : "years"} ago`;
}

/** Reading time derived from the actual body, so the two never disagree. */
export function readingTime(body: Block[]): number {
  const words = body
    .map((b) => {
      switch (b.kind) {
        case "p":
        case "h2":
        case "quote":
        case "note":
          return b.text.split(/\s+/).length;
        case "list":
          return b.items.join(" ").split(/\s+/).length;
        case "code":
          return Math.round(b.text.split(/\s+/).length * 0.4);
        default:
          return 0;
      }
    })
    .reduce((a, b) => a + b, 0);
  return Math.max(1, Math.round(words / 225));
}

/* -------------------------------------------------------------- articles */

/* --------------------------------------------------------------- read state */

/**
 * How far through the story the reader is, 0 to 1.
 *
 * Returns 0 when the story fits the pane: a progress bar on something with no
 * distance to travel is noise, and it would also make the end look reached the
 * moment the story appeared.
 */
export function progressFor(view: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): number {
  const scrollable = view.scrollHeight - view.clientHeight;
  if (scrollable <= 8) return 0;
  return Math.min(1, Math.max(0, view.scrollTop / scrollable));
}

/**
 * A story has to be at least this much taller than the pane before "I scrolled
 * to the end of it" means anything. At the default step a line is ~34px, so
 * this is roughly seven lines below the fold.
 */
const MEANINGFUL_SCROLL = 240;

/** Sub-pixel layout means scrollTop rarely lands exactly on the maximum. */
const END_TOLERANCE = 24;

/**
 * How long the end of a short story must be on screen before it counts.
 *
 * This is the whole difficulty with read-on-reach-the-end: plenty of feeds
 * publish entries that fit on one screen — measured on Kottke, ten of the
 * twelve most recent. Their end is on screen the instant they are displayed,
 * so "the end is visible" cannot be the evidence, or flipping through a column
 * would consume everything in it. Dwelling is the evidence.
 */
export const DWELL_MS = 2000;

export type ReadSignal =
  /** The reader scrolled to the end: credit it now. */
  | "now"
  /** Short enough to fit, so wait for the reader to actually stay on it. */
  | "dwell"
  /** Not read. */
  | "none";

/**
 * The single automatic trigger for read state.
 *
 * Two cases, because there are two kinds of evidence:
 *
 *   - **A story you had to scroll.** Arriving at the end is the evidence, so it
 *     counts immediately. Waiting would lose the credit when someone reaches
 *     the bottom and moves on.
 *   - **A story that fits the pane.** Its end is on screen from the moment it
 *     is shown, which is not evidence of anything, so it counts once the reader
 *     has stayed with it.
 *
 * Selection deliberately plays no part. Clicking a story is not reading it, and
 * a reader that treats the two as the same quietly loses things you only meant
 * to glance at.
 */
export function readSignal(view: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ReadSignal {
  const scrollable = view.scrollHeight - view.clientHeight;
  if (scrollable < MEANINGFUL_SCROLL) return "dwell";
  return view.scrollTop >= scrollable - END_TOLERANCE ? "now" : "none";
}
