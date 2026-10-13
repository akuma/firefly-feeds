import { describe, expect, it } from "vitest";
import { canonicalUrl, prepareCandidates } from "./candidates";
import { editorialScore, interestBoost, rankGroups, selectForEdition } from "./score";
import type { ArticleClassification, ArticleRecord, SourceRecord } from "../storage/types";
import type { CandidateGroup } from "./types";

const T0 = new Date("2026-10-13T12:00:00Z").getTime();
const HOUR = 60 * 60_000;

function source(id: string, title = `Source ${id}`): SourceRecord {
  return {
    id,
    url: `https://${id}.example/feed.xml`,
    siteUrl: `https://${id}.example`,
    title,
    host: `${id}.example`,
    addedAt: T0,
    fetchedAt: T0,
    updatedAt: T0,
  };
}

function article(
  id: string,
  sourceId: string,
  publishedAt: number,
  patch: Partial<ArticleRecord> = {},
): ArticleRecord {
  return {
    id,
    sourceId,
    title: `Title ${id}`,
    publishedAt,
    fetchedAt: publishedAt,
    summary: `Summary ${id}.`,
    body: [{ kind: "p", text: `Body ${id}.` }],
    minutes: 3,
    layout: "standard",
    contentState: "summary",
    extractionState: "idle",
    ...patch,
  };
}

function run(input: Partial<Parameters<typeof prepareCandidates>[0]> = {}) {
  return prepareCandidates({
    articles: [],
    sources: [source("a"), source("b")],
    classifications: [],
    cutoffAt: T0,
    ...input,
  });
}

describe("canonical links", () => {
  it("drops fragments and tracking, but keeps meaning a publisher chose", () => {
    expect(canonicalUrl("https://x.example/a?utm_source=rss&id=1#top")).toBe(
      canonicalUrl("https://x.example/a?id=1&fbclid=abc"),
    );
    expect(canonicalUrl("https://x.example/a?id=1")).not.toBe(
      canonicalUrl("https://x.example/a?id=2"),
    );
    expect(canonicalUrl("not a url")).toBeNull();
  });
});

describe("candidate preparation", () => {
  it("keeps one story per duplicate link and per identical headline in one source", () => {
    const articles = [
      article("a~1", "a", T0 - HOUR, { link: "https://a.example/x?utm_source=feed" }),
      article("a~2", "a", T0 - 2 * HOUR, { link: "https://a.example/x" }),
      article("a~3", "a", T0 - 3 * HOUR, { title: "Same headline" }),
      article("a~4", "a", T0 - 4 * HOUR, { title: "Same headline" }),
    ];
    const set = run({ articles });
    // the newest of each duplicate survives; the rest are counted, not hidden
    expect(set.candidates.map((c) => c.articleId)).toEqual(["a~1", "a~3"]);
    expect(set.skippedStats.duplicates).toBe(2);
  });

  it("does not merge the same headline across different sources", () => {
    const articles = [
      article("a~1", "a", T0 - HOUR, { title: "Same headline" }),
      article("b~1", "b", T0 - 2 * HOUR, { title: "Same headline" }),
    ];
    expect(run({ articles }).candidates).toHaveLength(2);
  });

  it("splits the day from the week and refuses timestamps from the future", () => {
    const articles = [
      article("a~future", "a", T0 + HOUR),
      article("a~recent", "a", T0 - HOUR),
      article("a~old", "a", T0 - 72 * HOUR),
      article("a~ancient", "a", T0 - 20 * 24 * HOUR),
    ];
    const set = run({ articles });
    expect(set.candidates.map((c) => c.articleId)).toEqual(["a~recent", "a~old"]);
    expect(set.selectedWindow).toEqual({ recent: 1, older: 1 });
    expect(set.skippedStats.outOfWindow).toBe(2);
  });

  it("gives every source a first-round share before a loud one gets seconds", () => {
    // One source publishes eighty stories inside the day, another published one
    // quiet story hours ago, and a third holds the week's long reads: pure
    // recency would drown the quiet source out of the prompt entirely.
    const articles = [
      article("quiet~1", "b", T0 - 23 * HOUR),
      ...Array.from({ length: 80 }, (_, i) =>
        article(`loud~${i}`, "a", T0 - (i + 1) * 5 * 60_000, { title: `Loud ${i}` }),
      ),
      ...Array.from({ length: 18 }, (_, i) =>
        article(`essay~${i}`, "c", T0 - (48 + i) * HOUR, { title: `Essay ${i}` }),
      ),
    ];
    const set = run({
      articles,
      sources: [source("a", "Loud"), source("b", "Quiet"), source("c", "Essays")],
    });
    expect(set.sourceCoverage["b"]).toBe(1);
    // the loud source fills the rest of its window's quota, never the edition
    expect(set.sourceCoverage["a"]).toBe(41);
    expect(set.sourceCoverage["c"]).toBe(18);
  });

  it("hands an unfilled window's quota to the other one", () => {
    const articles = [
      ...Array.from({ length: 3 }, (_, i) => article(`r${i}`, "a", T0 - i * HOUR)),
      ...Array.from({ length: 25 }, (_, i) =>
        article(`o${i}`, "b", T0 - (48 + i) * HOUR, { title: `Older ${i}` }),
      ),
    ];
    const set = run({ articles });
    expect(set.selectedWindow.recent).toBe(3);
    // 18 older slots were reserved; the unfilled recent quota lends the rest
    expect(set.selectedWindow.older).toBe(25);
    expect(set.selectedWindow.older).toBeGreaterThan(18);
  });

  it("is stable: the same records produce the same edition in any order", () => {
    const articles = Array.from({ length: 12 }, (_, i) =>
      article(`a~${i}`, i % 2 ? "a" : "b", T0 - i * HOUR),
    );
    const straight = run({ articles }).candidates.map((c) => c.articleId);
    const shuffled = run({ articles: articles.toReversed() }).candidates.map((c) => c.articleId);
    expect(shuffled).toEqual(straight);
  });

  it("drops sourceless and empty records, and carries topics along", () => {
    const classification: ArticleClassification = {
      itemId: "a~1",
      topicIds: ["technology"],
      primaryTopicId: "technology",
      confidence: 0.9,
      status: "confirmed",
      provider: "jev",
      contentFingerprint: "fp",
      updatedAt: T0,
    };
    const set = run({
      articles: [
        article("a~1", "a", T0 - HOUR),
        article("orphan", "gone", T0 - HOUR),
        article("a~empty", "a", T0 - HOUR, { title: " ", summary: "", body: [] }),
      ],
      classifications: [classification],
    });
    expect(set.candidates.map((c) => c.articleId)).toEqual(["a~1"]);
    expect(set.candidates[0].topicIds).toEqual(["technology"]);
    expect(set.skippedStats.noSource).toBe(1);
    expect(set.skippedStats.empty).toBe(1);
  });
});

const group = (id: string, value: number, novelty: number, evidence: number): CandidateGroup => ({
  groupId: id,
  kind: "news",
  workingHeadline: id,
  articleIds: [id],
  value,
  novelty,
  evidence,
  selectionReason: "s",
  missingInformation: "",
});

describe("the shortlist arithmetic", () => {
  it("adds the three judgements and gives interest one point, never more", () => {
    const g = group("g1", 3, 2, 2);
    expect(editorialScore(g)).toBe(7);
    expect(interestBoost(["technology"], ["technology"])).toBe(1);
    expect(interestBoost(["technology", "ai"], ["technology", "ai"])).toBe(1);
    expect(interestBoost([], ["technology"])).toBe(0);
    expect(interestBoost(["technology"], [])).toBe(0);
  });

  it("breaks ties toward the source the edition has not used, without beating a better story", () => {
    const groups = [group("g1", 3, 2, 2), group("g2", 3, 2, 2), group("g3", 4, 3, 3)];
    const ranked = rankGroups(groups, [], new Map());
    const sources = new Map([
      ["g1", ["s1"]],
      ["g2", ["s2"]],
      ["g3", ["s1"]],
    ]);
    const picked = selectForEdition(ranked, 2, (id) => sources.get(id) ?? []);
    // g3 is clearly best; the second slot goes to the unused source, not s1 again
    expect(picked.map((p) => p.groupId)).toEqual(["g3", "g2"]);
  });
});
