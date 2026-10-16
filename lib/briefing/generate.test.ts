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

it("accepts six supported news stories in one phase call and publishes only the first five", async () => {
  const ids = Array.from({ length: 6 }, (_, i) => `cap-${i}`);
  const text = "A new version shipped.";
  const payload: ComposeInput = {
    ...composeInput,
    shortlist: {
      schemaVersion: 1,
      extractArticleIds: [],
      groups: ids.map((articleId, i) => ({
        groupId: `group-${i}`,
        kind: "news",
        workingHeadline: `Development ${i}`,
        articleIds: [articleId],
        value: 3,
        novelty: 2,
        evidence: 2,
        selectionReason: "Supported development",
        missingInformation: "",
      })),
    },
    materials: ids.map((articleId) => ({
      articleId,
      sourceName: "Fixture",
      title: articleId,
      sourceUrl: null,
      publishedAt: null,
      materialQuality: "full",
      text,
    })),
  };
  const response = {
    schemaVersion: 1,
    bigPicture: null,
    worthReading: [],
    topStories: ids.map((articleId, i) => ({
      headline: `Development ${i}`,
      whatHappened: { text, evidence: [{ articleId, excerpt: text }] },
      context: null,
      whyItMatters: null,
      perspectives: [],
    })),
  };
  const spy = stubFetch(() => ollamaReply(JSON.stringify(response)));
  try {
    const answer = await generatePhase({ phase: "compose", payload, llm: OLLAMA });
    expect(answer.ok).toBe(true);
    if (answer.ok && "topStories" in answer.result) {
      expect(answer.result.topStories).toHaveLength(5);
      expect(answer.omittedWeakItems).toBe(1);
    }
    expect(spy.bodies).toHaveLength(1);
  } finally {
    spy.restore();
  }
});

it("keeps safe HTTP explanations on the direct provider path", async () => {
  const spy = stubFetch(
    () => new Response(JSON.stringify({ error: "local-key private input" }), { status: 503 }),
  );
  try {
    const result = await generatePhase({
      phase: "shortlist",
      payload: shortlistInput,
      llm: OLLAMA,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "PROVIDER_ERROR",
      retryable: true,
      message: expect.stringMatching(/overloaded.*HTTP 503/),
    });
    expect(JSON.stringify(result)).not.toMatch(/local-key|private input/);
  } finally {
    spy.restore();
  }
});

it("recognizes an empty truncated direct reply and body-read timeout", async () => {
  const spy = stubFetch(() => ollamaReply("", "length"));
  try {
    expect(
      await generatePhase({ phase: "shortlist", payload: shortlistInput, llm: OLLAMA }),
    ).toMatchObject({ ok: false, code: "OUTPUT_TRUNCATED" });
  } finally {
    spy.restore();
  }
  const timeout = stubFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException("timed out", "TimeoutError"));
          },
        }),
      ),
  );
  try {
    expect(
      await generatePhase({ phase: "shortlist", payload: shortlistInput, llm: OLLAMA }),
    ).toMatchObject({ ok: false, code: "TIMED_OUT" });
  } finally {
    timeout.restore();
  }
});

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

describe("bounded editorial output", () => {
  it("uses JSON mode for a briefing call instead of relying on prose instructions", async () => {
    const spy = stubFetch(() => ollamaReply("{}"));
    try {
      await generatePhase({ phase: "shortlist", payload: shortlistInput, llm: OLLAMA });
      expect(spy.bodies[0].format).toBe("json");
    } finally {
      spy.restore();
    }
  });
});

it("calls an explicitly configured local Anthropic-compatible API from the browser", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    expect(((init?.headers ?? {}) as Record<string, string>)["x-api-key"]).toBe("local-key");
    const body = JSON.parse(String(init?.body));
    expect(body.system).toContain("selection editor");
    return Response.json({
      content: [{ type: "text", text: '{"schemaVersion":1,"groups":[],"extractArticleIds":[]}' }],
      stop_reason: "end_turn",
    });
  }) as typeof fetch;
  try {
    const result = await generatePhase({
      phase: "shortlist",
      payload: shortlistInput,
      llm: {
        service: "custom",
        wire: "anthropic",
        baseUrl: "http://localhost:1234/v1",
        models: { custom: "m" },
        keys: { custom: "local-key" },
      },
    });
    expect(result.ok).toBe(true);
    expect(urls).toEqual(["http://localhost:1234/v1/messages"]);
  } finally {
    globalThis.fetch = original;
  }
});

it("refuses a redirect from a custom local API instead of forwarding its credential", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    return new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } });
  }) as typeof fetch;
  try {
    const result = await generatePhase({
      phase: "shortlist",
      payload: shortlistInput,
      llm: {
        service: "custom",
        wire: "openai",
        baseUrl: "http://localhost:1234/v1",
        models: { custom: "m" },
        keys: { custom: "local-key" },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROVIDER_ERROR");
      expect(result.retryable).toBe(false);
    }
  } finally {
    globalThis.fetch = original;
  }
});

it("returns complete invalid direct-provider JSON and attaches it on repair", async () => {
  const bad = JSON.stringify({
    schemaVersion: 1,
    groups: [{ articleIds: "one" }],
    extractArticleIds: [],
  });
  const stub = stubFetch(() => ollamaReply(bad));
  try {
    const first = await generatePhase({ phase: "shortlist", payload: shortlistInput, llm: OLLAMA });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("expected invalid output");
    expect(first.repairOutput).toBe(bad);
    await generatePhase({
      phase: "shortlist",
      payload: shortlistInput,
      llm: OLLAMA,
      retryFeedback: first.errors,
      repairOutput: first.repairOutput,
    });
    expect(JSON.stringify(stub.bodies[1].messages)).toContain("Previous invalid JSON");
    expect(stub.bodies).toHaveLength(2);
  } finally {
    stub.restore();
  }
});

it("captures fenced invalid JSON and redacts keys in direct-provider validation errors", async () => {
  const bad = {
    schemaVersion: 1,
    groups: [
      {
        groupId: "g",
        kind: "news",
        workingHeadline: "News",
        articleIds: ["secret-test-key"],
        value: 3,
        novelty: 2,
        evidence: 2,
        selectionReason: "reason",
        missingInformation: "",
      },
    ],
    extractArticleIds: [],
  };
  const stub = stubFetch(() => ollamaReply("```json\n" + JSON.stringify(bad) + "\n```"));
  try {
    const result = await generatePhase({
      phase: "shortlist",
      payload: shortlistInput,
      llm: { ...OLLAMA, keys: { ollama: "secret-test-key" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid output");
    expect(result.repairOutput).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("secret-test-key");
  } finally {
    stub.restore();
  }
});
