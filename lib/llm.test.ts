import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_VERSION,
  CUSTOM_SERVICE,
  DEFAULT_LLM_CONFIG,
  LLM_SERVICES,
  endpointFor,
  effectiveWire,
  findService,
  llmFailure,
  llmFieldValue,
  missingFields,
  modelFor,
  readLlmConfig,
  readLlmText,
  readOllamaChatModels,
  serviceReady,
  withLlmField,
  type LlmConfig,
  type LlmMessage,
} from "./llm";

const MESSAGES: LlmMessage[] = [
  { role: "system", content: "You are the editor." },
  { role: "user", content: "Today's stories." },
];

function configFor(id: string, patch: Partial<LlmConfig> = {}): LlmConfig {
  return {
    ...DEFAULT_LLM_CONFIG,
    service: id as LlmConfig["service"],
    models: { [id]: "some-model" },
    keys: { [id]: "some-key" },
    ...patch,
  };
}

describe("the service table", () => {
  it("asks for a model and a key where the address is known, and for everything where it is not", () => {
    const openai = findService("openai");
    const anthropic = findService("anthropic");
    const custom = findService(CUSTOM_SERVICE);
    const ollama = findService("ollama");
    expect([openai, anthropic, custom, ollama].every(Boolean)).toBe(true);

    // The famous few carry their own address, so there is nothing to type but
    // the model and the key — which is the whole point of listing them.
    expect(openai?.fields.map((f) => f.key)).toEqual(["model", "key"]);
    expect(anthropic?.fields.map((f) => f.key)).toEqual(["model", "key"]);

    // "custom" is where a reader who has their own service ends up.
    expect(custom?.fields.map((f) => f.key)).toEqual(["wire", "baseUrl", "model", "key"]);

    // A local Ollama's address is the reader's to point elsewhere, but has a
    // default, so it is optional rather than required.
    const base = ollama?.fields.find((f) => f.key === "baseUrl");
    expect(base?.optional).toBe(true);
  });

  it("points a curated service at its own address and custom at the reader's", () => {
    expect(endpointFor(findService("openai")!, configFor("openai"))).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(endpointFor(findService("anthropic")!, configFor("anthropic"))).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    // An address of the reader's own: their format decides the path, and the
    // address is the origin the path is appended to — for Anthropic-compatible
    // that is the origin, not the /v1 under it.
    const custom = configFor(CUSTOM_SERVICE, {
      wire: "anthropic",
      baseUrl: "https://gateway.example",
      models: { [CUSTOM_SERVICE]: "m" },
      keys: { [CUSTOM_SERVICE]: "k" },
    });
    expect(endpointFor(findService(CUSTOM_SERVICE)!, custom)).toBe(
      "https://gateway.example/v1/messages",
    );
    expect(effectiveWire(findService(CUSTOM_SERVICE)!, custom)).toBe("anthropic");
  });

  it("falls back to where a local Ollama listens, and follows an address that moves", () => {
    const ollama = findService("ollama")!;
    // The reader points at Ollama's root; its API lives under /v1.
    expect(endpointFor(ollama, configFor("ollama", { baseUrl: "" }))).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(endpointFor(ollama, configFor("ollama", { baseUrl: "http://10.0.0.4:11434/" }))).toBe(
      "http://10.0.0.4:11434/v1/chat/completions",
    );
    // …and it is the one service the browser may call itself, because it is on
    // the reader's own machine and takes no key.
    expect(ollama.direct?.(configFor("ollama"))).toBe(true);
    expect(findService("openai")!.direct).toBeUndefined();
  });
});

describe("the two request shapes", () => {
  it("sends messages where an OpenAI-compatible service expects them", () => {
    const call = findService("openai")!.call(
      configFor("openai", { models: { openai: "gpt-4o-mini" } }),
      MESSAGES,
    );
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.headers.authorization).toBe("Bearer some-key");
    expect(call.body).toMatchObject({
      model: "gpt-4o-mini",
      max_tokens: expect.any(Number),
      messages: MESSAGES,
    });
  });

  it("moves the system prompt out of the messages for Anthropic", () => {
    const call = findService("anthropic")!.call(configFor("anthropic"), MESSAGES);
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe("some-key");
    expect(call.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(call.headers.authorization).toBeUndefined();
    // The only three differences that matter: system on top, max_tokens required.
    const body = call.body as { system?: string; messages: { role: string }[]; max_tokens: number };
    expect(body.system).toBe("You are the editor.");
    expect(body.messages.map((m) => m.role)).toEqual(["user"]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});

describe("keeping the reader's own values", () => {
  it("remembers the model and the key per service, so switching back is not a retype", () => {
    const modelField = { key: "model", label: "Model", placeholder: "" } as const;
    const keyField = { key: "key", label: "API key", placeholder: "" } as const;
    let config = withLlmField(configFor("deepseek"), modelField, "deepseek-chat");
    config = withLlmField(config, keyField, "sk-deepseek");
    config = { ...config, service: "openai" };
    // The new service starts clean rather than inheriting somebody else's model…
    expect(modelFor(config)).toBe("");
    // …and going back still has the old one.
    const back = { ...config, service: "deepseek" as const };
    expect(modelFor(back)).toBe("deepseek-chat");
    expect(back.keys.deepseek).toBe("sk-deepseek");
    expect(back.keys.openai).toBeUndefined();
  });

  it("says what is missing rather than calling a service half-built", () => {
    const openai = findService("openai")!;
    const empty: LlmConfig = { ...DEFAULT_LLM_CONFIG, service: "openai" };
    expect(missingFields(openai, empty).map((f) => f.key)).toEqual(["model", "key"]);
    expect(serviceReady(openai, empty)).toBe(false);
    expect(serviceReady(openai, configFor("openai"))).toBe(true);
  });
});

describe("reading an answer", () => {
  it("takes the text out of an OpenAI-compatible answer, including its parts shape", () => {
    expect(readLlmText({ choices: [{ message: { content: "Five stories." } }] }, "openai")).toBe(
      "Five stories.",
    );
    // Some gateways answer with typed parts rather than one string.
    expect(
      readLlmText(
        { choices: [{ message: { content: [{ text: "A" }, { text: "B" }] } }] },
        "openai",
      ),
    ).toBe("AB");
  });

  it("takes the text out of an Anthropic answer, blocks and all", () => {
    expect(
      readLlmText(
        {
          content: [
            { type: "text", text: "One." },
            { type: "tool_use" },
            { type: "text", text: "Two." },
          ],
        },
        "anthropic",
      ),
    ).toBe("One.\nTwo.");
    expect(readLlmText({ content: [{ type: "thinking", thinking: "?" }] }, "anthropic")).toBe("");
  });

  it("tells the reader whose fault a failure is", () => {
    const openai = findService("openai")!;
    const custom = findService(CUSTOM_SERVICE)!;

    expect(llmFailure(openai, configFor("openai"), 401, null)).toBe("OpenAI refused the key.");
    // A typo in an address the reader typed is theirs to find; a missing
    // endpoint on an address we chose is ours.
    expect(llmFailure(custom, configFor(CUSTOM_SERVICE), 404, null)).toMatch(/base URL/);
    expect(llmFailure(openai, configFor("openai"), 404, null)).not.toMatch(/base URL/);
    expect(llmFailure(openai, configFor("openai"), 429, null)).toMatch(/rate limiting/);
    // Anything else takes the upstream's own words, so the reader is not left
    // guessing at a generic refusal.
    expect(
      llmFailure(openai, configFor("openai"), 400, { error: { message: "model not found" } }),
    ).toBe("model not found");
  });
});

describe("a configuration arriving over the network", () => {
  it("believes a service only when the table offers it", () => {
    const known = readLlmConfig({ service: "deepseek", models: { deepseek: "deepseek-chat" } });
    expect(known.service).toBe("deepseek");
    expect(modelFor(known)).toBe("deepseek-chat");
    // A service the table does not offer is refused by falling back rather than
    // by being called with somebody else's shape.
    const unknown = readLlmConfig({ service: "evil-llm", models: { "evil-llm": "x" } });
    expect(unknown.service).toBe(DEFAULT_LLM_CONFIG.service);
    expect(modelFor(unknown)).toBe("");
  });

  it("offers only the models that can write, not the ones that can only decide", () => {
    expect(
      readOllamaChatModels({
        models: [
          { name: "llama3.2", capabilities: ["completion", "vision"] },
          { name: "clef-flash", capabilities: ["decision"] },
          { name: "qwen3", capabilities: ["completion"] },
        ],
      }),
    ).toEqual(["llama3.2", "qwen3"]);
  });
});

describe("the table itself", () => {
  it("keeps one entry per service, and every entry fills in only what it asks for", () => {
    const ids = LLM_SERVICES.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const service of LLM_SERVICES) {
      expect(service.fields.length).toBeGreaterThan(0);
      // Every field a service declares is one of the four the dialog renders.
      for (const field of service.fields) {
        expect(["wire", "baseUrl", "model", "key"]).toContain(field.key);
        expect(llmFieldValue(configFor(service.id), field)).toBeTypeOf("string");
      }
    }
  });
});
