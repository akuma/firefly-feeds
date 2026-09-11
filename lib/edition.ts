export type Edition = {
  /** "THURSDAY" */
  weekday: string;
  /** "SEPTEMBER" */
  month: string;
  /** "11" */
  day: string;
  year: string;
  /** "Thursday, 11 September 2025" */
  long: string;
  /** "11.09.2025" */
  slug: string;
};

/**
 * The masthead date. Computed per request on the server and passed down, so the
 * client never re-derives it and cannot disagree: a reader that prints a fixed
 * date while showing today's feeds is lying about what it is showing.
 */
const pad = (value: number) => String(value).padStart(2, "0");

export function editionFor(date: Date): Edition {
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase();
  const month = date.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
  const day = String(date.getDate());
  const year = String(date.getFullYear());
  return {
    weekday,
    month,
    day,
    year,
    long: date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    slug: `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${year}`,
  };
}
