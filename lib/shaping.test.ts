import { describe, expect, it } from "vitest";
import { SEED_STORIES, agoLabel, readingTime } from "./articles";
import { FEED_BY_ID, SEED_FEEDS } from "./feeds";
import { feedFromSource, formatPublished, readingFlags, storyFromArticle } from "./shaping";
import type { ArticleRecord, SourceRecord } from "./storage/types";

describe("agoLabel", () => {
  it("escalates through minutes, hours, days, weeks and years", () => {
    expect(agoLabel(12)).toBe("12 min ago");
    expect(agoLabel(59)).toBe("59 min ago");
    expect(agoLabel(60)).toBe("1 hr ago");
    expect(agoLabel(128)).toBe("2 hrs ago");
    expect(agoLabel(60 * 24)).toBe("yesterday");
    expect(agoLabel(60 * 24 * 3)).toBe("3 days ago");
    expect(agoLabel(60 * 24 * 14)).toBe("2 weeks ago");
    expect(agoLabel(60 * 24 * 400)).toBe("1 year ago");
    expect(agoLabel(60 * 24 * 800)).toBe("2 years ago");
  });

  it("never says '0 min ago' for a future or identical timestamp", () => {
    expect(agoLabel(0)).toBe("1 min ago");
    expect(agoLabel(-5)).toBe("1 min ago");
  });
});

describe("readingTime", () => {
  it("derives minutes from the body rather than trusting the feed", () => {
    expect(readingTime([{ kind: "p", text: "one two three" }])).toBe(1);
    const long = [{ kind: "p" as const, text: "word ".repeat(450) }];
    expect(readingTime(long)).toBe(2);
  });

  it("counts a code block as slower to read than the same word count of prose", () => {
    const words = "const x = 1; ".repeat(400);
    const prose = readingTime([{ kind: "p", text: words }]);
    const code = readingTime([{ kind: "code", text: words }]);
    expect(code).toBeLessThan(prose);
    expect(code).toBeGreaterThan(0);
  });
});

describe("seeded edition", () => {
  it("has a reading time and a resolvable feed for every story", () => {
    for (const story of SEED_STORIES) {
      expect(story.minutes).toBeGreaterThan(0);
      expect(FEED_BY_ID[story.feedId], `missing feed for ${story.id}`).toBeDefined();
    }
  });

  it("ships a real site URL on every feed, so 'open original' always has a target", () => {
    for (const feed of SEED_FEEDS) {
      expect(feed.siteUrl, `missing siteUrl on ${feed.id}`).toMatch(/^https:\/\//);
    }
  });

  it("keeps story ids unique — they are the identity used by reading state", () => {
    const ids = SEED_STORIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates every story at or after the edition", () => {
    for (const story of SEED_STORIES) {
      expect(story.minutesAgo).toBeGreaterThan(0);
    }
  });
});

describe("readingFlags", () => {
  it("flattens records into the shape the components consume", () => {
    const flags = readingFlags([
      { id: "a", read: true, updatedAt: 1 },
      { id: "b", saved: true, updatedAt: 1 },
      { id: "c", later: true, updatedAt: 1 },
      { id: "d", read: true, saved: true, later: true, updatedAt: 1 },
    ]);
    expect(flags.read).toEqual({ a: true, d: true });
    expect(flags.saved).toEqual({ b: true, d: true });
    expect(flags.later).toEqual({ c: true, d: true });
  });

  it("omits falsy flags rather than storing explicit false", () => {
    expect(readingFlags([{ id: "a", read: false, updatedAt: 1 }]).read).toEqual({});
  });
});

describe("storyFromArticle", () => {
  const article: ArticleRecord = {
    id: "s1~a",
    sourceId: "s1",
    title: "A fetched story",
    link: "https://example.com/a",
    author: "Ada",
    publishedAt: 0,
    fetchedAt: 0,
    summary: "Standfirst",
    body: [{ kind: "p", text: "Body" }],
    image: "https://example.com/a.jpg",
    minutes: 4,
    layout: "standard",
  };

  it("converts a live record into a story with a relative age", () => {
    const now = 60 * 60 * 1000;
    const story = storyFromArticle(article, now);
    expect(story).toMatchObject({
      id: "s1~a",
      feedId: "s1",
      minutesAgo: 60,
      live: true,
      link: "https://example.com/a",
      image: "https://example.com/a.jpg",
    });
    expect(story.publishedLabel).toBeTruthy();
  });

  it("falls back to a generated plate when the feed supplied no image", () => {
    const story = storyFromArticle({ ...article, image: undefined }, Date.now());
    expect(story.image).toBeUndefined();
    expect(story.plate).toBeGreaterThanOrEqual(0);
    expect(story.plate).toBeLessThan(8);
  });

  it("gives the same article the same plate seed every time", () => {
    const a = storyFromArticle({ ...article, image: undefined }, 1);
    const b = storyFromArticle({ ...article, image: undefined }, 999);
    expect(a.plate).toBe(b.plate);
  });
});

describe("feedFromSource", () => {
  const source: SourceRecord = {
    id: "s1",
    url: "https://example.com/feed.xml",
    siteUrl: "https://example.com",
    title: "Example Weekly",
    host: "example.com",
    folder: "design",
    addedAt: 0,
    fetchedAt: 0,
    updatedAt: 0,
  };

  it("produces a feed the navigation can render", () => {
    expect(feedFromSource(source)).toMatchObject({
      id: "s1",
      name: "Example Weekly",
      host: "example.com",
      folder: "design",
      subscribed: true,
      mark: "EW",
    });
  });
});

describe("formatPublished", () => {
  it("uses an unambiguous day-month-year order", () => {
    expect(formatPublished(Date.parse("2025-09-11T12:00:00Z"))).toMatch(/11 September 2025/);
  });
});
