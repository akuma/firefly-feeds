import { describe, expect, it } from "vitest";
import { DEFAULT_LLM_CONFIG, type LlmConfig } from "../llm";
import { BRIEFING_MAX_TOKENS } from "./constants";
import { generatePhase } from "./generate";
import type { ComposeInput, ShortlistInput } from "./types";

/**
 * The failure this pins: a briefing's answer is the longest JSON the app asks
 * for, and an allowance sized for classification gists used to return it cut
 * in half — which the reader was told meant "not JSON". A cut-off answer says
 * it was cut off, and every phase asks for the room its own answer needs.
 */

const OLLAMA: LlmConfig = {
  ...DEFAULT_LLM_CONFIG,
  service: "ollama",
  wire: "openai",
  baseUrl: "",
  models: { ollama: "llama3.2" },
  keys: {},
};

const shortlistInput: ShortlistInput = {
  schemaVersion: 1,
  editionDate: "2026-10-13",
  cutoffAt: Date.now(),
  timezone: "UTC",
  outputLanguage: "en",
  focusTopicIds: [],
  candidates: [],
  previousStories: [],
};

const composeInput: ComposeInput = {
  ...shortlistInput,
  shortlist: { schemaVersion: 1, groups: [], extractArticleIds: [] },
  materials: [],
  limits: { maxStories: 5, maxDeepReads: 2, targetReadingMinutes: 4 },
};

function ollamaReply(content: string, doneReason?: string) {
  return new Response(
    JSON.stringify({
      message: { role: "assistant", content },
      done: true,
      ...(doneReason ? { done_reason: doneReason } : {}),
    }),
    { headers: { "content-type": "application/json" } },
  );
}

function stubFetch(reply: () => Response) {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return reply();
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = original) };
}

describe("one phase, one budget", () => {
  it("asks for the room its own answer needs, in the wire's own words", async () => {
    const spy = stubFetch(() => ollamaReply("{}"));
    try {
      await generatePhase({ phase: "shortlist", payload: shortlistInput, llm: OLLAMA });
      await generatePhase({ phase: "compose", payload: composeInput, llm: OLLAMA });
      // ollama calls it `num_predict`; the defaults stay sized for gists
      expect((spy.bodies[0].options as { num_predict: number }).num_predict).toBe(
        BRIEFING_MAX_TOKENS.shortlist,
      );
      expect((spy.bodies[1].options as { num_predict: number }).num_predict).toBe(
        BRIEFING_MAX_TOKENS.compose,
      );
      expect(BRIEFING_MAX_TOKENS.compose).toBeGreaterThan(BRIEFING_MAX_TOKENS.shortlist);
    } finally {
      spy.restore();
    }
  });
});

describe("an answer that ran out of room", () => {
  it("is reported as cut off, not as an answer that was not JSON", async () => {
    // the tail of a compose answer, missing its closing brace — exactly what a
    // token limit leaves behind
    const spy = stubFetch(() =>
      ollamaReply('{"schemaVersion": 1, "topStories": [{"head', "length"),
    );
    try {
      const result = await generatePhase({ phase: "compose", payload: composeInput, llm: OLLAMA });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("OUTPUT_TRUNCATED");
        expect(result.message).toMatch(/ran out of room/);
        // and the repair round is told how to answer within its allowance
        expect(result.errors?.join("\n")).toMatch(/more compactly/);
      }
    } finally {
      spy.restore();
    }
  });

  it("still calls a genuinely unreadable answer what it is", async () => {
    const spy = stubFetch(() => ollamaReply("Sure! Here is the briefing in prose."));
    try {
      const result = await generatePhase({ phase: "compose", payload: composeInput, llm: OLLAMA });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_OUTPUT");
        expect(result.message).toMatch(/not JSON/);
      }
    } finally {
      spy.restore();
    }
  });
});
