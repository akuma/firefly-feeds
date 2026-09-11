export type Edition = {
  /** "11" — the numeral the masthead sets large. */
  day: string;
  /** "SEPTEMBER" — the label under that numeral. */
  month: string;
  /**
   * "Friday, 11 September 2026" — the running head, written out.
   *
   * Deliberately not an abbreviated or numeric form. `Ed. 11.09.2026` was both:
   * "Ed." reads as *editor* far more readily than *edition*, and a numeric date
   * beside English month names is genuinely ambiguous — 11.09 is 11 September
   * in Europe and 9 November in the US.
   */
  long: string;
};

/**
 * The masthead date. Computed per request on the server and passed down, so the
 * client never re-derives it and cannot disagree: a reader that prints a fixed
 * date while showing today's feeds is lying about what it is showing.
 */
export function editionFor(date: Date): Edition {
  const month = date.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
  const day = String(date.getDate());
  return {
    day,
    month,
    long: date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}
