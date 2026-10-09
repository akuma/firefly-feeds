import { onReadersNetwork, ollamaTagsUrl, type ProviderCall } from "./classify";

/**
 * The LLM transports a reader can bring their own key for.
 *
 * This is deliberately a different table from the decision transports in
 * `lib/classify.ts`, and deliberately the same *shape*: a decision API answers
 * one closed choice, which is what classification needs and what it is good at,
 * while a briefing is prose that has to be written. Sharing one table would mean
 * either teaching a decision model to write or making classification pay for a
 * chat model, and both are worse than two small tables.
 *
 * What is shared is the plumbing that is not about decisions at all — where a
 * local Ollama listens, whether an address is on the reader's own network, and
 * the pacing that keeps a reader's page from hammering anything. Those come from
 * `lib/classify.ts` rather than being written a second time.
 *
 * The reader fills in only what the chosen service asks for, and that list is
 * data: a service with a known address declares `model` and `key`, and only
 * "custom" declares a format and an address as well. The Settings dialog renders
 * whatever a service lists, so adding one is a row here and nothing else.
 */

/** The two wire formats. Every service here is one of these two. */
export type LlmWire = "openai" | "anthropic";

/** Where a service ends and the reader's own configuration begins. */
export const CUSTOM_SERVICE = "custom";

export type LlmServiceId =
  | "ollama"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "moonshot"
  | "qwen"
  | "glm"
  | typeof CUSTOM_SERVICE;

/**
 * The reader's setup, kept on this device and nowhere else.
 *
 * The model and the key are remembered **per service** rather than as single
 * values, because switching from one service to another and back should not
 * mean retyping either — a model name is not portable between them, and a key
 * is a secret the reader should type once. The address is shared, because only
 * two services ask for one and the reader rarely runs both at once.
 */
export type LlmConfig = {
  service: LlmServiceId;
  /** Only read for "custom": which of the two formats the address speaks. */
  wire: LlmWire;
  /** Only read for "custom", and for a local Ollama pointed somewhere else. */
  baseUrl: string;
  models: Partial<Record<string, string>>;
  keys: Partial<Record<string, string>>;
};

export type LlmMessage = { role: "system" | "user"; content: string };

/** One thing the reader fills in. Rendered from the service's own entry. */
export type LlmField = {
  key: "wire" | "baseUrl" | "model" | "key";
  label: string;
  placeholder: string;
  hint?: string;
  /** A closed set of choices, rendered as a picker rather than free text. */
  choices?: readonly { value: string; label: string }[];
  /** A credential: a password field, and never worth logging. */
  secret?: boolean;
  /** May be left empty, because the service has a default to fall back on. */
  optional?: boolean;
};

export type LlmService = {
  id: LlmServiceId;
  /** The name a reader picks from. */
  label: string;
  /** What this service is and what it costs, in one line. */
  blurb: string;
  /** Which of the two formats it speaks. */
  wire: LlmWire;
  /**
   * The address, when the reader never types one. Absent for a local Ollama,
   * whose address is the reader's to point elsewhere, and for "custom".
   */
  baseUrl?: string;
  /**
   * The path under that address, when the format's own is not right for it.
   * A local Ollama answers its OpenAI-compatible API under `/v1` while the
   * address a reader points at is its root, so the `/v1` belongs to the path.
   */
  path?: string;
  fields: readonly LlmField[];
  call(config: LlmConfig, messages: readonly LlmMessage[]): ProviderCall;
  /**
   * Whether the browser may call this service itself. True only for one that
   * needs no credential and sits on the reader's own network — a local Ollama,
   * the one address our own server cannot reach on the reader's behalf.
   */
  direct?: (config: LlmConfig) => boolean;
};

/** Ollama's own address, without the `/v1` its OpenAI-compatible API adds. */
export const OLLAMA_BASE = "http://localhost:11434";

/**
 * A local Ollama is what a reader gets by default, so a reader who never opens
 * Settings still sends nothing off the machine.
 */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  service: "ollama",
  wire: "openai",
  baseUrl: "",
  models: {},
  keys: {},
};

/** The chat path each format answers on, under whatever base it was given. */
const WIRE_PATH: Record<LlmWire, string> = {
  openai: "/chat/completions",
  anthropic: "/v1/messages",
};

/** Anthropic pins its API version in a header rather than in the path. */
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * An editorial task, not a creative one: the same list should produce the same
 * edition twice over, and a reader checking a gist against the summary it came
 * from should not find the model improvising.
 */
export const LLM_TEMPERATURE = 0.3;

/**
 * Five gists and five reasons, and a ceiling on a runaway answer. It is half of
 * this feature's cost control — `DIGEST_MAX_CANDIDATES` in `lib/digest.ts` is
 * the other half.
 */
export const LLM_MAX_TOKENS = 800;

/**
 * A current model id per service, as a placeholder and nothing more.
 *
 * Model names churn faster than this app ships, so the field stays free text: a
 * hard-coded picker would go stale and then be a dead end, while a placeholder
 * that is a year old still tells a reader what shape of name to type.
 */
const MODEL_HINT: Record<Exclude<LlmServiceId, "ollama" | typeof CUSTOM_SERVICE>, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  deepseek: "deepseek-chat",
  moonshot: "moonshot-v1-8k",
  qwen: "qwen-plus",
  glm: "glm-4-air",
};

/** The fields a service asks for. */
function fieldsFor(seed: ServiceSeed): readonly LlmField[] {
  if (seed.id === "ollama") {
    return [
      {
        key: "model",
        label: "Model",
        placeholder: "choose a model",
        hint: "The models pulled on this machine, read from Ollama itself rather than assumed.",
      },
      {
        key: "baseUrl",
        label: "Ollama address",
        placeholder: OLLAMA_BASE,
        hint: "Where Ollama listens. Leave it on localhost unless the model runs somewhere else.",
        optional: true,
      },
    ];
  }
  if (seed.id === CUSTOM_SERVICE) {
    return [
      {
        key: "wire",
        label: "Format",
        placeholder: "choose a format",
        choices: [
          { value: "openai", label: "OpenAI-compatible — /chat/completions" },
          { value: "anthropic", label: "Anthropic-compatible — /v1/messages" },
        ],
      },
      {
        key: "baseUrl",
        label: "Base URL",
        placeholder: "https://…",
        hint:
          "The address the format's path is appended to. OpenAI-compatible usually " +
          "ends in /v1; Anthropic-compatible is usually the origin without one.",
      },
      { key: "model", label: "Model", placeholder: "the model this service exposes" },
      { key: "key", label: "API key", placeholder: "the key from your account", secret: true },
    ];
  }
  return [
    { key: "model", label: "Model", placeholder: MODEL_HINT[seed.id] },
    { key: "key", label: "API key", placeholder: "the key from your account", secret: true },
  ];
}

/* ------------------------------------------------------------- accessors */

/** The credential the reader kept for one service, trimmed. */
export function credential(config: LlmConfig, id: string): string {
  return config.keys[id]?.trim() ?? "";
}

/** The model the reader chose for the service that is active. */
export function modelFor(config: LlmConfig): string {
  return config.models[config.service]?.trim() ?? "";
}

/**
 * Which format a call is actually made in. "custom" is the reader's choice;
 * every other service's format is a fact about that service.
 */
export function effectiveWire(service: LlmService, config: LlmConfig): LlmWire {
  return config.service === CUSTOM_SERVICE ? config.wire : service.wire;
}

/** The base address a call goes to: the service's own, or the reader's. */
export function baseUrlFor(service: LlmService, config: LlmConfig): string {
  // A service with a known address keeps it. The two that let the reader set
  // one — a local Ollama, and "custom" — read the reader's, and Ollama falls
  // back to where it listens by default so an untouched field still works.
  const typed = config.baseUrl.trim();
  const base = service.baseUrl ?? (typed || (service.id === "ollama" ? OLLAMA_BASE : ""));
  return base.replace(/\/+$/, "");
}

/** The full endpoint for one service and one reader configuration. */
export function endpointFor(service: LlmService, config: LlmConfig): string {
  const path = service.path ?? WIRE_PATH[effectiveWire(service, config)];
  return `${baseUrlFor(service, config)}${path}`;
}

export function findService(id: string | null | undefined): LlmService | undefined {
  return LLM_SERVICES.find((service) => service.id === id);
}

export function serviceLabel(id: string | null | undefined): string | null {
  return findService(id)?.label ?? null;
}

/* ----------------------------------------------------------------- bodies */

function openAIBody(config: LlmConfig, messages: readonly LlmMessage[]) {
  return {
    model: modelFor(config),
    temperature: LLM_TEMPERATURE,
    max_tokens: LLM_MAX_TOKENS,
    messages: messages.map((message) => ({ ...message })),
  };
}

/**
 * Anthropic's shape: the system prompt is a top-level field rather than a
 * message, `max_tokens` is required rather than optional, and the version is
 * pinned in a header. Those are the only three differences that matter.
 */
function anthropicBody(config: LlmConfig, messages: readonly LlmMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    model: modelFor(config),
    temperature: LLM_TEMPERATURE,
    max_tokens: LLM_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ ...message })),
  };
}

/** One implementation for every service in a format, since they differ only in address. */
function serviceCall(
  service: LlmService,
  config: LlmConfig,
  messages: readonly LlmMessage[],
): ProviderCall {
  const anthropic = effectiveWire(service, config) === "anthropic";
  return {
    url: endpointFor(service, config),
    body: anthropic ? anthropicBody(config, messages) : openAIBody(config, messages),
    headers: anthropic
      ? {
          "x-api-key": credential(config, config.service),
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        }
      : {
          authorization: `Bearer ${credential(config, config.service)}`,
          "content-type": "application/json",
        },
  };
}

/* ---------------------------------------------------------------- reading */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A `content` that is either a string or a list of typed parts. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(asRecord)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

/**
 * The text out of an answer, in whichever shape the format uses.
 *
 * Reading belongs to the format rather than to the service, which is why it is
 * a function of the wire and not a field on the table: "custom" is Anthropic-
 * compatible exactly when the reader says it is.
 */
export function readLlmText(raw: unknown, wire: LlmWire): string {
  if (wire === "anthropic") {
    const blocks = asRecord(raw)?.content;
    if (!Array.isArray(blocks)) return "";
    return blocks
      .map(asRecord)
      .filter((block) => block?.type === "text")
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  const choices = asRecord(raw)?.choices;
  if (!Array.isArray(choices)) return "";
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  return textOf(message?.content ?? first?.text);
}

/** The first human-readable message in an upstream error body. */
export function llmErrorText(raw: unknown): string | undefined {
  const body = asRecord(raw);
  if (!body) return undefined;
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = asRecord(errors[0]);
    if (typeof first?.message === "string" && first.message) return first.message;
  }
  if (typeof body.error === "string" && body.error) return body.error;
  const nested = asRecord(body.error);
  if (typeof nested?.message === "string" && nested.message) return nested.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return undefined;
}

/**
 * What a reader is told when a service refuses. Written per service rather than
 * per status code, because the useful next step differs: a 404 on an address the
 * reader typed is their typo, and a 404 on an address we chose is ours to fix.
 */
export function llmFailure(
  service: LlmService,
  config: LlmConfig,
  status: number,
  raw: unknown,
): string {
  if (status === 401 || status === 403) return `${service.label} refused the key.`;
  if (status === 429) return `${service.label} is rate limiting requests.`;
  if (status === 404) {
    return config.service === CUSTOM_SERVICE
      ? "That address does not answer chat completions. Check the base URL."
      : `${service.label} did not answer at its usual address.`;
  }
  return llmErrorText(raw) ?? `${service.label} refused the request.`;
}

/* ------------------------------------------------------------------ table */

type ServiceSeed = Omit<LlmService, "fields" | "call" | "direct">;

/**
 * The services on offer.
 *
 * The famous few carry their own address, so a reader picks one and fills in a
 * model and a key. Everything else — including services just as well known, like
 * OpenRouter or Groq — goes through "custom", because a row here is a promise to
 * keep that address current, and one entry that covers every OpenAI-compatible
 * service is a cheaper promise than ten.
 */
export const LLM_SERVICES: readonly LlmService[] = (
  [
    {
      id: "ollama",
      label: "Ollama",
      blurb: "A model running on this machine. Free, no key, and a story never leaves the device.",
      wire: "openai",
      // The address a reader points at is Ollama's root; its OpenAI-compatible
      // API lives under `/v1`, so the `/v1` belongs here rather than in what
      // the reader types.
      path: "/v1/chat/completions",
    },
    {
      id: "openai",
      label: "OpenAI",
      blurb: "OpenAI's chat models, billed to your own account.",
      wire: "openai",
      baseUrl: "https://api.openai.com/v1",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      blurb: "Claude, billed to your own account.",
      wire: "anthropic",
      baseUrl: "https://api.anthropic.com",
    },
    {
      id: "deepseek",
      label: "DeepSeek",
      blurb: "DeepSeek's chat models, on their OpenAI-compatible endpoint.",
      wire: "openai",
      baseUrl: "https://api.deepseek.com/v1",
    },
    {
      id: "moonshot",
      label: "Moonshot (Kimi)",
      blurb: "Kimi, on Moonshot's OpenAI-compatible endpoint.",
      wire: "openai",
      baseUrl: "https://api.moonshot.cn/v1",
    },
    {
      id: "qwen",
      label: "通义千问 (Qwen)",
      blurb: "Qwen, on DashScope's OpenAI-compatible endpoint.",
      wire: "openai",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
      id: "glm",
      label: "智谱 GLM",
      blurb: "GLM, on Zhipu's OpenAI-compatible endpoint.",
      wire: "openai",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    },
    {
      id: CUSTOM_SERVICE,
      label: "Custom…",
      blurb:
        "Any service that speaks one of the two formats. You choose the format and set the address.",
      wire: "openai",
    },
  ] satisfies readonly ServiceSeed[]
).map((seed) => {
  // The entry refers to itself, which is safe because `call` and `direct` only
  // run long after the table has been built.
  const service: LlmService = {
    ...seed,
    fields: fieldsFor(seed),
    call: (config, messages) => serviceCall(service, config, messages),
    ...(seed.id === "ollama"
      ? { direct: (config: LlmConfig) => onReadersNetwork(baseUrlFor(service, config)) }
      : {}),
  };
  return service;
});

/* --------------------------------------------------------------- readiness */

/** The value a field edits, read back out of a configuration. */
export function llmFieldValue(config: LlmConfig, field: LlmField): string {
  switch (field.key) {
    case "wire":
      return config.wire;
    case "baseUrl":
      return config.baseUrl;
    case "model":
      return modelFor(config);
    case "key":
      return credential(config, config.service);
  }
}

/** The same configuration with one field written. */
export function withLlmField(config: LlmConfig, field: LlmField, value: string): LlmConfig {
  switch (field.key) {
    case "wire":
      return { ...config, wire: value === "anthropic" ? "anthropic" : "openai" };
    case "baseUrl":
      return { ...config, baseUrl: value };
    case "model":
      return { ...config, models: { ...config.models, [config.service]: value } };
    case "key":
      return { ...config, keys: { ...config.keys, [config.service]: value } };
  }
}

/** Whether this service can be called with what the reader has filled in. */
export function serviceReady(service: LlmService, config: LlmConfig): boolean {
  return missingFields(service, config).length === 0;
}

/** The required fields still empty, so a reader is told what is missing. */
export function missingFields(service: LlmService, config: LlmConfig): readonly LlmField[] {
  return service.fields.filter((field) => !field.optional && !llmFieldValue(config, field).trim());
}

/* ------------------------------------------------------- request from body */

const MAX_CREDENTIAL = 512;
const MAX_ENDPOINT = 300;
const MAX_MODEL = 128;

function readString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * The reader's configuration out of a request body, with the defaults filled in.
 *
 * This is the one place a service id arriving over the network is believed, so
 * it is validated here rather than trusted: a service the table does not offer
 * falls back to the default, and the route refuses a configuration that is not
 * ready rather than calling it half-built.
 */
function readMap(raw: unknown, limit: number): Partial<Record<string, string>> {
  const map: Partial<Record<string, string>> = {};
  const stored = asRecord(raw);
  if (!stored) return map;
  for (const [id, value] of Object.entries(stored)) {
    const text = readString(value, limit);
    if (text) map[id] = text;
  }
  return map;
}

export function readLlmConfig(raw: unknown): LlmConfig {
  const body = asRecord(raw) ?? {};
  const service = typeof body.service === "string" ? body.service : "";
  return {
    service: findService(service) ? (service as LlmServiceId) : DEFAULT_LLM_CONFIG.service,
    wire: body.wire === "anthropic" ? "anthropic" : "openai",
    baseUrl: readString(body.baseUrl, MAX_ENDPOINT),
    models: readMap(body.models, MAX_MODEL),
    keys: readMap(body.keys, MAX_CREDENTIAL),
  };
}

/* ------------------------------------------------------------ local models */

/**
 * The chat models a local Ollama has pulled, in the order it lists them.
 *
 * Ollama says what each model can do in its `capabilities`, so a reader who has
 * pulled a chat model sees exactly those — and a reader who has pulled none sees
 * an empty list rather than a suggestion that would only fail. `completion`, not
 * `decision`: a model that can only answer a closed choice cannot write prose.
 */
export function readOllamaChatModels(raw: unknown): string[] {
  const body = asRecord(raw);
  const models = Array.isArray(body?.models) ? body.models : [];
  const names: string[] = [];
  for (const entry of models) {
    const model = asRecord(entry);
    const name = typeof model?.name === "string" ? model.name : "";
    const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
    if (name && capabilities.includes("completion")) names.push(name);
  }
  return names;
}

/** Ollama's model list, for the picker that asks our own origin for it. */
export function ollamaChatModelsUrl(baseUrl?: string): string {
  return ollamaTagsUrl(baseUrl);
}
