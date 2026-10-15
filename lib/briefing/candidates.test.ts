import { describe, expect, it } from "vitest";
import { articleFingerprint, classifyInputFor } from "../classify";
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

  it("uses only the trailing day and refuses timestamps from the future", () => {
    const articles = [
      article("a~future", "a", T0 + HOUR),
      article("a~recent", "a", T0 - HOUR),
      article("a~old", "a", T0 - 72 * HOUR),
      article("a~ancient", "a", T0 - 20 * 24 * HOUR),
    ];
    const set = run({ articles });
    expect(set.candidates.map((c) => c.articleId)).toEqual(["a~recent"]);
    expect(set.selectedWindow).toEqual({ recent: 1, older: 0 });
    expect(set.skippedStats.outOfWindow).toBe(3);
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
    // Old essays cannot take slots; the quiet source still gets its fair share.
    expect(set.sourceCoverage["a"]).toBe(59);
    expect(set.sourceCoverage["c"]).toBeUndefined();
  });

  it("does not expand a thin day into older material", () => {
    const articles = [
      ...Array.from({ length: 3 }, (_, i) => article(`r${i}`, "a", T0 - i * HOUR)),
      ...Array.from({ length: 25 }, (_, i) =>
        article(`o${i}`, "b", T0 - (48 + i) * HOUR, { title: `Older ${i}` }),
      ),
    ];
    const set = run({ articles });
    expect(set.selectedWindow.recent).toBe(3);
    // A thin pool stays thin rather than borrowing older articles.
    expect(set.selectedWindow.older).toBe(0);
    expect(set.candidates).toHaveLength(3);
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

describe("focused candidate scope", () => {
  it("excludes known off-topic articles before sampling but keeps unclassified candidates", () => {
    const classification = (itemId: string, topicIds: string[]): ArticleClassification => ({
      itemId,
      topicIds,
      confidence: 1,
      status: "confirmed",
      provider: "jev",
      contentFingerprint: "fixture",
      updatedAt: T0,
    });
    const set = run({
      articles: [
        article("a~ai", "a", T0 - HOUR),
        article("a~politics", "a", T0 - HOUR),
        article("a~unknown", "a", T0 - HOUR),
      ],
      classifications: [classification("a~ai", ["ai"]), classification("a~politics", ["politics"])],
      focusTopicIds: ["ai"],
    });
    expect(set.candidates.map((c) => c.articleId)).toEqual(["a~ai", "a~unknown"]);
  });
});

it("reserves the candidate budget for focused material before source sampling", () => {
  const politics = Array.from({ length: 70 }, (_, i) => article(`a~p${i}`, "a", T0 - i - 1));
  const classifications: ArticleClassification[] = politics.map((target) => ({
    itemId: target.id,
    topicIds: ["politics"],
    confidence: 1,
    status: "auto",
    provider: "jev",
    contentFingerprint: articleFingerprint(
      classifyInputFor(target).title,
      classifyInputFor(target).summary,
    ),
    updatedAt: T0,
  }));
  const articles = [...politics, article("a~design", "a", T0 - HOUR)];
  const general = run({ articles, classifications });
  expect(general.candidates).toHaveLength(60);
  const focused = run({ articles, classifications, focusTopicIds: ["design"] });
  expect(focused.candidates.map((candidate) => candidate.articleId)).toEqual(["a~design"]);
  expect(focused.skippedStats.offFocus).toBe(70);
});

it("does not exclude material on the basis of a rejected or unreviewed classification", () => {
  const articles = [article("a~rejected", "a", T0 - HOUR), article("a~review", "a", T0 - HOUR)];
  const classifications: ArticleClassification[] = articles.map(({ id }, index) => ({
    itemId: id,
    topicIds: ["politics"],
    confidence: 0.3,
    status: index === 0 ? "rejected" : "needs_review",
    provider: "jev",
    contentFingerprint: "fixture",
    updatedAt: T0,
  }));
  const focused = run({ articles, classifications, focusTopicIds: ["design"] });
  expect(focused.candidates).toHaveLength(2);
  expect(focused.candidates.every((candidate) => candidate.topicIds.length === 0)).toBe(true);
});

it("treats a stale automatic classification as unknown after the article text changes", () => {
  const changed = article("a~changed", "a", T0 - HOUR, {
    title: "An AI design tool ships",
    summary: "New interface design tools.",
  });
  const stale: ArticleClassification = {
    itemId: changed.id,
    topicIds: ["politics"],
    confidence: 1,
    status: "auto",
    provider: "jev",
    contentFingerprint: "old-political-text",
    updatedAt: T0 - HOUR,
  };
  expect(
    run({
      articles: [changed],
      classifications: [stale],
      focusTopicIds: ["design"],
    }).candidates.map((candidate) => candidate.articleId),
  ).toEqual([changed.id]);
  expect(
    run({
      articles: [changed],
      classifications: [{ ...stale, status: "confirmed" }],
      focusTopicIds: ["design"],
    }).candidates,
  ).toEqual([]);
});

it("includes exactly the 24-hour boundary without reaching further back", () => {
  const set = run({
    articles: [
      article("a~boundary", "a", T0 - 24 * HOUR),
      article("a~older", "a", T0 - 24 * HOUR - 1),
    ],
  });
  expect(set.candidates.map((candidate) => candidate.articleId)).toEqual(["a~boundary"]);
});
