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

const goodShortlist: ComposeInput["shortlist"] = {
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

const budgetSupported = (articleId: string) => ({
  text: "The project released version 2 on Tuesday.",
  evidence: [{ articleId, excerpt: "The project released version 2 on Tuesday." }],
});

function overBudgetEdition() {
  const ids = Array.from({ length: 10 }, (_, i) => `budget-${i}`);
  const input = composeInput({
    materials: ids.map((articleId) => material({ articleId })),
    shortlist: {
      schemaVersion: 1,
      extractArticleIds: [],
      groups: ids.map((articleId, i) => ({
        ...goodShortlist.groups[0],
        groupId: `budget-group-${i}`,
        articleIds: [articleId],
        kind: i < 7 ? "news" : "insight",
      })),
    },
  });

  return {
    input,
    output: {
      ...goodCompose,
      topStories: ids.slice(0, 7).map((articleId, i) =>
        goodStory({
          headline: `Development ${i}`,
          whatHappened: budgetSupported(articleId),
          whyItMatters: null,
        }),
      ),
      worthReading: ids
        .slice(7)
        .map((articleId) => ({ articleId, whyRead: budgetSupported(articleId) })),
    },
  };
}

it("caps excess whole stories and recommendations after validating them, without spending a repair", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const { input, output } = overBudgetEdition();
  expect(validateComposition(output, input).ok).toBe(false);
  const normalized = pruneWeakComposition(output, input);
  const checked = validateComposition(normalized.output, input);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    expect(checked.value.topStories).toEqual(output.topStories.slice(0, 5));
    expect(checked.value.worthReading).toEqual(output.worthReading.slice(0, 2));
  }
  expect(normalized.omitted).toBe(3);
  expect(output.topStories).toHaveLength(7);
  expect(pruneWeakComposition(normalized.output, input).omitted).toBe(0);
});

it("removes ineligible topics before applying the item cap", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const { input, output } = overBudgetEdition();
  input.shortlist.groups[0] = { ...input.shortlist.groups[0], value: 0, novelty: 0, evidence: 0 };
  const normalized = pruneWeakComposition(output, input);
  const checked = validateComposition(normalized.output, input);
  expect(checked.ok).toBe(true);
  if (checked.ok) expect(checked.value.topStories).toEqual(output.topStories.slice(1, 6));
  expect(normalized.omitted).toBe(3);
});

it.each(["structure", "evidence"])(
  "does not let an unused tail item's invalid %s block five eligible stories",
  async (fault) => {
    const { pruneWeakComposition } = await import("./validate");
    const { input, output } = overBudgetEdition();
    input.shortlist.groups[0] = { ...input.shortlist.groups[0], value: 0, novelty: 0, evidence: 0 };
    const raw: unknown =
      fault === "structure"
        ? {
            ...output,
            topStories: output.topStories.map((story, i) =>
              i === 6 ? { ...story, whatHappened: { ...story.whatHappened, text: 42 } } : story,
            ),
          }
        : {
            ...output,
            topStories: output.topStories.map((story, i) =>
              i === 6
                ? {
                    ...story,
                    whatHappened: {
                      ...story.whatHappened,
                      evidence: [{ articleId: "budget-6", excerpt: "Invented quotation" }],
                    },
                  }
                : story,
            ),
          };
    const normalized = pruneWeakComposition(raw, input);
    const checked = validateComposition(normalized.output, input);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.topStories).toEqual(output.topStories.slice(1, 6));
    expect(normalized.omitted).toBe(3);
  },
);

it("honors smaller composition limits while preserving invalid required evidence", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const { input, output } = overBudgetEdition();
  input.limits = { ...input.limits, maxStories: 2, maxDeepReads: 1 };
  const normalized = pruneWeakComposition(output, input);
  const checked = validateComposition(normalized.output, input);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    expect(checked.value.topStories).toHaveLength(2);
    expect(checked.value.worthReading).toHaveLength(1);
  }
  output.topStories[0].whatHappened.evidence[0].excerpt = "Fabricated evidence";
  expect(validateComposition(pruneWeakComposition(output, input).output, input).ok).toBe(false);
});

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

  it("still refuses bad score ranges when extra fields are discarded", () => {
    const bad = structuredClone(goodShortlist) as typeof goodShortlist;
    bad.groups[0].value = 9;
    (bad.groups[1] as Record<string, unknown>).url = "https://invented.example/x";
    const result = validateShortlist(bad, shortlistInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/value: expected an integer 0\.\.4/);
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

describe("material integrity", () => {
  it("never calls a feed summary or truncated original full", () => {
    for (const contentState of ["summary", "truncated"] as const) {
      const result = createArticleMaterial({
        article: {
          id: "a",
          title: "A",
          publishedAt: 0,
          summary: "Summary",
          body: [{ kind: "p", text: "Short body" }],
          contentState,
        },
        sourceName: "A",
      });
      expect(result.materialQuality).toBe(
        contentState === "summary" ? "feed-summary" : "excerpted",
      );
    }
  });
  it("budgets paragraph separators and keeps parts of a single oversized paragraph", () => {
    const result = createArticleMaterial({
      article: {
        id: "a",
        title: "A",
        publishedAt: 0,
        summary: "Summary",
        body: [{ kind: "p", text: "Opening " + "middle ".repeat(1200) + "Conclusion" }],
        contentState: "full",
      },
      sourceName: "A",
    });
    expect(result.text).toContain("Opening");
    expect(result.text).toContain("Conclusion");
    expect(result.text.length).toBeLessThanOrEqual(6000);
  });
});

it("keeps a Unicode-heavy composition within the byte budget while retaining endings", async () => {
  const { fitComposeInput } = await import("./materials");
  const input = composeInput({
    materials: Array.from({ length: 60 }, (_, i) =>
      material({ articleId: String(i), text: "开头" + "中文正文".repeat(1498) + "结尾" }),
    ),
  });
  const fitted = fitComposeInput(input);
  expect(new TextEncoder().encode(JSON.stringify(fitted)).byteLength).toBeLessThan(
    512 * 1024 - 2048,
  );
  expect(fitted.materials.every((m) => m.text.startsWith("开头") && m.text.endsWith("结尾"))).toBe(
    true,
  );
  expect(fitted.materials.every((m) => m.materialQuality === "excerpted")).toBe(true);
});

it("omits a whole low-scoring topic while retaining other evidenced news", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({
    shortlist: {
      ...goodShortlist,
      groups: [
        goodShortlist.groups[0],
        {
          ...goodShortlist.groups[0],
          groupId: "weak",
          articleIds: ["B1"],
          value: 1,
          novelty: 1,
          evidence: 1,
        },
      ],
    },
    materials: [material(), material({ articleId: "B1" })],
  });
  const weak = goodStory({
    headline: "A weak topic",
    whatHappened: {
      text: "The project released version 2 on Tuesday.",
      evidence: [{ articleId: "B1", excerpt: "The project released version 2 on Tuesday." }],
    },
    whyItMatters: null,
  });
  // Remove B1 from the stronger group, so its own score cannot qualify the weak topic.
  input.shortlist.groups[0] = { ...input.shortlist.groups[0], articleIds: ["A1"] };
  const trimmed = pruneWeakComposition({ ...goodCompose, topStories: [goodStory(), weak] }, input);
  expect(trimmed.omitted).toBe(1);
  const result = validateComposition(trimmed.output, input);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value.topStories.map((s) => s.headline)).toEqual([goodStory().headline]);
});

it("does not hide an invalid citation while dropping a low-scoring topic", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({
    shortlist: {
      ...goodShortlist,
      groups: [{ ...goodShortlist.groups[0], value: 0, novelty: 0, evidence: 0 }],
    },
  });
  const invalid = structuredClone(goodCompose);
  invalid.topStories[0].whatHappened.evidence[0].excerpt = "A fabricated quote.";
  const result = pruneWeakComposition(invalid, input);
  expect(result.omitted).toBe(0);
  expect(validateComposition(result.output, input).ok).toBe(false);
});

it("retains valid news when misplaced news and an unverifiable optional context occur together", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({ materials: [material(), material({ articleId: "C1" })] });
  const misplaced = goodStory({
    headline: "An essay presented as news",
    whatHappened: {
      text: "A supported account",
      evidence: [{ articleId: "C1", excerpt: "The project released version 2 on Tuesday." }],
    },
  });
  const valid = goodStory({
    context: {
      text: "This entire paragraph must be omitted.",
      evidence: [
        { articleId: "A1", excerpt: "The release limits memory to 4GB." },
        { articleId: "A1", excerpt: "An invented context quote" },
      ],
    },
  });
  const result = pruneWeakComposition({ ...goodCompose, topStories: [misplaced, valid] }, input);
  expect(result.omitted).toBe(1);
  expect(result.omittedSections).toBe(1);
  const checked = validateComposition(result.output, input);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    expect(checked.value.topStories).toHaveLength(1);
    expect(checked.value.topStories[0].context).toBeNull();
    expect(checked.value.topStories[0].whatHappened).toEqual(valid.whatHappened);
  }
  expect(valid.context?.text).toBe("This entire paragraph must be omitted.");
});

it.each(["bigPicture", "context", "whyItMatters", "perspectives"] as const)(
  "omits an entire optional %s with a nonverbatim excerpt",
  async (field) => {
    const { pruneWeakComposition } = await import("./validate");
    const unsupported = {
      text: "Do not retain this prose",
      evidence: [{ articleId: "A1", excerpt: "Invented quotation" }],
    };
    const raw =
      field === "bigPicture"
        ? { ...goodCompose, bigPicture: unsupported }
        : {
            ...goodCompose,
            topStories: [
              goodStory({ [field]: field === "perspectives" ? [unsupported] : unsupported }),
            ],
          };
    const result = pruneWeakComposition(raw, composeInput());
    expect(result.omittedSections).toBe(1);
    expect(result.omitted).toBe(0);
    expect(validateComposition(result.output, composeInput()).ok).toBe(true);
    expect(JSON.stringify(result.output)).not.toContain("Do not retain this prose");
  },
);

it("still rejects unknown sources and malformed optional sections", async () => {
  const { pruneWeakComposition } = await import("./validate");
  for (const context of [
    { text: "Unknown source", evidence: [{ articleId: "MADE-UP", excerpt: "Invented quotation" }] },
    { text: "Missing evidence", evidence: [] },
  ]) {
    const result = pruneWeakComposition(
      { ...goodCompose, topStories: [goodStory({ context })] },
      composeInput(),
    );
    expect(result.omittedSections).toBe(0);
    expect(validateComposition(result.output, composeInput()).ok).toBe(false);
  }
});

it("omits misplaced selections without losing the valid stories in a thirteen-article edition", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({
    materials: [material(), material({ articleId: "C1" }), material({ articleId: "B1" })],
  });
  for (let i = 0; i < 10; i++) input.materials.push(material({ articleId: `extra-${i}` }));
  const misplaced = goodStory({
    headline: "An essay placed in the news section",
    whatHappened: {
      text: "The release limits memory to 4GB.",
      evidence: [{ articleId: "C1", excerpt: "The release limits memory to 4GB." }],
    },
    whyItMatters: null,
  });
  const raw = {
    ...goodCompose,
    bigPicture: misplaced.whatHappened,
    topStories: [goodStory(), misplaced],
    worthReading: [{ articleId: "B1", whyRead: goodStory().whatHappened }],
  };
  // This reproduces both placement errors, with valid, self-referencing evidence.
  raw.worthReading[0].whyRead = {
    text: "The project released version 2 on Tuesday.",
    evidence: [{ articleId: "B1", excerpt: "The project released version 2 on Tuesday." }],
  };
  expect(input.materials).toHaveLength(13);
  expect(validateComposition(raw, input).ok).toBe(false);
  const result = pruneWeakComposition(raw, input);
  expect(result.omitted).toBe(2);
  const checked = validateComposition(result.output, input);
  expect(checked.ok).toBe(true);
  if (checked.ok) {
    expect(checked.value.topStories).toEqual([goodStory()]);
    expect(checked.value.worthReading).toEqual([]);
    expect(checked.value.bigPicture).toBeNull();
  }
});

it("refuses invented evidence even when its whole item is in the wrong section", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({ materials: [material(), material({ articleId: "C1" })] });
  const raw = {
    ...goodCompose,
    worthReading: [
      {
        articleId: "A1",
        whyRead: {
          text: "An invented claim.",
          evidence: [{ articleId: "A1", excerpt: "An invented quote." }],
        },
      },
    ],
  };
  expect(pruneWeakComposition(raw, input).omitted).toBe(0);
  expect(validateComposition(pruneWeakComposition(raw, input).output, input).ok).toBe(false);
});

it("does not publish an edition when every item was misplaced", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput();
  const raw = {
    ...goodCompose,
    topStories: [],
    worthReading: [
      {
        articleId: "A1",
        whyRead: goodStory().whatHappened,
      },
    ],
  };
  const result = pruneWeakComposition(raw, input);
  expect(result.omitted).toBe(1);
  const checked = validateComposition(result.output, input);
  expect(checked.ok).toBe(false);
  if (!checked.ok)
    expect(checked.errors).toContain("INSUFFICIENT_CONTENT: nothing evidenced to publish");
});

it("discards the model's extra whatHappenedNote without publishing it or weakening evidence checks", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const raw = {
    ...goodCompose,
    topStories: [{ ...goodStory(), whatHappenedNote: "An internal editorial note." }],
  };
  const result = pruneWeakComposition(raw, composeInput());
  expect(validateComposition(result.output, composeInput()).ok).toBe(true);
  expect(JSON.stringify(result.output)).not.toContain("whatHappenedNote");
  expect(result.omitted).toBe(0);
  raw.topStories[0].whatHappened.evidence[0].excerpt = "An invented quote.";
  expect(
    validateComposition(pruneWeakComposition(raw, composeInput()).output, composeInput()).ok,
  ).toBe(false);
});

it("discards unknown fields of any shape before checking the required story content", async () => {
  const { pruneWeakComposition } = await import("./validate");
  for (const extra of [
    { whatHappenedNote: { text: "Unexpected object" } },
    { publisherUrl: "https://invented.example" },
  ]) {
    const result = pruneWeakComposition(
      { ...goodCompose, topStories: [{ ...goodStory(), ...extra }] },
      composeInput(),
    );
    expect(validateComposition(result.output, composeInput()).ok).toBe(true);
    for (const key of Object.keys(extra)) expect(JSON.stringify(result.output)).not.toContain(key);
  }
});

it("discards extra composition fields recursively without mutating the reply or hiding bad evidence", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const raw = {
    ...goodCompose,
    editorialNotes: { anything: ["not published"] },
    topStories: [
      {
        ...goodStory(),
        headlineNote: "Internal headline explanation",
        whatHappened: {
          ...goodStory().whatHappened,
          note: { anything: true },
          evidence: goodStory().whatHappened.evidence.map((ref) => ({
            ...ref,
            publisherUrl: "https://invented.example",
            note: [1, 2],
          })),
        },
      },
    ],
  };
  const cleaned = pruneWeakComposition(raw, composeInput());
  expect(validateComposition(cleaned.output, composeInput()).ok).toBe(true);
  expect(cleaned.omitted).toBe(0);
  expect(JSON.stringify(cleaned.output)).not.toMatch(
    /headlineNote|editorialNotes|publisherUrl|not published/,
  );
  expect(raw.topStories[0].headlineNote).toBe("Internal headline explanation");
  raw.topStories[0].whatHappened.evidence[0].excerpt = "Invented evidence";
  expect(
    validateComposition(pruneWeakComposition(raw, composeInput()).output, composeInput()).ok,
  ).toBe(false);
});

it("ignores extra shortlist fields but keeps all required field checks", () => {
  const raw = {
    ...goodShortlist,
    notes: ["ignore"],
    groups: goodShortlist.groups.map((group) => ({
      ...group,
      selectionReasonNote: { note: true },
    })),
  };
  const cleaned = validateShortlist(raw, shortlistInput());
  expect(cleaned.ok).toBe(true);
  if (cleaned.ok) expect(JSON.stringify(cleaned.value)).not.toMatch(/selectionReasonNote|ignore/);
  expect(
    validateShortlist(
      { ...raw, groups: [{ ...raw.groups[0], articleIds: "A1" }] },
      shortlistInput(),
    ).ok,
  ).toBe(false);
});

it("does not fill missing or malformed story fields when discarding extras", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const missing: Record<string, unknown> = {
    ...goodStory(),
    headlineNote: "Not a replacement headline",
  };
  delete missing.headline;
  for (const story of [
    missing,
    { ...goodStory(), headline: 123, headlineNote: "Ignore" },
    { ...goodStory(), whatHappened: null, headlineNote: "Ignore" },
  ]) {
    const raw = { ...goodCompose, topStories: [story] };
    expect(
      validateComposition(pruneWeakComposition(raw, composeInput()).output, composeInput()).ok,
    ).toBe(false);
  }
});

it("drops a valid repeated recommendation but never hides invalid evidence behind deduplication", async () => {
  const { pruneWeakComposition } = await import("./validate");
  const input = composeInput({
    materials: [material(), material({ articleId: "C1", text: "The long argument stands." })],
  });
  const context = { ...input, previouslyRecommendedArticleIds: ["C1"] };
  const repeat = {
    articleId: "C1",
    whyRead: {
      text: "A useful argument.",
      evidence: [{ articleId: "C1", excerpt: "The long argument stands." }],
    },
  };
  const raw = { ...goodCompose, worthReading: [repeat], bigPicture: repeat.whyRead };
  const trimmed = pruneWeakComposition(raw, context);
  expect(trimmed.omitted).toBe(1);
  expect(validateComposition(trimmed.output, context).ok).toBe(true);
  expect(trimmed.output).toMatchObject({ worthReading: [], bigPicture: null });
  const invalid = {
    ...raw,
    worthReading: [
      {
        ...repeat,
        whyRead: { ...repeat.whyRead, evidence: [{ articleId: "C1", excerpt: "Invented quote" }] },
      },
    ],
  };
  expect(pruneWeakComposition(invalid, context).omitted).toBe(0);
  expect(validateComposition(pruneWeakComposition(invalid, context).output, context).ok).toBe(
    false,
  );
});

// Real DeepSeek failure: a new opening quote was added to a mid-quotation excerpt.
describe("evidence quotation boundaries", () => {
  const source =
    "Bluesky CEO Toni Schneider shared the news of Attie’s new capabilities during an interview at Disrupt, saying, “We’re adding a feature to our Attie product that allows you to build sites and social experiences again for a group of people. So think of it as … social vibe coding or vibe coding for your community.”";
  const text = "So think of it as … social vibe coding or vibe coding for your community.";
  const check = (excerpt: string, sourceText = source) =>
    validateComposition(
      {
        ...goodCompose,
        topStories: [
          goodStory({
            whatHappened: {
              text: "Schneider described social vibe coding.",
              evidence: [{ articleId: "A1", excerpt }],
            },
            whyItMatters: null,
          }),
        ],
      },
      composeInput({ materials: [material({ text: sourceText })] }),
    );

  it.each([
    ["“", "”"],
    ['"', '"'],
    ["‘", "’"],
    ["'", "'"],
    ["「", "」"],
    ["『", "』"],
  ])(
    "removes only a matched %s %s wrapper when the complete interior is verbatim",
    (open, close) => {
      const result = check(open + text + close);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.topStories[0].whatHappened.evidence[0].excerpt).toBe(text);
    },
  );

  it("preserves an exact source quote unchanged", () => {
    const quote = "“The project released version 2.”";
    const result = check(quote, `The announcement said: ${quote}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.topStories[0].whatHappened.evidence[0].excerpt).toBe(quote);
  });

  it.each([
    "“So think of it as social vibe coding or vibe coding for your community.”",
    "“So think of it as … social coding or vibe coding for your community.”",
    "“So think of it as … social vibe coding or vibe coding for our community.”",
    "“So think of it as … social vibe coding or vibe coding for your community!”",
    "“”",
    "“So think of it as … social vibe coding or vibe coding for your community.'",
  ])("still refuses changed words, punctuation, empty or mismatched wrappers: %s", (excerpt) => {
    const result = check(excerpt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("not found verbatim");
  });
});
