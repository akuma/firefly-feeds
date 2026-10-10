import {
  buildDigestMessages,
  DIGEST_MAX_CANDIDATES,
  DIGEST_SUMMARY_LIMIT,
  DIGEST_TIMEOUT_MS,
  DIGEST_TITLE_LIMIT,
  type DigestCandidate,
} from "@/lib/digest";
import {
  findService,
  missingFields,
  modelFor,
  readLlmConfig,
  readLlmReply,
  type LlmConfig,
  type LlmService,
} from "@/lib/llm";
import { readDigestLanguage, type DigestLanguageId } from "@/lib/languages";
import { fromAnotherSite } from "../guards";

export const dynamic = "force-dynamic";

/** Shown when the body names a service the table does not have. */
const UNKNOWN_SERVICE = "Choose a model in Settings.";

/** The most text one story can carry into the prompt. */
const MAX_ID = 200;

/**
 * Today's briefing, written by the reader's own model.
 *
 * The browser cannot call a commercial LLM itself: the reader's key would be
 * handed to a third-party origin straight from our page. So the request comes
 * here, the call happens here, and only the model's own words go back. The
 * endpoint is never a general proxy — it accepts a list of candidates and the
 * reader's choice of service, and it writes every word of the prompt itself,
 * exactly as `/api/classify` writes every word of its question. A request that
 * carried its own instructions would be a general LLM proxy with our domain on
 * it.
 *
 * There is no server-side configuration. The reader picks the service in
 * Settings and it arrives with the request, so a key is never stored here and
 * this app can be deployed with no secrets at all. A service the reader has not
 * finished setting up is refused here rather than called half-built.
 *
 * Unlike `/api/classify`, there is no rate limiter: a briefing is written once a
 * day and a manual rewrite is capped on the client, so the worst a single
 * request can cost is knowable in advance — twenty candidates in, eight hundred
 * tokens out, sixty seconds at most.
 *
 *   POST /api/digest   → one day's edition, in the reader's own calendar
 */
export async function POST(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
  }

  const candidates = readCandidates(body);
  if (!candidates) {
    return Response.json(
      {
        ok: false,
        error: `Send between 1 and ${DIGEST_MAX_CANDIDATES} stories, each with an id, a title and a summary.`,
      },
      { status: 400 },
    );
  }

  const config = readLlmConfig(body);
  const bodyRecord =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  // The language travels as a name this app already knows, never as an
  // instruction of the reader's own: the prompt is still ours.
  const language = readDigestLanguage(bodyRecord.language);
  const service = findService(config.service);
  if (!service) {
    return Response.json({ ok: false, error: UNKNOWN_SERVICE }, { status: 400 });
  }
  // Refused rather than called half-built: a service with no model or no key
  // would only answer with somebody else's error message.
  if (missingFields(service, config).length > 0) {
    const missing = missingFields(service, config).map((field) => field.label);
    return Response.json(
      { ok: false, error: `${service.label} still needs: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  return callService(service, config, candidates, language);
}

/* --------------------------------------------------------------- upstream */

/**
 * The one outbound call, with the whole cost of the request capped on the way
 * in: the candidates were truncated before they arrived, the prompt is ours,
 * and `max_tokens` is part of the body the transport builds.
 */
async function callService(
  service: LlmService,
  config: LlmConfig,
  candidates: readonly DigestCandidate[],
  language: DigestLanguageId,
): Promise<Response> {
  const call = service.call(config, buildDigestMessages(candidates, language));
  try {
    const res = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
    });
    // Read here rather than in the route, so "what did the model say" is
    // decided once and an unreadable reply is never reported as an empty one.
    const reply = await readLlmReply(res, service, config);
    if (!reply.ok) {
      return Response.json(
        { ok: false, error: reply.error },
        { status: reply.status === 429 ? 429 : 502 },
      );
    }
    return Response.json(
      {
        ok: true,
        text: reply.text,
        provider: service.id,
        ...(modelFor(config) ? { model: modelFor(config) } : {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: `Could not reach ${service.label}.` },
      { status: 502 },
    );
  }
}

/* ------------------------------------------------------------------ input */

/**
 * Validate before anything leaves the server. The candidate set is the
 * reader's, so it is checked here rather than trusted: an id this endpoint
 * accepted blindly would let a gist be attached to a story nobody wrote about.
 */
function readCandidates(body: unknown): DigestCandidate[] | null {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const list = Array.isArray(record.candidates) ? record.candidates : null;
  if (!list || list.length === 0 || list.length > DIGEST_MAX_CANDIDATES) return null;

  const candidates: DigestCandidate[] = [];
  for (const entry of list) {
    const item =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const id = typeof item.id === "string" ? item.id.trim().slice(0, MAX_ID) : "";
    const title =
      typeof item.title === "string" ? item.title.trim().slice(0, DIGEST_TITLE_LIMIT) : "";
    const summary =
      typeof item.summary === "string" ? item.summary.trim().slice(0, DIGEST_SUMMARY_LIMIT) : "";
    if (!id || !title) return null;
    candidates.push({ id, title, summary });
  }
  return candidates;
}

function denied() {
  return Response.json(
    { ok: false, error: "This endpoint only serves the Firefly Feeds application." },
    { status: 403 },
  );
}
