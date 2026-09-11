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
