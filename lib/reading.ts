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
 * distance to travel is noise, and it would also make the scroll-to-end rule
 * fire on sight.
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
 * A story shorter than this never counts as "read" just for being on screen.
 * At the default step a line is ~34px, so this is roughly seven lines below the
 * fold — the point at which reaching the end means something happened.
 */
const MEANINGFUL_SCROLL = 240;

/** Sub-pixel layout means scrollTop rarely lands exactly on the maximum. */
const END_TOLERANCE = 24;

/**
 * Read state has two triggers, and this is the second one.
 *
 * Selecting a story marks it read immediately — that is what makes the queue
 * clear as you go. But a story can also be *shown* rather than chosen: on first
 * load, after a view switch, after a search. Those are displayed in the reading
 * pane without ever being selected, so before this they could be read in full,
 * top to bottom, and still sit in the unread count. That is the one outcome a
 * reader will not forgive.
 *
 * So: reaching the end also counts. Not as the primary trigger — a reader whose
 * "read" means "finished" cannot clear a queue of things it has decided against
 * — but as a floor for stories nobody clicked.
 *
 * A story that fits the pane is exempt. There is no end to reach, and being
 * displayed is not the same as being read.
 */
export function reachedEnd(view: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  const scrollable = view.scrollHeight - view.clientHeight;
  if (scrollable < MEANINGFUL_SCROLL) return false;
  return view.scrollTop >= scrollable - END_TOLERANCE;
}
