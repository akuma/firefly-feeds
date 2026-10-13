import { buildComposeMessages, buildShortlistMessages } from "@/lib/briefing/prompts";
import {
  BRIEFING_BODY_LIMITS,
  BRIEFING_LIMITS,
  BRIEFING_LLM_TIMEOUT_MS,
} from "@/lib/briefing/constants";
import { parseJsonObject, validateComposition, validateShortlist } from "@/lib/briefing/validate";
import type { GenerateFailureCode, GenerateResult } from "@/lib/briefing/types";
import {
  findService,
  missingFields,
  modelFor,
  readLlmConfig,
  readLlmReply,
  type LlmConfig,
} from "@/lib/llm";
import { fromAnotherSite, withinRateLimit } from "../../guards";

export const dynamic = "force-dynamic";

/**
 * The briefing's one server entry: one phase, one upstream call.
 *
 * The endpoint is not a general proxy. It accepts a frozen briefing input and
 * the reader's own model choice, writes every word of the prompt itself (from
 * `lib/briefing/prompts.ts`), and returns only what the phase's schema allows.
 * A request that carried its own instructions would be a general LLM proxy
 * with our domain on it.
 */

type Body = {
  phase?: unknown;
  input?: unknown;
  retryFeedback?: unknown;
};

const MAX_FEEDBACK = 20;
const MAX_FEEDBACK_LINE = 200;

function failure(
  code: GenerateFailureCode,
  message: string,
  retryable: boolean,
  status: number,
  errors?: string[],
): Response {
  const body: GenerateResult = {
    ok: false,
    code,
    message,
    retryable,
    ...(errors ? { errors } : {}),
  };
  return Response.json(body, { status });
}

/** Structural checks only: the phase's own validator is the real gate. */
function readInput(
  body: Body,
): { phase: "shortlist" | "compose"; input: Record<string, unknown> } | null {
  const phase = body.phase === "shortlist" || body.phase === "compose" ? body.phase : null;
  const input = body.input;
  if (!phase || typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  const entries =
    phase === "shortlist"
      ? Array.isArray(record.candidates)
        ? record.candidates
        : null
      : Array.isArray(record.materials)
        ? record.materials
        : null;
  if (!entries || entries.length > BRIEFING_LIMITS.maxCandidates) return null;
  return { phase, input: record };
}

function readFeedback(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(0, MAX_FEEDBACK)
    .map((line) => line.slice(0, MAX_FEEDBACK_LINE));
}

export async function POST(request: Request): Promise<Response> {
  if (fromAnotherSite(request)) {
    return failure(
      "INVALID_INPUT",
      "This endpoint only serves the Firefly Feeds application.",
      false,
      403,
    );
  }
  if (!(await withinRateLimit(request, "BRIEFING_LLM"))) {
    return failure("RATE_LIMITED", "Too many briefing requests. Try again in a minute.", true, 429);
  }

  // The body is read as text so the limit is enforced before any parsing —
  // `request.json()` would happily accept a gigabyte first.
  const raw = await request.text();
  const cap = Math.max(BRIEFING_BODY_LIMITS.shortlist, BRIEFING_BODY_LIMITS.compose);
  if (raw.length > cap) {
    return failure("INVALID_INPUT", "The request body is too large.", false, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure("INVALID_INPUT", "Expected a JSON body.", false, 400);
  }
  const body: Body = typeof parsed === "object" && parsed !== null ? (parsed as Body) : {};
  const read = readInput(body);
  if (!read) {
    return failure("INVALID_INPUT", "Expected one phase and its frozen input.", false, 400);
  }
  const limit =
    read.phase === "shortlist" ? BRIEFING_BODY_LIMITS.shortlist : BRIEFING_BODY_LIMITS.compose;
  if (raw.length > limit) {
    return failure("INVALID_INPUT", `The ${read.phase} body is over its budget.`, false, 413);
  }

  const config: LlmConfig = readLlmConfig(parsed);
  const service = findService(config.service);
  if (!service) {
    return failure("PROVIDER_UNAVAILABLE", "Choose a model in Settings.", false, 400);
  }
  // Refused rather than called half-built: a service with no model or no key
  // would only answer with somebody else's error message.
  if (missingFields(service, config).length > 0) {
    const missing = missingFields(service, config)
      .map((field) => field.label)
      .join(", ");
    return failure("PROVIDER_UNAVAILABLE", `${service.label} still needs: ${missing}.`, false, 400);
  }

  const feedback = readFeedback(body.retryFeedback);
  const messages =
    read.phase === "shortlist"
      ? buildShortlistMessages(read.input as never, feedback)
      : buildComposeMessages(read.input as never, feedback);

  const call = service.call(config, messages);
  try {
    const res = await fetch(call.url, {
      method: "POST",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(BRIEFING_LLM_TIMEOUT_MS),
    });
    const reply = await readLlmReply(res, service, config);
    if (!reply.ok) {
      const code: GenerateFailureCode =
        reply.status === 429
          ? "RATE_LIMITED"
          : reply.status === 504
            ? "TIMED_OUT"
            : "PROVIDER_ERROR";
      // Upstream detail is summarized, never forwarded verbatim: an error page
      // is the provider's text, not ours.
      return failure(code, reply.error, reply.status === 429 || reply.status >= 500, 502);
    }

    const answer = parseJsonObject(reply.text);
    if (answer === null) {
      return failure("INVALID_OUTPUT", "The model's answer was not JSON.", true, 502, [
        "output: expected one JSON object",
      ]);
    }
    const validated =
      read.phase === "shortlist"
        ? validateShortlist(answer, read.input as never)
        : validateComposition(answer, read.input as never);
    if (!validated.ok) {
      return failure(
        "INVALID_OUTPUT",
        "The model's answer did not match the phase schema.",
        true,
        502,
        validated.errors,
      );
    }
    return Response.json(
      {
        ok: true,
        phase: read.phase,
        result: validated.value,
        provider: service.id,
        model: modelFor(config),
      } satisfies GenerateResult,
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return failure("PROVIDER_UNAVAILABLE", `Could not reach ${service.label}.`, true, 502);
  }
}
