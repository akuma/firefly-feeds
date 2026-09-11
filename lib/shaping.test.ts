import { describe, expect, it } from "vitest";
import { agoLabel, progressFor, readSignal, readingTime } from "./reading";
import { FOLDERS, SUGGESTED_SOURCES } from "./sources";
import { SAMPLE_FEED_BY_ID, SAMPLE_FEEDS, SAMPLE_STORIES } from "./sample";
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

describe("progressFor", () => {
  const pane = 900;

  it("measures the distance travelled through a story", () => {
    expect(progressFor({ scrollTop: 0, scrollHeight: 5000, clientHeight: pane })).toBe(0);
    expect(progressFor({ scrollTop: 2050, scrollHeight: 5000, clientHeight: pane })).toBeCloseTo(
      0.5,
    );
    expect(progressFor({ scrollTop: 4100, scrollHeight: 5000, clientHeight: pane })).toBe(1);
  });

  it("stays inside 0 and 1 even if the browser overshoots", () => {
    expect(progressFor({ scrollTop: -40, scrollHeight: 5000, clientHeight: pane })).toBe(0);
    expect(progressFor({ scrollTop: 9999, scrollHeight: 5000, clientHeight: pane })).toBe(1);
  });

  it("reports nothing for a story with no distance to travel", () => {
    // a progress bar on a story that fits the pane would be noise, and it would
    // also make the scroll-to-end rule fire the moment the story appeared
    expect(progressFor({ scrollTop: 0, scrollHeight: 700, clientHeight: pane })).toBe(0);
    expect(progressFor({ scrollTop: 0, scrollHeight: pane, clientHeight: pane })).toBe(0);
  });
});

describe("readSignal", () => {
  const pane = 900;

  it("credits immediately once the reader has scrolled to the end", () => {
    expect(readSignal({ scrollTop: 4095, scrollHeight: 5000, clientHeight: pane })).toBe("now");
    expect(readSignal({ scrollTop: 4100, scrollHeight: 5000, clientHeight: pane })).toBe("now");
  });

  it("says nothing about the middle of a story", () => {
    expect(readSignal({ scrollTop: 0, scrollHeight: 5000, clientHeight: pane })).toBe("none");
    expect(readSignal({ scrollTop: 2000, scrollHeight: 5000, clientHeight: pane })).toBe("none");
    // near the end is not the end
    expect(readSignal({ scrollTop: 3900, scrollHeight: 5000, clientHeight: pane })).toBe("none");
  });

  it("asks for a dwell when the story fits the pane", () => {
    // Its end is on screen the instant it appears, so being on screen cannot be
    // the evidence — otherwise flipping through a column would consume it. Ten
    // of Kottke's twelve most recent entries fit, so this is the common case,
    // not an edge one.
    expect(readSignal({ scrollTop: 0, scrollHeight: 700, clientHeight: pane })).toBe("dwell");
    expect(readSignal({ scrollTop: 0, scrollHeight: pane, clientHeight: pane })).toBe("dwell");
    expect(readSignal({ scrollTop: 100, scrollHeight: pane + 200, clientHeight: pane })).toBe(
      "dwell",
    );
  });
});

describe("readingTime", () => {
  it("derives minutes from the body rather than trusting the feed", () => {
    expect(readingTime([{ kind: "p", text: "one two three" }])).toBe(1);
    const long = [{ kind: "p" as const, text: "word ".repeat(450) }];
    expect(readingTime(long)).toBe(2);
  });

  it("counts CJK by character, not by whitespace", () => {
    // a Chinese article has no spaces, so counting words makes the whole thing
    // one "word" and reports a minute for what is really five
    const chinese = "科技爱好者周刊每周分享值得阅读的科技内容".repeat(120);
    expect(chinese.length).toBe(2400);
    // ~400 characters a minute, so six, not the one that whitespace-counting gave
    const minutes = readingTime([{ kind: "p", text: chinese }]);
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(7);
  });

  it("handles mixed script in one body", () => {
    const mixed = "这是一个中文段落，包含一些 English words mixed in.".repeat(40);
    const minutes = readingTime([{ kind: "p", text: mixed }]);
    expect(minutes).toBeGreaterThan(1);
  });

  it("counts a code block as slower to read than the same word count of prose", () => {
    const words = "const x = 1; ".repeat(400);
    const prose = readingTime([{ kind: "p", text: words }]);
    const code = readingTime([{ kind: "code", text: words }]);
    expect(code).toBeLessThan(prose);
    expect(code).toBeGreaterThan(0);
  });
});

describe("the sample edition", () => {
  it("has a reading time and a resolvable feed for every story", () => {
    for (const story of SAMPLE_STORIES) {
      expect(story.minutes).toBeGreaterThan(0);
      expect(SAMPLE_FEED_BY_ID.get(story.feedId), `missing feed for ${story.id}`).toBeDefined();
    }
  });

  it("is the only thing that carries generated artwork", () => {
    // no sample story claims a photograph...
    for (const story of SAMPLE_STORIES) {
      expect(story.image, `${story.id} should not claim a photograph`).toBeUndefined();
    }
    // ...and most of them carry a generated plate (the pull-quote layout does not)
    const withPlates = SAMPLE_STORIES.filter((story) => typeof story.plate === "number");
    expect(withPlates.length).toBeGreaterThan(5);
    expect(withPlates.length).toBeLessThan(SAMPLE_STORIES.length);
  });

  it("is entirely invented: reserved hosts and no outbound URL anywhere", () => {
    for (const feed of SAMPLE_FEEDS) {
      // RFC 2606 reserves .example, so none of these can resolve to a real site
      expect(feed.host, `${feed.id} is not on a reserved host`).toMatch(/\.example$/);
      expect(feed.sample).toBe(true);
      // no siteUrl means `originalUrl` has nothing to fall back to
      expect(feed.siteUrl, `${feed.id} should not point anywhere`).toBeUndefined();
    }
  });

  it("names no real publication or writer", () => {
    const realNames = [
      "Kottke",
      "Willison",
      "Brach",
      "Thompson",
      "Sloan",
      "Stratechery",
      "Dense Discovery",
      "Aeon",
      "The Verge",
      "Creative Boom",
    ];
    const corpus = JSON.stringify(SAMPLE_STORIES) + JSON.stringify(SAMPLE_FEEDS);
    for (const name of realNames) {
      expect(corpus, `sample content mentions ${name}`).not.toContain(name);
    }
  });

  it("keeps story ids unique — they are the identity used by reading state", () => {
    const ids = SAMPLE_STORIES.map((story) => story.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dates every story at or after the edition", () => {
    for (const story of SAMPLE_STORIES) {
      expect(story.minutesAgo).toBeGreaterThan(0);
    }
  });
});

describe("suggested sources", () => {
  it("stay few enough to be an offer rather than a catalogue", () => {
    expect(SUGGESTED_SOURCES.length).toBeGreaterThanOrEqual(5);
    expect(SUGGESTED_SOURCES.length).toBeLessThanOrEqual(7);
  });

  it("spread across subjects instead of clustering in technology", () => {
    const folders = new Set(SUGGESTED_SOURCES.map((source) => source.folder));
    // news, science, culture and technology at the least — a list of six tech
    // feeds is not a general-interest edition
    for (const folder of ["news", "science", "culture", "technology"]) {
      expect(folders, `nothing suggested for ${folder}`).toContain(folder);
    }
    const tech = SUGGESTED_SOURCES.filter((source) => source.folder === "technology");
    expect(tech.length).toBeLessThanOrEqual(2);
  });

  it("describes sources without selling them", () => {
    // no superlatives and no partnership language: these are listings, not
    // endorsements or placements
    for (const source of SUGGESTED_SOURCES) {
      expect(source.blurb, source.id).not.toMatch(
        /featured|sponsor|partner|best|leading|award|premier|world-class/i,
      );
      expect(source.blurb.length).toBeGreaterThan(20);
      expect(source.blurb.length).toBeLessThan(80);
    }
  });

  it("are real publications with verifiable https feed URLs", () => {
    for (const source of SUGGESTED_SOURCES) {
      expect(source.feedUrl, source.id).toMatch(/^https:\/\//);
      expect(source.siteUrl, source.id).toMatch(/^https:\/\//);
      expect(source.host.length).toBeGreaterThan(3);
      expect(source.blurb.length).toBeGreaterThan(10);
      expect(FOLDERS.map((f) => f.id)).toContain(source.folder);
    }
  });

  it("have unique ids, so two suggestions cannot collide in the registry", () => {
    const ids = SUGGESTED_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are not presented as already subscribed", () => {
    // a suggestion is an offer, never a fact — nothing in the sample or the
    // suggested list may claim to be a subscription
    for (const feed of SAMPLE_FEEDS) expect(feed.subscribed).toBeUndefined();
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
    contentState: "full",
    extractionState: "idle",
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

  it("never invents artwork for a fetched article", () => {
    const story = storyFromArticle({ ...article, image: undefined }, Date.now());
    expect(story.image).toBeUndefined();
    // a generated plate would sit in the same slot as a photograph and read as
    // the article's own image — which it is not, since it does not exist on the
    // page the story links to
    expect(story.plate).toBeUndefined();
  });

  it("passes the publisher's own image through untouched", () => {
    const story = storyFromArticle(article, Date.now());
    expect(story.image).toBe("https://example.com/a.jpg");
    expect(story.plate).toBeUndefined();
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
