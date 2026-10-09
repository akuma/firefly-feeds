import { blocksToText } from "./feed-html";
import { hashString } from "./hash";
import type { ArticleClassification, ArticleRecord, ArticleTopic } from "./storage/types";
import type { ClassificationStatus } from "./types";

/**
 * Article classification, kept as one pure module so the decision rules — what
 * counts as a valid answer, what confidence is enough to believe it, and when a
 * reader's correction outranks the classifier — are testable without a network,
 * a database or a DOM.
 *
 * It also holds the transport table: the decision APIs a reader can choose
 * between, what each one asks for, and where the call goes. The network call
 * itself belongs to `app/api/classify`, so the reader's page still never reaches
 * a third party directly.
 */

/**
 * Jev's own decision endpoint. The last of the three transports, tried only
 * when neither a local Ollama nor the Cloudflare account can answer — the
 * latter because an AI Gateway has no balance and no BYOK, for instance.
 */
export const JEV_DIRECT_ENDPOINT = "https://www.jevai.org/api/v1/decisions";

/**
 * The decision models Workers AI runs. Cloudflare trained these two itself and
 * hosts them under `@cf/cloudflare/…`, following the System One API: `clef-flash`
 * is the 9B one for the hot path, `clef` the 27B one for precision.
 */
export const CLOUDFLARE_MODELS = ["clef-flash", "clef"] as const;

export type CloudflareModel = (typeof CLOUDFLARE_MODELS)[number];

/** The Workers AI run endpoint for one account and one decision model. */
export function cloudflareRunUrl(accountId: string, model: string): string {
  const account = encodeURIComponent(accountId);
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${encodeURIComponent(model)}`;
}

/**
 * Where a local Ollama listens. Set `OLLAMA_BASE_URL` to point somewhere else
 * — another machine, a tunnel, a sidecar.
 */
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";

/** Ollama's decision endpoint. Same request and answer shape as Jev's own. */
export const OLLAMA_PATH = "/v1/systemone";

/** The full Ollama decision URL, with or without a trailing slash on the base. */
export function ollamaRunUrl(baseUrl?: string): string {
  return `${(baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "")}${OLLAMA_PATH}`;
}

/** Ollama's model list, which says what each pulled model can do. */
export const OLLAMA_TAGS_PATH = "/api/tags";

/** The full Ollama model-list URL, with or without a trailing slash. */
export function ollamaTagsUrl(baseUrl?: string): string {
  return `${(baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "")}${OLLAMA_TAGS_PATH}`;
}

/**
 * Whether a host is on the reader's own machine or network.
 *
 * Loopback, a `.local` name and the private ranges all count. It answers both
 * questions this feature has to ask — whether the app itself is served from the
 * reader's machine, and whether the Ollama it points at is — because a deployed
 * server can reach neither: asking it for `localhost` would be asking
 * Cloudflare's edge, not the reader.
 */
export function onReadersNetwork(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
  // IPv6 loopback, as `URL` reports it
  if (host === "[::1]" || host === "::1") return true;
  if (host.endsWith(".local")) return true;
  // 10.x, 192.168.x, and 172.16–31.x
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/** Where the OpenAI Decisions API lives. */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Its decision path, under that base. */
export const OPENAI_PATH = "/decisions";

/**
 * The model the OpenAI Decisions API is asked for. OpenAI has not published an
 * id for it, and gateways that implement the same shape use their own slug, so
 * the reader sets this one rather than the code guessing.
 */
export const OPENAI_DEFAULT_MODEL = "gpt-6-luna-decisions";

/**
 * Below this, the classifier is guessing and the reader is shown a question
 * rather than an answer. Chosen from Jev's own `confidence`, not from the
 * per-topic probability: a twelve-way choice spreads probability thin even
 * when the model is sure, so the answer's confidence is the honest signal.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** A second topic is only kept when the distribution actually supports it. */
export const SECONDARY_TOPIC_MIN = 0.12;

/** An article rarely has more than a couple of real subjects. */
export const MAX_TOPICS_PER_ARTICLE = 3;

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifyError";
  }
}

/* ------------------------------------------------------------ topic set */

type TopicSeed = { slug: string; label: string; description: string };

/**
 * The set given the first time classification is switched on. It is broader
 * than the source folders on purpose: a story can be filed under a technology
 * feed and still be about policy, or a culture feed and still be about books.
 *
 * `id` equals `slug` for the built-ins — a slug is already a stable, readable
 * key, and a rename only ever changes the label.
 */
export const DEFAULT_TOPIC_SEEDS: readonly TopicSeed[] = [
  { slug: "news", label: "News", description: "current events and breaking stories" },
  { slug: "politics", label: "Politics", description: "government, policy and public life" },
  { slug: "business", label: "Business", description: "companies, markets and the economy" },
  { slug: "science", label: "Science", description: "research, discovery and the natural world" },
  {
    slug: "technology",
    label: "Technology",
    description: "software, hardware, the internet and computing",
  },
  { slug: "ai", label: "AI", description: "artificial intelligence and machine learning" },
  { slug: "health", label: "Health", description: "medicine, public health and wellbeing" },
  { slug: "environment", label: "Environment", description: "climate, conservation and nature" },
  { slug: "culture", label: "Culture", description: "arts, film, music and society" },
  {
    slug: "design",
    label: "Design",
    description: "craft, typography, products and the built world",
  },
  { slug: "ideas", label: "Ideas", description: "essays, philosophy and argument" },
  { slug: "books", label: "Books", description: "books, writing and publishing" },
];

/** The built-in set as storable records, stamped with one write time. */
export function defaultTopics(at: number): ArticleTopic[] {
  return DEFAULT_TOPIC_SEEDS.map((seed) => ({
    id: seed.slug,
    slug: seed.slug,
    label: seed.label,
    description: seed.description,
    builtin: true,
    updatedAt: at,
  }));
}

/* ---------------------------------------------------------- fingerprint */

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * What "the same article text" means for classification. A title or summary
 * that changes gets a new fingerprint, so an automatic pass can run again — but
 * a reader's confirmation is never invalidated by it.
 */
export function articleFingerprint(title: string, summary: string): string {
  return hashString(`${normalise(title)}\u0000${normalise(summary)}`).toString(36);
}

/** The most text we send: enough to disambiguate, well inside Jev's 32KiB cap. */
const SUMMARY_LIMIT = 600;

/**
 * The classifier's input. The reader may have the full text, but classification
 * never fetches it: a cached body is used when it is already on disk, and a
 * summary-only story is judged on its summary. That keeps classification a
 * local, offline-capable pass rather than a second crawler.
 */
export function classifyInputFor(article: {
  title: string;
  summary: string;
  body: ArticleRecord["body"];
}): { title: string; summary: string } {
  const summary = article.summary.trim() || blocksToText(article.body);
  return { title: article.title, summary: summary.slice(0, SUMMARY_LIMIT) };
}

/* -------------------------------------------------------- request build */

export type ApiTopic = { slug: string; label: string; description?: string };

/** The one closed choice this app asks, whichever decision it is for. */
export type DecisionQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ClassifyInput = {
  state: { title: string; summary: string; topics: { slug: string; label: string }[] };
  /** One question, filed under the name of the decision being asked for. */
  questions: { [K in ClassifyQuestion]?: DecisionQuestion };
};

/**
 * The decisions this app asks for, each with its own prompt. A story gets a
 * topic; a publication gets a folder. Both are one closed choice over a set the
 * reader already has, which is what makes either of them a decision rather than
 * a guess.
 */
export type ClassifyQuestion = "topic" | "folder";

const INSTRUCTIONS: Record<ClassifyQuestion, string> = {
  topic:
    "Choose the single topic that best fits this article. Judge only from the " +
    "title and summary. If the text does not clearly support a topic, choose the " +
    "closest one but answer with low confidence.",
  folder:
    "Choose the single folder this publication belongs in. Judge only from its " +
    "name and description. If it does not clearly fit a folder, choose the " +
    "closest one but answer with low confidence.",
};

/**
 * The provider-agnostic decision: a state plus one closed-set choice question.
 * Every transport accepts the same decision; only the envelope around it — the
 * model name, and whether the decision sits at the top level — differs.
 */
export function buildClassifyRequest(
  input: { title: string; summary: string },
  topics: readonly ApiTopic[],
  question: ClassifyQuestion = "topic",
): ClassifyInput {
  const criteria: Record<string, string> = {};
  for (const topic of topics) {
    criteria[topic.slug] = topic.description
      ? `${topic.label} — ${topic.description}`
      : topic.label;
  }
  return {
    state: {
      title: input.title,
      summary: input.summary,
      topics: topics.map((topic) => ({ slug: topic.slug, label: topic.label })),
    },
    questions: {
      [question]: { type: "choice", instructions: INSTRUCTIONS[question], criteria },
    },
  };
}

/**
 * The Cloudflare Workers AI body: the model selector, then the decision itself at
 * the top level. Its decision endpoint does not nest the state and questions
 * under `input`, the way the older Workers AI models did.
 */
export function cloudflareBody(model: string, input: ClassifyInput) {
  return { model, ...input };
}

/**
 * The OpenAI Decisions body. Same decision, different shape: the state is a
 * single string rather than a structured object, and the one question is an
 * entry in a list with its options as pairs.
 */
export function openaiBody(
  config: ClassifyConfig,
  input: ClassifyInput,
): { model: string; input: string; questions: unknown[] } {
  const question = Object.values(input.questions)[0];
  if (!question) throw new ClassifyError("No question was asked.");
  return {
    model: config.openaiModel.trim() || OPENAI_DEFAULT_MODEL,
    input: JSON.stringify(input.state),
    questions: [
      {
        type: question.type,
        name: "topic",
        instructions: question.instructions,
        choices: Object.entries(question.criteria).map(([value, description]) => ({
          value,
          description,
        })),
      },
    ],
  };
}

/* ----------------------------------------------------------- providers */

/** The transports a reader can choose between in Settings. */
export type ClassifyProviderId = "openai" | "cloudflare" | "typesafe" | "ollama";

/** The settings a transport asks for, besides its credential. */
export type ClassifySettingKey =
  | "ollamaBaseUrl"
  | "ollamaModel"
  | "cloudflareModel"
  | "cloudflareAccountId"
  | "openaiBaseUrl"
  | "openaiModel";

/** Which part of a config a field edits: a named setting, or the credential. */
export type ClassifyFieldKey = ClassifySettingKey | "key";

/** One outbound call: where it goes, what it carries, how it authenticates. */
export type ProviderCall = {
  url: string;
  body: unknown;
  headers: Record<string, string>;
};

/**
 * The reader's classifier configuration, kept on this device and nowhere else.
 *
 * The commercial transports take a credential, so this is the one piece of
 * reading state that is a secret. It lives in local prefs, is sent to this
 * app's own endpoint rather than to the transport itself, and is never written
 * anywhere the reader did not put it.
 */
export type ClassifyConfig = {
  /** The transport that classifies new stories. */
  provider: ClassifyProviderId;
  /** Ollama: where it listens, and which local model answers. */
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Cloudflare: the decision model to run, and the account to run it in. */
  cloudflareModel: string;
  cloudflareAccountId: string;
  /** OpenAI: the Decisions API base, and the model to ask. */
  openaiBaseUrl: string;
  openaiModel: string;
  /** One credential per transport, so switching back is not a retype. */
  keys: Partial<Record<ClassifyProviderId, string>>;
};

/**
 * A local Ollama, which needs no credential, is what a reader gets by default —
 * so a reader who never opens Settings still sends nothing off the machine.
 */
export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  provider: "ollama",
  ollamaBaseUrl: OLLAMA_DEFAULT_BASE_URL,
  ollamaModel: "",
  cloudflareModel: "",
  cloudflareAccountId: "",
  openaiBaseUrl: OPENAI_DEFAULT_BASE_URL,
  openaiModel: OPENAI_DEFAULT_MODEL,
  keys: {},
};

/** One option in a picker field, for a transport whose choices can be listed. */
export type ClassifyChoice = { value: string; label: string };

/** One field the reader fills in for a transport. */
export type ClassifyField = {
  /** Which part of the config this writes to. */
  key: ClassifyFieldKey;
  label: string;
  /** The empty option of a picker, or the ghost text of a free field. */
  placeholder: string;
  hint?: string;
  /**
   * Rendered as a picker rather than free text. Filled in by the caller when the
   * choices are only known at runtime — which models a local Ollama has pulled,
   * for instance — and absent otherwise.
   */
  choices?: readonly ClassifyChoice[];
  /** A credential: shown as a password, and never worth logging. */
  secret?: boolean;
  /**
   * May be left empty, because this transport has a known default to fall back
   * on. A field with no sensible default — OpenAI's unpublished model id — is
   * required instead, so the reader is asked rather than guessed at.
   */
  optional?: boolean;
};

/**
 * A transport that can answer the decision.
 *
 * Most of them speak the System One wire format — a state plus one closed choice
 * question in, one slug and a confidence out — so a transport only states what
 * the reader fills in and where the call goes. One that answers differently
 * supplies its own `read`. Either way, adding a transport is one more entry in
 * `CLASSIFY_PROVIDERS`: the Settings dialog renders whatever fields are listed
 * here, and the route and the confidence floor are unchanged.
 */
export type ClassifyProvider = {
  id: ClassifyProviderId;
  /** The name a reader picks from. */
  label: string;
  /** What this transport is and what it costs, in one line. */
  blurb: string;
  /** What the reader fills in before this transport can be called. */
  fields: readonly ClassifyField[];
  /** The call to make. Only reached once every required field is filled. */
  call(config: ClassifyConfig, input: ClassifyInput): ProviderCall;
  /**
   * How this transport's answer is read. Omitted for the System One family,
   * which `parseClassifyResponse` already covers.
   */
  read?: (raw: unknown, knownSlugs: ReadonlySet<string>) => ClassifySuggestion;
};

/**
 * The transports on offer, ordered by how widely used they are: OpenAI first,
 * then Cloudflare, then the hosted TypeSafe API, and a local Ollama last because
 * it is not a service at all. The default in `DEFAULT_CLASSIFY_CONFIG` is still
 * Ollama — the order of this list is what a reader browses, not what a reader
 * gets.
 */
export const CLASSIFY_PROVIDERS: readonly ClassifyProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    blurb:
      "The Decisions API, in limited preview. Bills per call, and it is the only " +
      "one here that answers in its own format rather than System One's.",
    fields: [
      {
        key: "openaiBaseUrl",
        label: "Base URL",
        placeholder: OPENAI_DEFAULT_BASE_URL,
        hint: "Where the Decisions API lives. Point it at a gateway that speaks the OpenAI shape to use one of those instead.",
        optional: true,
      },
      {
        key: "openaiModel",
        label: "Model",
        placeholder: OPENAI_DEFAULT_MODEL,
        hint: "OpenAI has not published the model id, and gateways use their own slug, so this one is the reader's to set.",
      },
      { key: "key", label: "API key", placeholder: "sk-… from your OpenAI account", secret: true },
    ],
    call: (config, input) => ({
      url: `${(config.openaiBaseUrl.trim() || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "")}${OPENAI_PATH}`,
      body: openaiBody(config, input),
      headers: {
        authorization: `Bearer ${credential(config, "openai")}`,
        "content-type": "application/json",
      },
    }),
    read: parseOpenAIClassifyResponse,
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    blurb:
      "Cloudflare's own decision models, run inside your account. `clef-flash` is " +
      "the 9B one for the hot path, `clef` the 27B one for precision.",
    fields: [
      {
        key: "cloudflareModel",
        label: "Model",
        placeholder: "choose a model",
        // A closed, published set, so the picker is written down here rather than
        // discovered — unlike a local Ollama, whose list only it knows.
        choices: [
          { value: "clef-flash", label: "clef-flash — 9B, the fast one" },
          { value: "clef", label: "clef — 27B, the accurate one" },
        ],
      },
      {
        key: "cloudflareAccountId",
        label: "Account ID",
        placeholder: "the 32-character id from your Cloudflare dashboard",
      },
      {
        key: "key",
        label: "API token",
        placeholder: "a token with Workers AI permission",
        secret: true,
      },
    ],
    call: (config, input) => {
      const model = config.cloudflareModel.trim();
      return {
        url: cloudflareRunUrl(config.cloudflareAccountId, model),
        body: cloudflareBody(model, input),
        headers: {
          authorization: `Bearer ${credential(config, "cloudflare")}`,
          "content-type": "application/json",
        },
      };
    },
  },
  {
    id: "typesafe",
    label: "TypeSafe (Jev)",
    blurb: "The hosted decision API, from the team behind the format. Bills per call.",
    fields: [
      {
        key: "key",
        label: "API key",
        placeholder: "the key from your TypeSafe account",
        secret: true,
      },
    ],
    call: (config, input) => ({
      url: JEV_DIRECT_ENDPOINT,
      body: input,
      headers: {
        authorization: `Bearer ${credential(config, "typesafe")}`,
        "content-type": "application/json",
      },
    }),
  },
  {
    id: "ollama",
    label: "Ollama",
    blurb:
      "A decision model running on this machine. Free, no key, and a story never " +
      "leaves the device.",
    fields: [
      {
        key: "ollamaModel",
        label: "Model",
        placeholder: "choose a model",
        hint: "The decision models pulled on this machine, read from Ollama itself rather than assumed.",
      },
      {
        key: "ollamaBaseUrl",
        label: "Ollama address",
        placeholder: OLLAMA_DEFAULT_BASE_URL,
        hint: "Where Ollama listens. Leave it on localhost unless the model runs somewhere else.",
        optional: true,
      },
    ],
    call: (config, input) => ({
      url: ollamaRunUrl(config.ollamaBaseUrl),
      body: { model: config.ollamaModel.trim(), ...input },
      // Ollama takes no credential, and ignores one if it is sent.
      headers: { "content-type": "application/json" },
    }),
  },
];

/** The credential the reader kept for one transport, trimmed. */
export function credential(config: ClassifyConfig, id: ClassifyProviderId): string {
  return (config.keys[id] ?? "").trim();
}

/** What a field currently holds for one transport. */
export function fieldValue(
  config: ClassifyConfig,
  id: ClassifyProviderId,
  key: ClassifyFieldKey,
): string {
  if (key === "key") return config.keys[id] ?? "";
  return config[key];
}

/** The same config with one field rewritten. Everything else is left alone. */
export function withField(
  config: ClassifyConfig,
  id: ClassifyProviderId,
  key: ClassifyFieldKey,
  value: string,
): ClassifyConfig {
  if (key === "key") return { ...config, keys: { ...config.keys, [id]: value } };
  return { ...config, [key]: value };
}

/** The transport with this id, or undefined when Settings never offered it. */
export function findProvider(id: string | null | undefined): ClassifyProvider | undefined {
  return CLASSIFY_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Whether the reader's configuration is enough to call this transport: every
 * field that has no default is filled in.
 */
export function providerReady(provider: ClassifyProvider, config: ClassifyConfig): boolean {
  return provider.fields.every(
    (field) => field.optional === true || fieldValue(config, provider.id, field.key).trim() !== "",
  );
}

/** The fields still empty, in the order the reader is asked for them. */
export function missingFields(provider: ClassifyProvider, config: ClassifyConfig): ClassifyField[] {
  return provider.fields.filter(
    (field) => field.optional !== true && fieldValue(config, provider.id, field.key).trim() === "",
  );
}

/** The name a reader sees for the transport that answered. */
export function providerLabel(id: string | null | undefined): string | null {
  return findProvider(id)?.label ?? null;
}

/** A long enough ceiling for a key, an account id and an address. */
const MAX_CREDENTIAL = 512;
const MAX_ENDPOINT = 300;
const MAX_ACCOUNT = 64;
const MAX_MODEL = 128;

/**
 * The configuration out of a request body, or undefined when it is not one.
 *
 * The reader's own choices are validated here rather than trusted: an unknown
 * transport is refused, and every string is trimmed and capped, so a stray body
 * cannot turn the endpoint into a call to somewhere the table never named.
 */
export function readClassifyConfig(body: unknown): ClassifyConfig | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  const provider = findProvider(typeof record.provider === "string" ? record.provider : "");
  if (!provider) return undefined;

  const keys: Partial<Record<ClassifyProviderId, string>> = {};
  const rawKeys = asRecord(record.keys);
  for (const entry of CLASSIFY_PROVIDERS) {
    const value = rawKeys ? rawKeys[entry.id] : undefined;
    if (typeof value === "string") keys[entry.id] = value.trim().slice(0, MAX_CREDENTIAL);
  }

  return {
    provider: provider.id,
    ollamaBaseUrl: readSetting(record.ollamaBaseUrl, MAX_ENDPOINT) ?? "",
    ollamaModel: readSetting(record.ollamaModel, MAX_MODEL) ?? "",
    cloudflareModel: readSetting(record.cloudflareModel, MAX_MODEL) ?? "",
    cloudflareAccountId: readSetting(record.cloudflareAccountId, MAX_ACCOUNT) ?? "",
    openaiBaseUrl: readSetting(record.openaiBaseUrl, MAX_ENDPOINT) ?? "",
    openaiModel: readSetting(record.openaiModel, MAX_MODEL) ?? "",
    keys,
  };
}

function readSetting(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, limit) : undefined;
}

/* ---------------------------------------------------- local model list */

/**
 * The decision models a local Ollama has pulled, in the order it lists them.
 *
 * Ollama says what each model can do in `capabilities`, so a reader who has
 * pulled `clef`, `clef-flash`, `nimble` or anything else that answers decisions
 * sees exactly those — and a reader who has pulled none sees an empty list,
 * rather than a suggestion that would only fail. Nothing here presumes a
 * particular model exists.
 */
export function readOllamaModels(raw: unknown): string[] {
  const body = asRecord(raw);
  const models = Array.isArray(body?.models) ? body.models : [];
  const names: string[] = [];
  for (const entry of models) {
    const model = asRecord(entry);
    const name = typeof model?.name === "string" ? model.name : "";
    const capabilities = Array.isArray(model?.capabilities) ? model.capabilities : [];
    if (name && capabilities.includes("decision")) names.push(name);
  }
  return names;
}

/* ------------------------------------------------------- response parse */

export type ClassifySuggestion = {
  primarySlug: string;
  topicSlugs: string[];
  confidence: number;
  model?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function probabilityMap(value: unknown, knownSlugs: ReadonlySet<string>): Map<string, number> {
  const map = new Map<string, number>();
  const record = asRecord(value);
  if (!record) return map;
  for (const [slug, raw] of Object.entries(record)) {
    const probability = finiteNumber(raw);
    if (knownSlugs.has(slug) && probability !== undefined) map.set(slug, probability);
  }
  return map;
}

/** The same, for a transport that answers with a list of `{ value, probability }`. */
function probabilityPairs(value: unknown, knownSlugs: ReadonlySet<string>): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    const pair = asRecord(entry);
    const slug = typeof pair?.value === "string" ? pair.value : undefined;
    const probability = finiteNumber(pair?.probability);
    if (slug && knownSlugs.has(slug) && probability !== undefined) map.set(slug, probability);
  }
  return map;
}

/**
 * Turn a decision response into slugs, or refuse it. Anything that is not a
 * successful call with a known, closed-set choice is an error — the caller must
 * never guess on the classifier's behalf, and a topic outside the reader's own
 * set would be a fabricated answer.
 *
 * Every transport is accepted, because they all answer the same way. Cloudflare's
 * Workers AI REST envelope (`{ success, result: { model, answers } }`), the
 * direct Jev API's (`{ code, data: { answers } }`), and Ollama's plain
 * `{ model, answers }`. The Workers AI binding returns the answer at the top
 * level, which also falls through here.
 */
export function parseClassifyResponse(
  raw: unknown,
  knownSlugs: ReadonlySet<string>,
): ClassifySuggestion {
  const body = asRecord(raw);
  if (!body) throw new ClassifyError("The classifier returned an unreadable response.");

  if (body.success === false) {
    throw new ClassifyError(providerError(body) ?? "Cloudflare Workers AI refused the request.");
  }
  if (typeof body.code === "number" && body.code !== 0) {
    throw new ClassifyError(providerError(body) ?? "Jev refused the request.");
  }
  // Ollama reports a failure as a bare message, with no answers beside it.
  if (typeof body.error === "string" && body.error) {
    throw new ClassifyError(body.error);
  }

  const container = asRecord(body.result) ?? asRecord(body.data) ?? body;
  const answers = asRecord(container?.answers);
  // Exactly one question is ever asked, so the answer is the only entry.
  const answer = asRecord(Object.values(answers ?? {})[0]);
  const choice = typeof answer?.choice === "string" ? answer.choice : undefined;
  if (!choice || !knownSlugs.has(choice)) {
    throw new ClassifyError("Jev did not choose one of the offered topics.");
  }

  return suggestionFrom(
    choice,
    probabilityMap(answer?.probabilities, knownSlugs),
    answer?.confidence ?? container?.confidence,
    container?.model,
  );
}

/**
 * The suggestion both readers end on: the chosen topic, the runner-ups the
 * distribution actually supports, and the confidence that decides whether the
 * answer is a fact or a question.
 */
function suggestionFrom(
  choice: string,
  probabilities: Map<string, number>,
  confidence: unknown,
  model: unknown,
): ClassifySuggestion {
  const ranked = [...probabilities.entries()]
    .filter(([slug]) => slug !== choice)
    .filter(([, probability]) => probability >= SECONDARY_TOPIC_MIN)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS_PER_ARTICLE - 1)
    .map(([slug]) => slug);

  return {
    primarySlug: choice,
    topicSlugs: [choice, ...ranked],
    confidence: clamp01(finiteNumber(confidence) ?? probabilities.get(choice) ?? 0),
    ...(typeof model === "string" && model ? { model } : {}),
  };
}

/**
 * Read an OpenAI Decisions API answer.
 *
 * It is the same decision, shaped differently: the questions were sent as a
 * list, so the answers come back as a list, each naming its own question, and
 * the probabilities are pairs rather than a map. OpenAI nests its failures
 * under `error.message`, which the System One readers never see.
 */
export function parseOpenAIClassifyResponse(
  raw: unknown,
  knownSlugs: ReadonlySet<string>,
): ClassifySuggestion {
  const body = asRecord(raw);
  if (!body) throw new ClassifyError("The classifier returned an unreadable response.");

  const failure = asRecord(body.error);
  if (failure && typeof failure.message === "string" && failure.message) {
    throw new ClassifyError(failure.message);
  }

  const answers = Array.isArray(body.answers) ? body.answers : [];
  // One question, one answer; the name is whatever the caller asked under.
  const answer = answers.map(asRecord).find((entry) => entry?.type === "choice");
  const choice = typeof answer?.choice === "string" ? answer.choice : undefined;
  if (!choice || !knownSlugs.has(choice)) {
    throw new ClassifyError("OpenAI did not choose one of the offered topics.");
  }

  return suggestionFrom(
    choice,
    probabilityPairs(answer?.probabilities, knownSlugs),
    answer?.confidence,
    body.model,
  );
}

/** The first human-readable message, where each provider puts it. */
function providerError(body: Record<string, unknown>): string | undefined {
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = asRecord(errors[0]);
    const message = first && typeof first.message === "string" ? first.message : undefined;
    if (message) return message;
  }
  if (typeof body.error === "string" && body.error) return body.error;
  const nested = asRecord(body.error);
  if (nested && typeof nested.message === "string" && nested.message) return nested.message;
  return typeof body.message === "string" && body.message ? body.message : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* ----------------------------------------------------------- resolution */

export type ClassificationOutcome = {
  primaryTopicId: string;
  topicIds: string[];
  confidence: number;
  status: Extract<ClassificationStatus, "auto" | "needs_review">;
};

/**
 * Map the classifier's slugs onto the reader's topics and decide whether the
 * answer is a fact or a question.
 */
export function resolveClassification(
  suggestion: ClassifySuggestion,
  topics: readonly ArticleTopic[],
  threshold = CONFIDENCE_THRESHOLD,
): ClassificationOutcome {
  const bySlug = new Map(topics.map((topic) => [topic.slug, topic]));
  const primary = bySlug.get(suggestion.primarySlug);
  if (!primary) throw new ClassifyError("Jev chose a topic that is no longer in the set.");

  const topicIds = [primary.id];
  for (const slug of suggestion.topicSlugs) {
    if (topicIds.length >= MAX_TOPICS_PER_ARTICLE) break;
    const topic = bySlug.get(slug);
    if (topic && !topicIds.includes(topic.id)) topicIds.push(topic.id);
  }

  return {
    primaryTopicId: primary.id,
    topicIds,
    confidence: suggestion.confidence,
    status: suggestion.confidence >= threshold ? "auto" : "needs_review",
  };
}

/** Build the persistable record from an outcome, never before it is resolved. */
export function classificationFromOutcome(
  itemId: string,
  outcome: ClassificationOutcome,
  fingerprint: string,
  options: { model?: string; at?: number } = {},
): ArticleClassification {
  const record: ArticleClassification = {
    itemId,
    topicIds: outcome.topicIds,
    primaryTopicId: outcome.primaryTopicId,
    confidence: outcome.confidence,
    status: outcome.status,
    provider: "jev",
    contentFingerprint: fingerprint,
    updatedAt: options.at ?? Date.now(),
  };
  if (options.model) record.model = options.model;
  return record;
}

/** The record a reader's correction writes. It is never overwritten by `auto`. */
export function correctionRecord(
  itemId: string,
  topicIds: string[],
  fingerprint: string,
  at = Date.now(),
): ArticleClassification {
  const record: ArticleClassification = {
    itemId,
    topicIds,
    confidence: 1,
    status: "confirmed",
    provider: "jev",
    contentFingerprint: fingerprint,
    updatedAt: at,
  };
  if (topicIds[0]) record.primaryTopicId = topicIds[0];
  return record;
}

/* -------------------------------------------------------------- gating */

/**
 * Whether an automatic pass should run for this story.
 *
 * A story with no classification at all, or one whose text has changed since
 * it was classified, is a candidate. A story the reader has confirmed or
 * rejected is not: their answer outlives the text, and re-running would undo
 * the correction.
 */
export function needsClassification(
  article: { title: string; summary: string },
  existing: ArticleClassification | undefined,
  topics: readonly ArticleTopic[],
): boolean {
  if (topics.length === 0) return false;
  if (!existing || existing.deletedAt) return true;
  if (existing.status === "confirmed" || existing.status === "rejected") return false;
  return existing.contentFingerprint !== articleFingerprint(article.title, article.summary);
}

/**
 * Which record wins when an automatic result meets a stored one. Explicit and
 * small because it is the rule the whole feature rests on: a correction is not
 * a cache entry to be refreshed.
 */
export function mergeClassification(
  existing: ArticleClassification | undefined,
  incoming: ArticleClassification,
): ArticleClassification {
  if (
    existing &&
    !existing.deletedAt &&
    (existing.status === "confirmed" || existing.status === "rejected")
  ) {
    return existing;
  }
  return incoming;
}

/* ------------------------------------------------------------ pacing */

/**
 * How fast the client will ask the classifier for an answer.
 *
 * A backlog of stored stories is classified politely: a personal reader has no
 * reason to spend a shared Jev quota as fast as the network allows, and Jev
 * rate-limits per key. Two limits do the work — a gap between calls, and a
 * ceiling per rolling minute — so enabling classification on a large library
 * is a slow background trickle rather than a burst.
 */
export const CLASSIFY_MIN_INTERVAL_MS = 2_500;
export const CLASSIFY_MAX_PER_MINUTE = 12;
export const CLASSIFY_WINDOW_MS = 60_000;

/**
 * How long to wait before the next call, given the times of recent ones. Zero
 * means send now. Both limits are checked, so the stricter one wins.
 */
export function classifyDelay(recent: readonly number[], now: number): number {
  const withinWindow = recent.filter((at) => now - at < CLASSIFY_WINDOW_MS);
  const last = recent.length ? recent[recent.length - 1] : undefined;
  let delay = last === undefined ? 0 : Math.max(0, CLASSIFY_MIN_INTERVAL_MS - (now - last));
  if (withinWindow.length >= CLASSIFY_MAX_PER_MINUTE) {
    const oldest = Math.min(...withinWindow);
    delay = Math.max(delay, oldest + CLASSIFY_WINDOW_MS - now);
  }
  return delay;
}

/* ------------------------------------------------------- the proxy call */

export type ClassifyApiResult =
  | { ok: true; classification: ClassifySuggestion; provider?: string }
  | { ok: false; error: string };

/**
 * The browser's only way to reach the classifier. The reader's own choice of
 * transport travels in the body of a same-origin request to our own endpoint —
 * never to the transport itself, and never persisted anywhere server-side.
 * `provider` reports which transport answered.
 */
export async function requestClassification(input: {
  title: string;
  summary: string;
  topics: ApiTopic[];
  classifier: ClassifyConfig;
  /** Which decision to ask for. A story's topic, or a publication's folder. */
  question?: ClassifyQuestion;
}): Promise<ClassifyApiResult> {
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        summary: input.summary,
        topics: input.topics,
        question: input.question ?? "topic",
        ...input.classifier,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      classification?: ClassifySuggestion;
      provider?: string;
    };
    if (!data.ok || !data.classification) {
      return { ok: false, error: data.error ?? "Classification failed." };
    }
    return {
      ok: true,
      classification: data.classification,
      ...(data.provider ? { provider: data.provider } : {}),
    };
  } catch {
    return { ok: false, error: "Could not reach the classification service." };
  }
}
