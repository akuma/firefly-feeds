import { describe, expect, it } from "vitest";
import { buildShortlistMessages, buildComposeMessages } from "./prompts";
import { validateComposition } from "./validate";
import type { ComposeInput, ShortlistInput } from "./types";

const prepared: ShortlistInput = {
  schemaVersion: 1,
  editionDate: "2026-10-14",
  cutoffAt: Date.now(),
  timezone: "UTC",
  outputLanguage: "en",
  focusTopicIds: [],
  candidates: [],
  previousStories: [],
};
const group = {
  groupId: "g",
  kind: "news" as const,
  workingHeadline: "Release",
  articleIds: ["a"],
  value: 1,
  novelty: 1,
  evidence: 1,
  selectionReason: "Check",
  missingInformation: "Full text",
};
const input: ComposeInput = {
  schemaVersion: 1,
  editionDate: prepared.editionDate,
  cutoffAt: prepared.cutoffAt,
  timezone: "UTC",
  outputLanguage: "en",
  shortlist: { schemaVersion: 1, groups: [group], extractArticleIds: [] },
  materials: [
    {
      articleId: "a",
      sourceName: "A",
      title: "Release",
      sourceUrl: null,
      publishedAt: null,
      materialQuality: "full",
      text: "The release has shipped.",
    },
  ],
  limits: { maxStories: 5, maxDeepReads: 2, targetReadingMinutes: 4 },
};
const output = {
  schemaVersion: 1,
  bigPicture: null,
  topStories: [
    {
      headline: "Release",
      whatHappened: {
        text: "It shipped.",
        evidence: [{ articleId: "a", excerpt: "The release has shipped." }],
      },
      context: null,
      whyItMatters: null,
      perspectives: [],
    },
  ],
  worthReading: [],
};

describe("model contracts", () => {
  it("supplies the actual strict JSON schema to both model phases", () => {
    expect(buildShortlistMessages(prepared)[0].content).toContain('"additionalProperties":false');
    expect(buildShortlistMessages(prepared)[0].content).toContain('"extractArticleIds"');
    expect(buildComposeMessages(input)[0].content).toContain('"whatHappened"');
  });
  it("refuses to publish a weak exploratory group without a passing reassessment", () => {
    expect(validateComposition(output, input).ok).toBe(false);
  });
  it("allows an exploratory group promoted by an explicit second-round score", () => {
    expect(
      validateComposition(
        { ...output, reassessedGroups: [{ groupId: "g", value: 3, novelty: 2, evidence: 2 }] },
        input,
      ).ok,
    ).toBe(true);
  });
  it("refuses a required whatHappened set to null even when a deep read is present", () => {
    expect(
      validateComposition(
        {
          ...output,
          topStories: [{ ...output.topStories[0], whatHappened: null }],
          worthReading: [{ articleId: "a", whyRead: output.topStories[0].whatHappened }],
        },
        input,
      ).ok,
    ).toBe(false);
  });
});

describe("one event, one story", () => {
  it("rejects two headlines citing different articles in the same event group", () => {
    const two = structuredClone(input);
    two.shortlist.groups[0] = {
      ...group,
      articleIds: ["a", "b"],
      value: 3,
      novelty: 2,
      evidence: 2,
    };
    two.materials.push({ ...two.materials[0], articleId: "b" });
    const duplicate = structuredClone(output);
    duplicate.topStories.push({
      ...duplicate.topStories[0],
      headline: "Different title",
      whatHappened: {
        text: "It shipped.",
        evidence: [{ articleId: "b", excerpt: "The release has shipped." }],
      },
    });
    expect(validateComposition(duplicate, two).ok).toBe(false);
  });
});

describe("shortlist output budget", () => {
  it("caps selection rather than inviting the model to annotate all sixty candidates", () => {
    const messages = buildShortlistMessages(prepared);
    expect(messages[0].content).toContain('"maxItems":12');
    expect(messages[0].content).toMatch(/at most 12 groups/);
    expect(buildComposeMessages(input)[0].content).toMatch(/100.160 words/);
  });
});

it("gives JSON-mode providers a complete legal example alongside the schema", () => {
  const messages = buildShortlistMessages(prepared);
  expect(messages[0].content).toContain('"missingInformation":""');
  expect(messages[0].content).toContain("Format example");
});

it("spells out section eligibility using exact article IDs, including empty sections", () => {
  const messages = buildComposeMessages(input);
  const user = messages[1].content;
  expect(user).toContain('"topStories":[{"groupId":"g","mainEvidenceArticleIds":["a"]}]');
  expect(user).toContain('"worthReading":[]');
  expect(user).toContain("Do not mix groups in whatHappened");
});

it("writes in the selected language while keeping evidence excerpts in their original language", () => {
  const chinese = { ...input, outputLanguage: "zh-Hans" } as ComposeInput;
  expect(buildComposeMessages(chinese)[0].content).toContain(
    "Write all reader-facing headlines and prose in Simplified Chinese",
  );
  expect(buildComposeMessages(chinese)[0].content).not.toContain("Write fluent editorial English");
  expect(buildComposeMessages(chinese)[0].content).toContain("Never translate evidence excerpts");
  const source = { ...input, outputLanguage: "source" } as ComposeInput;
  expect(buildComposeMessages(source)[0].content).toContain(
    "the language of its main source material",
  );
});

it("uses a smaller actual output schema after truncation instead of only asking for shorter prose", () => {
  const messages = buildComposeMessages(input, ["output: cut off at the token limit"]);
  const schema = JSON.parse(messages[0].content.split("JSON Schema: ")[1].split("\n")[0]);
  expect(schema.properties.topStories.maxItems).toBe(2);
  expect(schema.properties.worthReading.maxItems).toBe(1);
  expect(schema.properties.bigPicture).toEqual({ type: "null" });
  expect(schema.properties.topStories.items.properties.context).toEqual({ type: "null" });
  expect(schema.properties.topStories.items.properties.perspectives.maxItems).toBe(0);
  expect(
    schema.properties.topStories.items.properties.whatHappened.properties.evidence.maxItems,
  ).toBe(1);
  const data = JSON.parse(messages[1].content.split("\n")[0]);
  expect(data.limits.maxStories).toBe(2);
  expect(data.limits.maxDeepReads).toBe(1);
  expect(messages[0].content).not.toContain("change nothing else");
  expect(messages[0].content).toContain("Format example");
});

it("also supplies a complete compose JSON example on the first call", () => {
  expect(buildComposeMessages(input)[0].content).toContain(
    '"context":null,"whyItMatters":null,"perspectives":[]',
  );
});

it("preserves specific validator feedback when the last writing call also needs to be compact", () => {
  const messages = buildComposeMessages(input, [
    "topStories[0].whatHappened: missing",
    "COMPACT_OUTPUT",
  ]);
  expect(messages[0].content).toContain("topStories[0].whatHappened: missing");
});

it("asks for comfortable Chinese and Latin spacing without modifying exact evidence", () => {
  const messages = buildComposeMessages({ ...input, outputLanguage: "zh-Hans" });
  expect(messages[0].content).toContain("Feldman 对家用 AI 设备");
  expect(messages[0].content).toContain("Never translate evidence excerpts");
});

describe("editorial time reference", () => {
  it("anchors both phases to the edition's frozen date and timezone", () => {
    for (const messages of [buildShortlistMessages(prepared), buildComposeMessages(input)]) {
      expect(messages[0].content).toContain("Reference date: 2026-10-14 (UTC)");
      expect(messages[0].content).toContain("historical background");
      expect(messages[0].content).toContain("publication date is not the event date");
    }
  });
});

describe("focus scope in both editorial phases", () => {
  it("carries readable focus labels and requires direct relevance without padding", () => {
    const context = { focusTopics: [{ id: "custom-123", label: "Design" }], focusOnly: true };
    for (const messages of [
      buildShortlistMessages({ ...prepared, ...context }),
      buildComposeMessages({ ...input, ...context }),
    ]) {
      expect(messages[0].content).toContain("Design");
      expect(messages[0].content).toContain("directly relevant");
      expect(messages[0].content).toContain("Do not fill unused slots with general news");
    }
  });
});

it("accepts new focus context and old checkpoints on both request schemas", async () => {
  const { schemaErrors, SHORTLIST_INPUT_SCHEMA, COMPOSE_INPUT_SCHEMA } = await import("./schema");
  const context = { focusTopics: [{ id: "custom-123", label: "Design" }], focusOnly: true };
  expect(schemaErrors(prepared, SHORTLIST_INPUT_SCHEMA)).toEqual([]);
  expect(schemaErrors(input, COMPOSE_INPUT_SCHEMA)).toEqual([]);
  expect(schemaErrors({ ...prepared, ...context }, SHORTLIST_INPUT_SCHEMA)).toEqual([]);
  expect(schemaErrors({ ...input, ...context }, COMPOSE_INPUT_SCHEMA)).toEqual([]);
  expect(
    schemaErrors({ ...input, ...context, focusOnly: "yes" }, COMPOSE_INPUT_SCHEMA),
  ).not.toEqual([]);
});
