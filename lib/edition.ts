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
/* ------------------------------------------------------------ the day */

/**
 * The zone a reader's days are counted in.
 *
 * "Today" is a property of the reader, not of the machine they happen to be
 * holding: a device set to follow the local time zone moves its midnight when
 * its owner gets on a plane, and a boundary that moves is a boundary a story
 * can fall on both sides of. So the zone is remembered — this default is what
 * fills it in on first run — and everything about a day is computed in it:
 * where the day begins, and which day a moment belongs to.
 */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * A zone this runtime understands, or the device's own.
 *
 * A reader types this, and a name that once worked can outlive the browser
 * that understood it. An unreadable zone falls back rather than throwing:
 * the day still turns over, just somewhere less surprising than a crash.
 */
function usableZone(zone: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return localZone();
  }
}

/** The zone's own wall clock, read off an instant. */
function zoneOffsetMs(at: number, zone: string): number {
  zone = usableZone(zone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return wall - at;
}

/**
 * The instant the day began in `zone` — its midnight, as a moment in UTC.
 *
 * The offset is applied twice because midnight itself can sit on the far side
 * of a daylight-saving change: the first pass guesses from the offset at the
 * naive instant, the second corrects it.
 */
export function startOfDayIn(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: usableZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"));
  return wall - zoneOffsetMs(wall - zoneOffsetMs(wall, zone), zone);
}

/** `YYYY-MM-DD` of a moment, in `zone`. */
export function dayKeyIn(at: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: usableZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/**
 * How far back "today" reaches, in minutes: to that zone's midnight.
 *
 * This is what makes a day a day. A window of the last twenty-four hours looks
 * the same at ten in the morning and is not: it carries yesterday's stories,
 * so yesterday's Today and today's Today overlap. Reaching to midnight instead
 * means a story is in exactly one day's list, which is also what lets one
 * day's briefing be different from the next without excluding anything by
 * hand.
 */
export function minutesIntoTodayIn(at: number, zone: string): number {
  return Math.max(0, Math.round((at - startOfDayIn(at, zone)) / 60_000));
}

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
