import {
  buildClassifyRequest,
  ClassifyError,
  cloudflareBody,
  cloudflareRunUrl,
  JEV_DIRECT_ENDPOINT,
  parseClassifyResponse,
  type ApiTopic,
  type ClassifyInput,
  type ClassifySuggestion,
} from "@/lib/classify";
import { fromAnotherSite, serverEnv, withinRateLimit } from "../guards";

export const dynamic = "force-dynamic";

/** A topic set the size of the built-ins, with room for the reader's own. */
const MAX_TOPICS = 24;
const MAX_TITLE = 300;
const MAX_SUMMARY = 2_000;
const MAX_LABEL = 80;
const TIMEOUT_MS = 20_000;

/**
 * Classification, proxied.
 *
 * The browser cannot call Jev itself: the credential is a server secret, and a
 * reader who supplies their own should still not hand it to a third-party
 * origin from our page. So the request goes to our own origin, the call happens
 * here, and only the slugs come back. The endpoint is never a general proxy —
 * it accepts a title, a summary and a closed topic set, nothing else.
 *
 * Jev is reached through **Cloudflare Workers AI** (`typesafe/jev`). When the
 * account cannot run the third-party model — an AI Gateway with no balance and
 * no BYOK, for instance — the direct Jev API is tried as a fallback if a key
 * is configured, so a billing problem degrades rather than breaks the feature.
 *
 *   GET  /api/classify   → whether a credential is configured, and which path
 *   POST /api/classify   → one article, one closed-set choice
 */
export async function GET(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }
  const env = await serverEnv();
  const cloudflare = Boolean(text(env.CF_API_TOKEN) && text(env.CF_ACCOUNT_ID));
  const direct = Boolean(text(env.JEV_API_KEY));
  return Response.json(
    {
      ok: true,
      configured: cloudflare || direct,
      provider: cloudflare ? "cloudflare" : direct ? "jev" : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

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

  const env = await serverEnv();
  // A reader's own token is a header on a same-origin request, never stored.
  const headerToken = request.headers.get("x-jev-key")?.trim();
  const cloudflareToken = headerToken || text(env.CF_API_TOKEN);
  const accountId = text(env.CF_ACCOUNT_ID);
  const directKey = text(env.JEV_API_KEY);
  if (!cloudflareToken && !directKey) {
    return Response.json(
      {
        ok: false,
        error: "No classifier credential is configured. Set CF_API_TOKEN and CF_ACCOUNT_ID.",
      },
      { status: 503 },
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

  const input = buildClassifyRequest(
    { title: parsed.title, summary: parsed.summary },
    parsed.topics,
  );
  const knownSlugs = new Set(parsed.topics.map((topic) => topic.slug));
  const failures: UpstreamFailure[] = [];

  if (cloudflareToken && accountId) {
    const result = await callProvider(
      cloudflareRunUrl(accountId),
      cloudflareToken,
      cloudflareBody(input),
      knownSlugs,
      "Cloudflare Workers AI",
    );
    if (result.ok) return success(result.suggestion, "cloudflare");
    failures.push(result);
  }

  // Fall back to the direct API only when Workers AI could not answer.
  if (directKey) {
    const result = await callProvider(JEV_DIRECT_ENDPOINT, directKey, input, knownSlugs, "Jev");
    if (result.ok) return success(result.suggestion, "jev");
    failures.push(result);
  }

  // A rate limit is the most actionable failure to surface, then billing.
  const failure =
    failures.find((candidate) => candidate.status === 429) ??
    failures.find((candidate) => candidate.status === 402) ??
    failures[0];
  return Response.json(
    { ok: false, error: failure?.error ?? "The classifier did not answer." },
    { status: failure?.status ?? 502 },
  );
}

/* --------------------------------------------------------------- upstream */

type UpstreamFailure = { ok: false; status: number; error: string };
type Upstream = { ok: true; suggestion: ClassifySuggestion } | UpstreamFailure;

function success(suggestion: ClassifySuggestion, provider: "cloudflare" | "jev"): Response {
  return Response.json(
    { ok: true, classification: suggestion, provider },
    { headers: { "cache-control": "no-store" } },
  );
}

async function callProvider(
  url: string,
  key: string,
  payload: ClassifyInput | { model: string; input: ClassifyInput },
  knownSlugs: ReadonlySet<string>,
  label: string,
): Promise<Upstream> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw: unknown = await res.json().catch(() => null);

    if (res.status === 429) {
      return { ok: false, status: 429, error: `${label} is rate limiting requests.` };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: readProviderError(raw) ?? `${label} refused the request.`,
      };
    }
    return { ok: true, suggestion: parseClassifyResponse(raw, knownSlugs) };
  } catch (error) {
    if (error instanceof ClassifyError) {
      return { ok: false, status: 502, error: error.message };
    }
    return { ok: false, status: 502, error: `Could not reach ${label}.` };
  }
}

/** The first human-readable message in a Cloudflare or Jev error body. */
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
  return typeof record.message === "string" && record.message ? record.message : undefined;
}

function denied() {
  return Response.json(
    { ok: false, error: "This endpoint only serves the Firefly Feeds application." },
    { status: 403 },
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* ---------------------------------------------------------------- input */

type ReadInput =
  { ok: true; title: string; summary: string; topics: ApiTopic[] } | { ok: false; error: string };

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

  return { ok: true, title, summary: summary.slice(0, MAX_SUMMARY), topics };
}
