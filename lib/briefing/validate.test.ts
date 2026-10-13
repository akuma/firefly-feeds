import { describe, expect, it } from "vitest";
import { createArticleMaterial } from "./materials";
import { validateComposition, validateShortlist, citedArticleIds } from "./validate";
import type { ArticleMaterial, ComposeInput, ComposedStory, ShortlistInput } from "./types";
import type { Block } from "../types";

const T0 = new Date("2026-10-13T12:00:00Z").getTime();

function body(n: number, make?: (i: number) => string): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "p" as const,
    text: make ? make(i) : `Paragraph ${i} of the article body.`,
  }));
}

describe("article material", () => {
  const article = (
    patch: Partial<Parameters<typeof createArticleMaterial>[0]["article"]> = {},
  ) => ({
    id: "a1",
    title: "A title",
    link: "https://a.example/p",
    publishedAt: T0,
    summary: "The feed summary.",
    body: body(6),
    contentState: "full" as const,
    ...patch,
  });

  it("keeps the whole body while it fits, and says it is whole", () => {
    const material = createArticleMaterial({ article: article(), sourceName: "A" });
    expect(material.materialQuality).toBe("full");
    expect(material.text).toContain("Paragraph 0");
    expect(material.text).toContain("Paragraph 5");
    expect(material.blockIndices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("cuts a long body at both ends and admits it cut", () => {
    const material = createArticleMaterial({
      article: article({ body: body(40, (i) => `Paragraph ${i} `.repeat(20)) }),
      sourceName: "A",
    });
    expect(material.materialQuality).toBe("excerpted");
    expect(material.text.length).toBeLessThanOrEqual(6000);
    // the opening and the conclusion both survive — a body cut at the top
    // hides the ending, and the ending is half the story
    expect(material.text).toContain("Paragraph 0");
    expect(material.text).toContain("Paragraph 39");
    expect(material.blockIndices?.length).toBeGreaterThan(2);
  });

  it("falls back to the feed summary when there is no body to read", () => {
    const material = createArticleMaterial({
      article: article({ body: [], contentState: "summary" }),
      sourceName: "A",
    });
    expect(material.materialQuality).toBe("feed-summary");
    expect(material.text).toBe("The feed summary.");
    expect(material.blockIndices).toBeUndefined();
  });
});

/* ---------------------------------------------------------- fixtures */

const shortlistInput = (over: Partial<ShortlistInput> = {}): ShortlistInput => ({
  schemaVersion: 1,
  editionDate: "2026-10-13",
  cutoffAt: T0,
  timezone: "Europe/Berlin",
  outputLanguage: "en",
  focusTopicIds: [],
  candidates: [
    {
      articleId: "A1",
      sourceId: "a",
      sourceName: "Source A",
      title: "A robotics project releases a new version",
      summary: "A release with limits.",
      publishedAt: T0,
      topicIds: ["technology"],
      contentState: "full",
      fullBodyCached: true,
    },
    {
      articleId: "B1",
      sourceId: "b",
      sourceName: "Source B",
      title: "A technical report on the same release",
      summary: "The same release, from the lab.",
      publishedAt: T0,
      topicIds: ["technology"],
      contentState: "summary",
      fullBodyCached: false,
    },
    {
      articleId: "C1",
      sourceId: "c",
      sourceName: "Source C",
      title: "Engineering tradeoffs in software delivery",
      summary: "A long argument.",
      publishedAt: T0 - 5 * 24 * 60 * 60_000,
      topicIds: ["design"],
      contentState: "summary",
      fullBodyCached: false,
    },
  ],
  previousStories: [],
  ...over,
});

const goodShortlist = {
  schemaVersion: 1,
  groups: [
    {
      groupId: "g1",
      kind: "news",
      workingHeadline: "A robotics project releases a new version",
      articleIds: ["A1", "B1"],
      value: 3,
      novelty: 2,
      evidence: 2,
      selectionReason: "Two articles describe the same substantive release",
      missingInformation: "Details and limitations of the new version",
    },
    {
      groupId: "g2",
      kind: "insight",
      workingHeadline: "Engineering tradeoffs in software delivery",
      articleIds: ["C1"],
      value: 4,
      novelty: 2,
      evidence: 2,
      selectionReason: "A substantive long-form argument",
      missingInformation: "Whether conclusions are supported in full text",
    },
  ],
  extractArticleIds: ["A1", "C1"],
};

const material = (over: Partial<ArticleMaterial> = {}): ArticleMaterial => ({
  articleId: "A1",
  sourceName: "Source A",
  title: "A robotics project releases a new version",
  sourceUrl: "https://a.example/p",
  publishedAt: T0,
  materialQuality: "full",
  text: "The project released version 2 on Tuesday. The release limits memory to 4GB. Critics say the API is unstable.",
  ...over,
});

const composeInput = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  schemaVersion: 1,
  editionDate: "2026-10-13",
  timezone: "Europe/Berlin",
  cutoffAt: T0,
  outputLanguage: "en",
  shortlist: goodShortlist as ComposeInput["shortlist"],
  materials: [material()],
  limits: { maxStories: 5, maxDeepReads: 2, targetReadingMinutes: 4 },
  ...over,
});

const goodStory = (over: Partial<ComposedStory> = {}): ComposedStory => ({
  headline: "A robotics project releases a new version",
  whatHappened: {
    text: "The project released version 2 on Tuesday.",
    evidence: [{ articleId: "A1", excerpt: "The project released version 2 on Tuesday." }],
  },
  context: null,
  whyItMatters: {
    text: "The release limits memory to 4GB.",
    evidence: [{ articleId: "A1", excerpt: "The release limits memory to 4GB." }],
  },
  perspectives: [],
  ...over,
});

const goodCompose = {
  schemaVersion: 1,
  bigPicture: null,
  topStories: [goodStory()],
  worthReading: [],
};

describe("the shortlist contract", () => {
  it("accepts the annotated example and computes nothing it was not given", () => {
    const result = validateShortlist(goodShortlist, shortlistInput());
    expect(result.ok).toBe(true);
  });

  it("refuses ids the model was never given, instead of inventing a source", () => {
    const bad = structuredClone(goodShortlist) as typeof goodShortlist;
    bad.groups[0].articleIds = ["A1", "MADE-UP"];
    bad.extractArticleIds = ["A1"];
    const result = validateShortlist(bad, shortlistInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/unknown article "MADE-UP"/);
  });

  it("refuses structural drift: extra fields, bad ranges, empty groups", () => {
    const bad = structuredClone(goodShortlist) as typeof goodShortlist;
    bad.groups[0].value = 9;
    (bad.groups[1] as Record<string, unknown>).url = "https://invented.example/x";
    const result = validateShortlist(bad, shortlistInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/value: expected an integer 0\.\.4/);
      expect(result.errors.join("\n")).toMatch(/unexpected field/);
    }
  });

  it("refuses an extraction list that does not match the groups", () => {
    const bad = structuredClone(goodShortlist) as typeof goodShortlist;
    bad.extractArticleIds = ["C1", "C1", "D1"];
    const result = validateShortlist(bad, shortlistInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/extractArticleIds: duplicate/);
      expect(result.errors.join("\n")).toMatch(/"D1" is not in any group/);
    }
  });
});

describe("the composition contract", () => {
  it("accepts excerpts found verbatim in the material, and refuses paraphrases", () => {
    expect(validateComposition(goodCompose, composeInput()).ok).toBe(true);

    const bad = structuredClone(goodCompose);
    bad.topStories[0].whatHappened.evidence[0].excerpt =
      "The project released version 2 last week.";
    const result = validateComposition(bad, composeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/not found verbatim/);
  });

  it("refuses a section without evidence, and a recommendation that cites its own article never", () => {
    const unsupported = structuredClone(goodCompose);
    unsupported.topStories[0].context = { text: "Context invented.", evidence: [] };
    expect(validateComposition(unsupported, composeInput()).ok).toBe(false);

    const selfless = {
      ...goodCompose,
      worthReading: [
        {
          articleId: "C1",
          whyRead: {
            text: "A substantive argument worth the reader's evening.",
            // citing the wrong article: the recommendation is unsupported
            evidence: [{ articleId: "A1", excerpt: "The project released version 2 on Tuesday." }],
          },
        },
      ],
    };
    const input = composeInput({
      materials: [material(), material({ articleId: "C1", text: "The long argument stands." })],
    });
    const result = validateComposition(selfless, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/must cite "C1"/);
  });

  it("refuses a deep read already recommended in an earlier edition", () => {
    const repeat = {
      ...goodCompose,
      worthReading: [
        {
          articleId: "C1",
          whyRead: {
            text: "A substantive argument worth the reader's evening.",
            evidence: [{ articleId: "C1", excerpt: "The long argument stands." }],
          },
        },
      ],
    };
    const input = composeInput({
      materials: [
        material(),
        material({
          articleId: "C1",
          text: "The long argument stands.",
          materialQuality: "feed-summary",
        }),
      ],
    });
    expect(validateComposition(repeat, input).ok).toBe(true);
    const result = validateComposition(repeat, input, ["C1"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/already recommended/);
  });

  it("refuses an edition with nothing evidenced, and doubled coverage of one event", () => {
    const empty = { schemaVersion: 1, bigPicture: null, topStories: [], worthReading: [] };
    const result = validateComposition(empty, composeInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/INSUFFICIENT_CONTENT/);

    const doubled = structuredClone(goodCompose);
    doubled.topStories.push(goodStory({ context: null, whyItMatters: null }));
    const twice = validateComposition(doubled, composeInput());
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors.join("\n")).toMatch(/already covered|same evidence/);
  });

  it("lists the articles an edition rests on, for the program's own source metadata", () => {
    const result = validateComposition(goodCompose, composeInput());
    expect(result.ok).toBe(true);
    if (result.ok) expect(citedArticleIds(result.value)).toEqual(["A1"]);
  });
});
