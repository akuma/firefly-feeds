import {
  buildClassifyRequest,
  ClassifyError,
  findProvider,
  missingFields,
  parseClassifyResponse,
  providerReady,
  readClassifyConfig,
  type ApiTopic,
  type ClassifyConfig,
  type ClassifyInput,
  type ClassifyProvider,
  type ClassifyProviderId,
  type ClassifyQuestion,
  type ClassifySuggestion,
} from "@/lib/classify";
import { fromAnotherSite, withinRateLimit } from "../guards";

export const dynamic = "force-dynamic";

/** A topic set the size of the built-ins, with room for the reader's own. */
const MAX_TOPICS = 24;
const MAX_TITLE = 300;
const MAX_SUMMARY = 2_000;
const MAX_LABEL = 80;
const TIMEOUT_MS = 20_000;

/** Shown when the body names a transport the table does not have. */
const UNKNOWN_PROVIDER = "Choose a classifier in Settings.";

/**
 * Classification, proxied.
 *
 * The browser cannot call a decision API itself: the reader's credential would
 * be handed to a third-party origin straight from our page. So the request goes
 * to our own origin, the call happens here, and only the slugs come back. The
 * endpoint is never a general proxy — it accepts a title, a summary, a closed
 * topic set and the reader's own choice of transport, nothing else.
 *
 * There is no server-side configuration. The reader picks the transport in
 * Settings and it arrives with the request, so a key is never stored here and
 * this app can be deployed with no secrets at all. `CLASSIFY_PROVIDERS` in
 * `lib/classify.ts` is the whole list of what can be picked — OpenAI's Decisions
 * API, Cloudflare Workers AI in the reader's own account, the hosted TypeSafe
 * (Jev) API, or a decision model on a local Ollama — and each entry states what
 * the reader fills in and where the call goes. A transport the reader has not
 * finished setting up is refused here rather than called half-built.
 *
 *   POST /api/classify   → one article, one closed-set choice
 */

export async function POST(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }

  if (!(await withinRateLimit(request, "JEV_CLASSIFY"))) {
    return Response.json(
      { ok: false, error: "Too many classification requests. Give it a minute and try again." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = readInput(body);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const provider = findProvider(parsed.classifier.provider);
  if (!provider) {
    return Response.json({ ok: false, error: UNKNOWN_PROVIDER }, { status: 400 });
  }
  // Refused rather than called half-built: a transport with no account or no key
  // would only answer with somebody else's error message.
  if (!providerReady(provider, parsed.classifier)) {
    const missing = missingFields(provider, parsed.classifier).map((field) => field.label);
    return Response.json(
      { ok: false, error: `${provider.label} still needs: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const input = buildClassifyRequest(
    { title: parsed.title, summary: parsed.summary },
    parsed.topics,
    parsed.question,
  );
  const knownSlugs = new Set(parsed.topics.map((topic) => topic.slug));

  const result = await callProvider(provider, parsed.classifier, input, knownSlugs);
  if (result.ok) return success(result.suggestion, provider.id);
  return Response.json({ ok: false, error: result.error }, { status: result.status });
}

/* --------------------------------------------------------------- upstream */

type UpstreamFailure = { ok: false; status: number; error: string };
type Upstream = { ok: true; suggestion: ClassifySuggestion } | UpstreamFailure;

function success(suggestion: ClassifySuggestion, provider: ClassifyProviderId): Response {
  return Response.json(
    { ok: true, classification: suggestion, provider },
    { headers: { "cache-control": "no-store" } },
  );
}

async function callProvider(
  provider: ClassifyProvider,
  classifier: ClassifyConfig,
  input: ClassifyInput,
  knownSlugs: ReadonlySet<string>,
): Promise<Upstream> {
  const call = provider.call(classifier, input);
  try {
    const res = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw: unknown = await res.json().catch(() => null);

    if (res.status === 429) {
      return { ok: false, status: 429, error: `${provider.label} is rate limiting requests.` };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: readProviderError(raw) ?? `${provider.label} refused the request.`,
      };
    }
    return { ok: true, suggestion: parseResponse(provider, raw, knownSlugs) };
  } catch (error) {
    if (error instanceof ClassifyError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 502, error: `Could not reach ${provider.label}.` };
  }
}

/** Each transport reads its own answer; the System One family shares one. */
function parseResponse(
  provider: ClassifyProvider,
  raw: unknown,
  knownSlugs: ReadonlySet<string>,
): ClassifySuggestion {
  return provider.read ? provider.read(raw, knownSlugs) : parseClassifyResponse(raw, knownSlugs);
}

/** The first human-readable message in a Cloudflare, TypeSafe or Ollama body. */
function readProviderError(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const errors = record.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = errors[0];
    if (typeof first === "object" && first !== null) {
      const message = (first as Record<string, unknown>).message;
      if (typeof message === "string" && message) return message;
    }
  }
  if (typeof record.error === "string" && record.error) return record.error;
  return typeof record.message === "string" && record.message ? record.message : undefined;
}

function denied() {
  return Response.json(
    { ok: false, error: "This endpoint only serves the Firefly Feeds application." },
    { status: 403 },
  );
}

/* ---------------------------------------------------------------- input */

type ReadInput =
  | {
      ok: true;
      title: string;
      summary: string;
      topics: ApiTopic[];
      classifier: ClassifyConfig;
      question: ClassifyQuestion;
    }
  | { ok: false; error: string };

/**
 * Validate before anything leaves the server. The topic set is the reader's,
 * so it is checked here rather than trusted: a closed set is the whole reason
 * this classification is not a free-form guess.
 */
function readInput(body: unknown): ReadInput {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!title) return { ok: false, error: "A story title is required." };
  if (title.length > MAX_TITLE) return { ok: false, error: "That title is too long." };
  if (summary.length > MAX_SUMMARY) return { ok: false, error: "That summary is too long." };

  if (!Array.isArray(record.topics) || record.topics.length === 0) {
    return { ok: false, error: "At least one topic is required." };
  }
  if (record.topics.length > MAX_TOPICS) {
    return { ok: false, error: `Keep the topic set to ${MAX_TOPICS} or fewer.` };
  }

  const topics: ApiTopic[] = [];
  const seen = new Set<string>();
  for (const entry of record.topics) {
    const topic =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const slug = typeof topic.slug === "string" ? topic.slug.trim() : "";
    const label = typeof topic.label === "string" ? topic.label.trim() : "";
    if (!slug || !label) return { ok: false, error: "Every topic needs a slug and a label." };
    if (label.length > MAX_LABEL) return { ok: false, error: "That topic label is too long." };
    if (seen.has(slug)) return { ok: false, error: "Topic slugs must be unique." };
    seen.add(slug);
    const description =
      typeof topic.description === "string" ? topic.description.trim().slice(0, 200) : "";
    topics.push(description ? { slug, label, description } : { slug, label });
  }

  // The reader's own choice of transport. Without one there is nothing to call,
  // and an unrecognised one is not a transport this app can vouch for.
  const classifier = readClassifyConfig(body);
  if (!classifier) {
    return { ok: false, error: UNKNOWN_PROVIDER };
  }

  // Which decision is being asked. The server still writes the prompt, so this
  // only chooses between two it already knows — never free text.
  const question = record.question;
  if (question !== undefined && question !== "topic" && question !== "folder") {
    return { ok: false, error: "Unknown question." };
  }

  return {
    ok: true,
    title,
    summary: summary.slice(0, MAX_SUMMARY),
    topics,
    classifier,
    question: question ?? "topic",
  };
}
