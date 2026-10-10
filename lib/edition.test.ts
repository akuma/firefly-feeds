import { describe, expect, it } from "vitest";
import { dayKeyIn, localZone, minutesIntoTodayIn, startOfDayIn } from "./edition";

/** An instant as `Date.UTC`, so a test says what it means in one timezone. */
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

describe("the reader's day", () => {
  it("begins at their midnight, not at UTC's and not at the device's", () => {
    // One instant, two days: 23:30 in Shanghai is still the 10th there and
    // already the 10th in Los Angeles at 08:30. Which day a story belongs to
    // is the reader's question, so it is answered in the reader's zone.
    const late = utc(2026, 10, 10, 15, 30);
    expect(dayKeyIn(late, "Asia/Shanghai")).toBe("2026-10-10");
    expect(dayKeyIn(late, "America/Los_Angeles")).toBe("2026-10-10");
    expect(startOfDayIn(late, "Asia/Shanghai")).toBe(utc(2026, 10, 9, 16));
    expect(startOfDayIn(late, "America/Los_Angeles")).toBe(utc(2026, 10, 10, 7));
  });

  it("is still a day where the clocks change", () => {
    // Europe/London springs forward at 01:00 on 29 March 2026, so that day is
    // 23 hours long and the one after it begins an hour earlier in UTC.
    const zone = "Europe/London";
    expect(startOfDayIn(utc(2026, 7, 10, 12), zone)).toBe(utc(2026, 7, 9, 23)); // BST
    expect(startOfDayIn(utc(2026, 1, 10, 12), zone)).toBe(utc(2026, 1, 10, 0)); // GMT

    // The transition day itself begins at GMT midnight — the clocks do not
    // move until one in the morning — and ends an hour short.
    expect(startOfDayIn(utc(2026, 3, 29, 12), zone)).toBe(utc(2026, 3, 29, 0));
    expect(minutesIntoTodayIn(utc(2026, 3, 29, 12), zone)).toBe(60 * 12);

    // The day after it begins on the far side of the change, which is the
    // case a single offset would get wrong.
    expect(startOfDayIn(utc(2026, 3, 30, 12), zone)).toBe(utc(2026, 3, 29, 23));
  });

  it("reaches across the date line", () => {
    // Kiritimati is UTC+14: an instant that is still yesterday in UTC is
    // already tomorrow there, and the day is still one day.
    const instant = utc(2026, 10, 10, 22);
    expect(dayKeyIn(instant, "UTC")).toBe("2026-10-10");
    expect(dayKeyIn(instant, "Pacific/Kiritimati")).toBe("2026-10-11");
    expect(startOfDayIn(instant, "Pacific/Kiritimati")).toBe(utc(2026, 10, 10, 10));
  });

  it("falls back rather than throwing on a name it cannot place", () => {
    const at = utc(2026, 10, 10, 12);
    // A reader types a zone that once worked, or one that never did. The day
    // still turns over — the boundary just lands on the device's midnight.
    expect(dayKeyIn(at, "Mars/Olympus")).toBe(dayKeyIn(at, localZone()));
    expect(startOfDayIn(at, "Mars/Olympus")).toBe(startOfDayIn(at, localZone()));
    expect(minutesIntoTodayIn(at, "Mars/Olympus")).toBe(minutesIntoTodayIn(at, localZone()));
  });

  it("grows through the day and starts again at midnight", () => {
    const zone = "Asia/Shanghai";
    // 15:59 UTC is 23:59 in Shanghai; a minute later is a new day.
    expect(minutesIntoTodayIn(utc(2026, 10, 10, 15, 59), zone)).toBe(60 * 24 - 1);
    expect(minutesIntoTodayIn(utc(2026, 10, 10, 16), zone)).toBe(0);
  });
});
