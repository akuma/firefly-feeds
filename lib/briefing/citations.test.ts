import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/briefing/generate/route";
import { DEFAULT_LLM_CONFIG } from "../llm";
import { generatePhase } from "./generate";
import type { ComposeInput, GenerateResult } from "./types";

const payload: ComposeInput = {
  schemaVersion: 1,
  composeContractVersion: 2,
  editionDate: "2026-10-16",
  cutoffAt: Date.parse("2026-10-16T15:55:35Z"),
  timezone: "Asia/Shanghai",
  outputLanguage: "en",
  shortlist: {
    schemaVersion: 1,
    groups: [
      {
        groupId: "g6",
        kind: "news",
        workingHeadline: "A company vision",
        articleIds: ["replit"],
        value: 3,
        novelty: 2,
        evidence: 2,
        selectionReason: "A development",
        missingInformation: "",
      },
    ],
    extractArticleIds: [],
  },
  materials: ["replit", "outside-group"].map((articleId) => ({
    articleId,
    sourceName: "Fixture",
    title: "A company vision",
    sourceUrl: null,
    publishedAt: null,
    materialQuality: "full",
    text: "He described his vision of a “self-driving company,” referring not to robotaxi makers.",
  })),
  limits: { maxStories: 5, maxDeepReads: 2, targetReadingMinutes: 4 },
};
const output = {
  schemaVersion: 2,
  bigPicture: null,
  worthReading: [],
  topStories: [
    {
      headline: "A company vision",
      whatHappened: {
        text: "A CEO described a self-driving company.",
        evidence: [{ articleId: "replit" }],
      },
      context: null,
      whyItMatters: null,
      perspectives: [],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(["hosted", "local"] as const)("%s writing contract", (transport) => {
  async function generate(response: unknown, input = payload): Promise<GenerateResult> {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const system = body.messages[0].content as string;
      expect(system.includes('"excerpt"')).toBe(input.composeContractVersion !== 2);
      return Response.json(
        transport === "local"
          ? { message: { content: JSON.stringify(response) }, done: true }
          : { choices: [{ message: { content: JSON.stringify(response) } }] },
      );
    });
    vi.stubGlobal("fetch", fetch);
    if (transport === "local")
      return generatePhase({
        phase: "compose",
        payload: input,
        llm: { ...DEFAULT_LLM_CONFIG, service: "ollama", models: { ollama: "fixture" }, keys: {} },
      });
    const result = await POST(
      new Request("https://feeds.example/api/briefing/generate", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://feeds.example" },
        body: JSON.stringify({
          phase: "compose",
          input,
          service: "openai",
          wire: "openai",
          baseUrl: "",
          models: { openai: "fixture" },
          keys: { openai: "fixture-key" },
        }),
      }),
    );
    return result.json();
  }

  it("accepts ID-only references and returns no excerpt", async () => {
    const result = await generate(output);
    expect(result.ok).toBe(true);
    if (result.ok && "topStories" in result.result)
      expect(result.result.topStories[0].whatHappened.evidence).toEqual([{ articleId: "replit" }]);
  });

  it("does not reject r7 punctuation in an unsolicited excerpt", async () => {
    const reply = structuredClone(output);
    Object.assign(reply.topStories[0].whatHappened.evidence[0], {
      excerpt: "He described his vision of a “self-driving company”",
    });
    expect((await generate(reply)).ok).toBe(true);
  });

  it.each([
    { evidence: [] },
    { evidence: [{ articleId: "unknown" }] },
    { evidence: [{ articleId: "outside-group" }] },
  ])("rejects invalid references: %j", async ({ evidence }) => {
    const reply = structuredClone(output);
    reply.topStories[0].whatHappened.evidence = evidence;
    const result = await generate(reply);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(
        evidence[0]?.articleId === "outside-group" ? "INSUFFICIENT_CONTENT" : "INVALID_OUTPUT",
      );
  });

  it("rejects a model attempting to return the old output version", async () => {
    const result = await generate({ ...output, schemaVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_OUTPUT");
  });

  it("still checks verbatim excerpts for unmarked legacy requests", async () => {
    const legacyInput = { ...payload };
    delete legacyInput.composeContractVersion;
    const reply = {
      ...output,
      schemaVersion: 1,
      topStories: [
        {
          ...output.topStories[0],
          whatHappened: {
            text: "A company vision.",
            evidence: [
              {
                articleId: "replit",
                excerpt: "He described his vision of a “self-driving company”",
              },
            ],
          },
        },
      ],
    };
    expect((await generate(reply, legacyInput)).ok).toBe(false);
    reply.topStories[0].whatHappened.evidence[0].excerpt = "self-driving company";
    expect((await generate(reply, legacyInput)).ok).toBe(true);
  });
});
