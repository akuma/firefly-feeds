import { describe, expect, it } from "vitest";
import {
  articleFingerprint,
  buildClassifyRequest,
  classificationFromOutcome,
  classifyDelay,
  classifyInputFor,
  CLASSIFY_PROVIDERS,
  ClassifyError,
  CLASSIFY_MAX_PER_MINUTE,
  CLASSIFY_MIN_INTERVAL_MS,
  CLASSIFY_WINDOW_MS,
  cloudflareBody,
  CONFIDENCE_THRESHOLD,
  correctionRecord,
  credential,
  DEFAULT_CLASSIFY_CONFIG,
  defaultTopics,
  findProvider,
  JEV_DIRECT_ENDPOINT,
  mergeClassification,
  missingFields,
  needsClassification,
  ollamaTagsUrl,
  onReadersNetwork,
  readOllamaModels,
  parseClassifyResponse,
  providerLabel,
  providerReady,
  readClassifyConfig,
  resolveClassification,
  withField,
  type ClassifyConfig,
} from "./classify";
import type { ArticleClassification, ArticleTopic } from "./storage/types";

const AT = 1_700_000_000_000;

const topics: ArticleTopic[] = [
  { id: "news", slug: "news", label: "News", updatedAt: AT },
  { id: "technology", slug: "technology", label: "Technology", updatedAt: AT },
  { id: "science", slug: "science", label: "Science", updatedAt: AT },
];

const known = new Set(topics.map((topic) => topic.slug));

/** One closed choice question, as the sweep builds it. */
const input = buildClassifyRequest({ title: "A title", summary: "A summary" }, [
  { slug: "news", label: "News" },
]);

/** A successful Cloudflare Workers AI response, in the REST envelope. */
function cfResponse(answers: Record<string, unknown>) {
  return { result: { model: "jev-1.13.0", answers }, success: true, errors: [], messages: [] };
}

function choiceAnswer(overrides: Record<string, unknown> = {}) {
  return {
    topic: {
      type: "choice",
      choice: "technology",
      confidence: 0.81,
      probabilities: { technology: 0.72, science: 0.18, news: 0.1 },
      ...overrides,
    },
  };
}

describe("the classifier request", () => {
  it("offers a closed set, so the answer can only be one of the reader's topics", () => {
    const request = buildClassifyRequest(
      { title: "A title", summary: "A summary" },
      topics.map((topic) => ({ slug: topic.slug, label: topic.label })),
    );
    const question = request.questions.topic!;
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria).toSorted()).toEqual(["news", "science", "technology"]);
    expect(request.state.title).toBe("A title");
    expect(request.state.summary).toBe("A summary");
  });

  it("asks a publication which folder it belongs in, with its own prompt", () => {
    const request = buildClassifyRequest(
      { title: "Aeon", summary: "Essays on philosophy and culture." },
      [{ slug: "culture", label: "Culture" }],
      "folder",
    );
    // filed under the decision's own name, so the answer is unambiguous
    expect(Object.keys(request.questions)).toEqual(["folder"]);
    expect(request.questions.folder!.instructions).toMatch(/folder this publication/);
    expect(request.questions.folder!.criteria).toEqual({ culture: "Culture" });
  });

  it("puts the decision at the top level for Cloudflare, not under `input`", () => {
    const body = cloudflareBody("clef", input);
    expect(body).toEqual({
      model: "clef",
      state: { title: "A title", summary: "A summary", topics: [{ slug: "news", label: "News" }] },
      questions: {
        topic: { type: "choice", instructions: expect.any(String), criteria: { news: "News" } },
      },
    });
  });
});

/* ------------------------------------------------------------- providers */

describe("the classifier a reader picks", () => {
  /** A working local setup: the default address, and a model actually picked. */
  const local: ClassifyConfig = {
    ...DEFAULT_CLASSIFY_CONFIG,
    ollamaModel: "clef-flash:latest",
  };
  const cloudflare: ClassifyConfig = {
    ...DEFAULT_CLASSIFY_CONFIG,
    provider: "cloudflare",
    cloudflareModel: "clef",
    cloudflareAccountId: "account",
    keys: { cloudflare: "token" },
  };
  const openai: ClassifyConfig = {
    ...DEFAULT_CLASSIFY_CONFIG,
    provider: "openai",
    openaiModel: "gpt-6-luna-decisions",
    keys: { openai: "sk-live-1" },
  };

  it("is ordered by how widely used each one is", () => {
    expect(CLASSIFY_PROVIDERS.map((provider) => provider.id)).toEqual([
      "openai",
      "cloudflare",
      "typesafe",
      "ollama",
    ]);
    // the default is separate from the order: a local model needs no key
    expect(DEFAULT_CLASSIFY_CONFIG.provider).toBe("ollama");
  });

  it("starts on a local Ollama, which needs nothing filled in", () => {
    const ollama = findProvider("ollama")!;
    expect(providerReady(ollama, local)).toBe(true);
    expect(missingFields(ollama, local)).toEqual([]);
  });

  it("asks Ollama on its own decision endpoint, for the model the reader picked", () => {
    const call = findProvider("ollama")!.call(local, input);
    expect(call.url).toBe("http://localhost:11434/v1/systemone");
    expect(call.body).toEqual({
      model: "clef-flash:latest",
      state: { title: "A title", summary: "A summary", topics: [{ slug: "news", label: "News" }] },
      questions: {
        topic: { type: "choice", instructions: expect.any(String), criteria: { news: "News" } },
      },
    });
    // Ollama takes no credential, so nothing of the reader's is sent with it.
    expect(call.headers.authorization).toBeUndefined();
  });

  it("presumes no local model, so an unpicked one is a missing field", () => {
    const ollama = findProvider("ollama")!;
    // the address has a default, so it is never the one that is missing
    expect(DEFAULT_CLASSIFY_CONFIG.ollamaModel).toBe("");
    const unpicked: ClassifyConfig = { ...DEFAULT_CLASSIFY_CONFIG };
    expect(providerReady(ollama, unpicked)).toBe(false);
    expect(missingFields(ollama, unpicked).map((field) => field.label)).toEqual(["Model"]);
    // and the picker comes before the address, because it is the one that matters
    expect(ollama.fields.map((field) => field.key)).toEqual(["ollamaModel", "ollamaBaseUrl"]);

    expect(providerReady(ollama, local)).toBe(true);
    expect((ollama.call(local, input).body as { model: string }).model).toBe("clef-flash:latest");
  });

  it("follows an Ollama that listens somewhere other than localhost", () => {
    const moved = withField(local, "ollama", "ollamaBaseUrl", "http://gpu.box:11434/");
    expect(findProvider("ollama")!.call(moved, input).url).toBe(
      "http://gpu.box:11434/v1/systemone",
    );
  });

  it("sends a commercial transport the key the reader typed, and nothing else", () => {
    const call = findProvider("typesafe")!.call(
      withField(DEFAULT_CLASSIFY_CONFIG, "typesafe", "key", "  sk-live-1  "),
      input,
    );
    expect(call.url).toBe(JEV_DIRECT_ENDPOINT);
    expect(call.headers.authorization).toBe("Bearer sk-live-1");
  });

  it("runs the model the reader picked, in their own Cloudflare account", () => {
    const call = findProvider("cloudflare")!.call(cloudflare, input);
    expect(call.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account/ai/run/@cf/cloudflare/clef",
    );
    expect(call.headers.authorization).toBe("Bearer token");
    expect((call.body as { model: string }).model).toBe("clef");

    const flash = withField(cloudflare, "cloudflare", "cloudflareModel", "clef-flash");
    expect(findProvider("cloudflare")!.call(flash, input).url).toContain(
      "/ai/run/@cf/cloudflare/clef-flash",
    );
  });

  it("offers exactly the two decision models Workers AI publishes", () => {
    const field = findProvider("cloudflare")!.fields.find((f) => f.key === "cloudflareModel")!;
    expect(field.choices?.map((choice) => choice.value)).toEqual(["clef-flash", "clef"]);
    // and it is a required choice, not a free field with a default behind it
    expect(field.optional).toBeUndefined();
    expect(
      missingFields(findProvider("cloudflare")!, { ...DEFAULT_CLASSIFY_CONFIG }).map(
        (f) => f.label,
      ),
    ).toEqual(["Model", "Account ID", "API token"]);
  });

  it("keeps one key per transport, so switching back is not a retype", () => {
    const both = withField(cloudflare, "typesafe", "key", "ts-key");
    expect(credential(both, "cloudflare")).toBe("token");
    expect(credential(both, "typesafe")).toBe("ts-key");
    expect(credential(both, "ollama")).toBe("");
  });

  it("names what a transport is still missing, and only that", () => {
    const cloudflareProvider = findProvider("cloudflare")!;
    const half: ClassifyConfig = {
      ...DEFAULT_CLASSIFY_CONFIG,
      provider: "cloudflare",
      cloudflareAccountId: "account",
    };
    // the model is a required choice, so it is what a fresh reader is missing
    expect(providerReady(cloudflareProvider, half)).toBe(false);
    expect(missingFields(cloudflareProvider, half).map((field) => field.label)).toEqual([
      "Model",
      "API token",
    ]);
    expect(providerReady(cloudflareProvider, cloudflare)).toBe(true);
  });

  it("names each transport for the settings dialog and the status line", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("cloudflare")).toBe("Cloudflare Workers AI");
    expect(providerLabel("typesafe")).toBe("TypeSafe (Jev)");
    expect(providerLabel("ollama")).toBe("Ollama");
    expect(providerLabel(null)).toBeNull();
    expect(findProvider("nope")).toBeUndefined();
  });

  it("reads a reader's own configuration out of a request body", () => {
    expect(
      readClassifyConfig({
        provider: "openai",
        openaiBaseUrl: "  https://api.openai.com/v1  ",
        openaiModel: " gpt-6-luna-decisions ",
        cloudflareModel: " clef ",
        cloudflareAccountId: "account",
        ollamaBaseUrl: "http://localhost:11434",
        ollamaModel: " clef ",
        keys: { openai: " sk-live-1 ", typesafe: 7 },
      }),
    ).toEqual({
      provider: "openai",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-6-luna-decisions",
      cloudflareModel: "clef",
      cloudflareAccountId: "account",
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "clef",
      keys: { openai: "sk-live-1" },
    });
  });

  it("refuses a transport the table does not have", () => {
    expect(readClassifyConfig({ provider: "openai", keys: {} })).toBeDefined();
    expect(readClassifyConfig({ provider: "anthropic", keys: {} })).toBeUndefined();
    expect(readClassifyConfig({ keys: {} })).toBeUndefined();
    expect(readClassifyConfig(null)).toBeUndefined();
  });

  /* --------------------------------------------------------- OpenAI shape */

  it("asks OpenAI for a decision in its own format, not System One's", () => {
    const call = findProvider("openai")!.call(openai, input);
    expect(call.url).toBe("https://api.openai.com/v1/decisions");
    expect(call.headers.authorization).toBe("Bearer sk-live-1");
    expect(call.body).toEqual({
      model: "gpt-6-luna-decisions",
      input: JSON.stringify({
        title: "A title",
        summary: "A summary",
        topics: [{ slug: "news", label: "News" }],
      }),
      questions: [
        {
          type: "choice",
          name: "topic",
          instructions: expect.any(String),
          choices: [{ value: "news", description: "News" }],
        },
      ],
    });
  });

  it("follows an OpenAI-compatible gateway when the reader points at one", () => {
    const via = withField(openai, "openai", "openaiBaseUrl", "https://ai-gateway.vercel.sh/v1/");
    expect(findProvider("openai")!.call(via, input).url).toBe(
      "https://ai-gateway.vercel.sh/v1/decisions",
    );
  });

  it("reads an OpenAI answer, whose probabilities are pairs in a list", () => {
    const suggestion = findProvider("openai")!.read!(
      {
        model: "gpt-6-luna-decisions",
        answers: [
          {
            type: "choice",
            name: "topic",
            choice: "technology",
            confidence: 0.81,
            probabilities: [
              { value: "technology", probability: 0.72 },
              { value: "science", probability: 0.18 },
              { value: "news", probability: 0.1 },
            ],
          },
        ],
        usage: { input_tokens: 96, output_tokens: 0 },
      },
      known,
    );
    expect(suggestion.primarySlug).toBe("technology");
    expect(suggestion.topicSlugs).toContain("science");
    expect(suggestion.confidence).toBeCloseTo(0.81);
    expect(suggestion.model).toBe("gpt-6-luna-decisions");
  });

  it("refuses an OpenAI answer that ignores the reader's topic set", () => {
    expect(() =>
      findProvider("openai")!.read!(
        { answers: [{ name: "topic", choice: "sports", confidence: 0.9, probabilities: [] }] },
        known,
      ),
    ).toThrow(ClassifyError);
  });

  it("surfaces an OpenAI failure, which nests its message", () => {
    expect(() =>
      findProvider("openai")!.read!(
        { error: { message: "Image input isn't supported yet.", type: "invalid_request_error" } },
        known,
      ),
    ).toThrow(/Image input/);
  });

  /* ------------------------------------------------- can it be reached? */

  it("tells a local address from a public one, for the app and for the model", () => {
    // where the app is served from
    expect(onReadersNetwork("http://localhost:3000")).toBe(true);
    expect(onReadersNetwork("http://127.0.0.1:5200")).toBe(true);
    expect(onReadersNetwork("http://[::1]:3000")).toBe(true);
    expect(onReadersNetwork("http://firefly.local:3000")).toBe(true);
    expect(onReadersNetwork("http://192.168.1.20:3000")).toBe(true);
    expect(onReadersNetwork("http://10.0.0.4:3000")).toBe(true);
    expect(onReadersNetwork("http://172.16.0.9:3000")).toBe(true);

    // and where the model is
    expect(onReadersNetwork("http://localhost:11434")).toBe(true);
    expect(onReadersNetwork("http://gpu.box:11434")).toBe(false);
    expect(onReadersNetwork("https://ollama.example.com")).toBe(false);
    // a public address is reachable from anywhere, hosted or not
    expect(onReadersNetwork("https://ai-gateway.vercel.sh/v1")).toBe(false);
  });

  it("refuses anything it cannot parse rather than guessing", () => {
    expect(onReadersNetwork("")).toBe(false);
    expect(onReadersNetwork("localhost:11434")).toBe(false);
    expect(onReadersNetwork("not a url")).toBe(false);
  });

  /* ------------------------------------------------- the local model list */

  it("reads the decision models a local Ollama has pulled", () => {
    expect(
      readOllamaModels({
        models: [
          { name: "clef-flash:latest", capabilities: ["decision", "vision"] },
          { name: "llama3", capabilities: ["completion"] },
          { name: "clef", capabilities: ["decision"] },
          { name: "no-capabilities" },
        ],
      }),
    ).toEqual(["clef-flash:latest", "clef"]);
  });

  it("reports an empty list rather than guessing, when nothing is pulled", () => {
    expect(readOllamaModels({ models: [] })).toEqual([]);
    expect(readOllamaModels({})).toEqual([]);
    expect(readOllamaModels(null)).toEqual([]);
  });

  it("asks Ollama for its model list beside the decision endpoint", () => {
    expect(ollamaTagsUrl()).toBe("http://localhost:11434/api/tags");
    expect(ollamaTagsUrl("http://gpu.box:11434/")).toBe("http://gpu.box:11434/api/tags");
  });

  /* --------------------------------------------------- System One answers */

  it("reads an Ollama answer, which puts the answers at the top level", () => {
    const suggestion = parseClassifyResponse(
      {
        model: "clef-flash",
        answers: choiceAnswer(),
        usage: { input_tokens: 12, output_tokens: 1 },
      },
      known,
    );
    expect(suggestion.primarySlug).toBe("technology");
    expect(suggestion.model).toBe("clef-flash");
  });

  it("surfaces an Ollama failure instead of calling it a missing choice", () => {
    expect(() => parseClassifyResponse({ error: "model 'clef-flash' not found" }, known)).toThrow(
      /not found/,
    );
  });
});

/* -------------------------------------------------------- result validation */

describe("reading a Jev answer", () => {
  it("accepts a successful closed-set choice and keeps its secondary topics", () => {
    const suggestion = parseClassifyResponse(cfResponse(choiceAnswer()), known);
    expect(suggestion.primarySlug).toBe("technology");
    expect(suggestion.topicSlugs[0]).toBe("technology");
    expect(suggestion.topicSlugs).toContain("science");
    expect(suggestion.confidence).toBeCloseTo(0.81);
    expect(suggestion.model).toBe("jev-1.13.0");
  });

  it("also reads the direct Jev API's envelope", () => {
    const suggestion = parseClassifyResponse(
      { code: 0, message: "ok", data: { answers: choiceAnswer() } },
      known,
    );
    expect(suggestion.primarySlug).toBe("technology");
  });

  it("refuses a failed direct call rather than inventing an answer", () => {
    expect(() =>
      parseClassifyResponse({ code: -1, message: "Too many requests.", data: null }, known),
    ).toThrow(/Too many requests/);
  });

  it("refuses a Cloudflare failure with its own message", () => {
    expect(() =>
      parseClassifyResponse(
        {
          success: false,
          errors: [
            { code: 2021, message: "Insufficient balance; add money to your gateway or use BYOK" },
          ],
          result: {},
          messages: [],
        },
        known,
      ),
    ).toThrow(/Insufficient balance/);
  });

  it("refuses a choice outside the reader's own topic set", () => {
    const raw = cfResponse({ topic: { choice: "sports", confidence: 0.9 } });
    expect(() => parseClassifyResponse(raw, known)).toThrow(ClassifyError);
  });

  it("refuses a response with no choice at all", () => {
    expect(() => parseClassifyResponse(cfResponse({}), known)).toThrow(/did not choose/);
  });

  it("clamps a confidence the model reports out of range", () => {
    const raw = cfResponse(choiceAnswer({ choice: "news", confidence: 4 }));
    expect(parseClassifyResponse(raw, known).confidence).toBe(1);
  });
});

/* ----------------------------------------------------------- threshold gate */

describe("the confidence floor", () => {
  it("calls a confident answer a fact", () => {
    const parsed = parseClassifyResponse(cfResponse(choiceAnswer()), known);
    const outcome = resolveClassification(parsed, topics);
    expect(outcome.status).toBe("auto");
    expect(outcome.primaryTopicId).toBe("technology");
    expect(outcome.topicIds[0]).toBe("technology");
  });

  it("holds a weak answer as a question instead", () => {
    const raw = cfResponse(
      choiceAnswer({ choice: "news", confidence: CONFIDENCE_THRESHOLD - 0.01 }),
    );
    const outcome = resolveClassification(parseClassifyResponse(raw, known), topics);
    expect(outcome.status).toBe("needs_review");
    // the topic is still recorded — it is a suggestion, not silence
    expect(outcome.primaryTopicId).toBe("news");
  });

  it("treats the threshold itself as confident enough", () => {
    const raw = cfResponse(choiceAnswer({ choice: "news", confidence: CONFIDENCE_THRESHOLD }));
    expect(resolveClassification(parseClassifyResponse(raw, known), topics).status).toBe("auto");
  });
});

/* ------------------------------------------------------- correction wins */

describe("a reader's correction", () => {
  const fingerprint = articleFingerprint("A title", "A summary");
  const incoming = classificationFromOutcome(
    "s1~a",
    { primaryTopicId: "news", topicIds: ["news"], confidence: 0.9, status: "auto" },
    fingerprint,
    { at: AT },
  );

  it("overwrites an automatic result", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    const winner = mergeClassification(incoming, correction);
    expect(winner.status).toBe("confirmed");
    expect(winner.topicIds).toEqual(["science"]);
  });

  it("is never overwritten by a later automatic pass", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    const winner = mergeClassification(correction, incoming);
    expect(winner).toBe(correction);
    expect(winner.topicIds).toEqual(["science"]);
  });

  it("survives a change to the story's text, which would else re-classify it", () => {
    const correction = correctionRecord("s1~a", ["science"], fingerprint, AT + 1);
    expect(
      needsClassification({ title: "A new title", summary: "A summary" }, correction, topics),
    ).toBe(false);
  });

  it("re-classifies an automatic result when the text changes", () => {
    expect(
      needsClassification({ title: "A new title", summary: "A summary" }, incoming, topics),
    ).toBe(true);
    expect(needsClassification({ title: "A title", summary: "A summary" }, incoming, topics)).toBe(
      false,
    );
  });

  it("does nothing once the reader has rejected the classification", () => {
    const rejected: ArticleClassification = {
      ...incoming,
      status: "rejected",
      topicIds: [],
      primaryTopicId: undefined,
    };
    expect(needsClassification({ title: "x", summary: "y" }, rejected, topics)).toBe(false);
  });
});

/* -------------------------------------------------------------- misc */

describe("classification input", () => {
  it("uses the summary when there is one", () => {
    expect(
      classifyInputFor({ title: "T", summary: "S", body: [{ kind: "p", text: "Body" }] }),
    ).toEqual({ title: "T", summary: "S" });
  });

  it("falls back to an already-cached body and never fetches a new one", () => {
    expect(
      classifyInputFor({
        title: "T",
        summary: "",
        body: [
          { kind: "p", text: "First paragraph." },
          { kind: "p", text: "Second paragraph." },
        ],
      }),
    ).toEqual({ title: "T", summary: "First paragraph. Second paragraph." });
  });

  it("gives the fingerprint only two answers for the same text", () => {
    expect(articleFingerprint("A  Title", " A summary ")).toBe(
      articleFingerprint("a title", "a summary"),
    );
    expect(articleFingerprint("A title", "A summary")).not.toBe(
      articleFingerprint("A title", "A different summary"),
    );
  });

  it("offers a default topic set that is not empty and has unique slugs", () => {
    const seeded = defaultTopics(AT);
    expect(seeded.length).toBeGreaterThan(5);
    expect(new Set(seeded.map((topic) => topic.slug)).size).toBe(seeded.length);
    expect(seeded.every((topic) => topic.builtin === true)).toBe(true);
  });
});

/* ------------------------------------------------------------- pacing */

describe("classifier pacing", () => {
  it("sends immediately when nothing has been sent", () => {
    expect(classifyDelay([], AT)).toBe(0);
  });

  it("keeps a gap between calls", () => {
    expect(classifyDelay([AT - 1_000], AT)).toBe(CLASSIFY_MIN_INTERVAL_MS - 1_000);
    expect(classifyDelay([AT - CLASSIFY_MIN_INTERVAL_MS], AT)).toBe(0);
    // a call from long ago does not delay the next one
    expect(classifyDelay([AT - 10 * 60_000], AT)).toBe(0);
  });

  it("holds the line at a ceiling per rolling minute", () => {
    const recent = Array.from({ length: CLASSIFY_MAX_PER_MINUTE }, (_, i) => AT - i * 100);
    // the oldest of the burst only ages out of the window a minute after it
    expect(classifyDelay(recent, AT)).toBe(
      CLASSIFY_WINDOW_MS - (CLASSIFY_MAX_PER_MINUTE - 1) * 100,
    );
  });

  it("forgets calls that have left the window", () => {
    const stale = Array.from(
      { length: CLASSIFY_MAX_PER_MINUTE },
      () => AT - CLASSIFY_WINDOW_MS - 1,
    );
    expect(classifyDelay(stale, AT)).toBe(0);
  });
});
