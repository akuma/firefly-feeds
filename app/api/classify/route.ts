import {
  buildClassifyRequest,
  ClassifyError,
  JEV_ENDPOINT,
  parseClassifyResponse,
  type ApiTopic,
} from "@/lib/classify";
import { fromAnotherSite, serverEnv, withinRateLimit } from "../guards";

export const dynamic = "force-dynamic";

/** A topic set the size of the built-ins, with room for the reader's own. */
const MAX_TOPICS = 24;
const MAX_TITLE = 300;
const MAX_SUMMARY = 2_000;
const MAX_LABEL = 80;

/**
 * Classification, proxied.
 *
 * The browser cannot call Jev itself: the key is a server secret, and a reader
 * who supplies their own key should still not hand it to a third-party origin
 * from our page. So the request goes to our own origin, the call happens here,
 * and only the slugs come back. The endpoint is never a general Jev proxy — it
 * accepts a title, a summary and a closed topic set, nothing else.
 *
 *   GET  /api/classify   → whether a key is configured
 *   POST /api/classify   → one article, one closed-set choice
 */
export async function GET(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }
  const env = await serverEnv();
  return Response.json(
    { ok: true, configured: typeof env.JEV_API_KEY === "string" && env.JEV_API_KEY.length > 0 },
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
  // A reader's own key is a header on a same-origin request, never stored. The
  // server key is the shared default.
  const headerKey = request.headers.get("x-jev-key")?.trim();
  const key = headerKey || (typeof env.JEV_API_KEY === "string" ? env.JEV_API_KEY : "");
  if (!key) {
    return Response.json(
      {
        ok: false,
        error: "No Jev API key is configured. Add one in Settings to classify stories.",
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

  const payload = buildClassifyRequest(
    { title: parsed.title, summary: parsed.summary },
    parsed.topics,
  );
  const knownSlugs = new Set(parsed.topics.map((topic) => topic.slug));

  try {
    const res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (res.status === 429) {
      return Response.json(
        { ok: false, error: "Jev is rate limiting requests. Try again shortly." },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    if (res.status === 401 || res.status === 403) {
      return Response.json(
        { ok: false, error: "Jev rejected the API key. Check it in Settings." },
        { status: 502 },
      );
    }

    const raw: unknown = await res.json();
    const classification = parseClassifyResponse(raw, knownSlugs);
    return Response.json(
      { ok: true, classification },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ClassifyError) {
      return Response.json({ ok: false, error: error.message }, { status: 502 });
    }
    return Response.json(
      { ok: false, error: "Could not reach Jev. The story stays unclassified." },
      { status: 502 },
    );
  }
}

function denied() {
  return Response.json(
    { ok: false, error: "This endpoint only serves the Firefly Feeds application." },
    { status: 403 },
  );
}

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
