import { isSafeTargetUrl } from "@/lib/url-safety";
import { readCapped } from "@/lib/feed-server";
import { schemaErrors, SHORTLIST_INPUT_SCHEMA, COMPOSE_INPUT_SCHEMA } from "@/lib/briefing/schema";
import { buildComposeMessages, buildShortlistMessages } from "@/lib/briefing/prompts";
import {
  BRIEFING_BODY_LIMITS,
  BRIEFING_LLM_TIMEOUT_MS,
  briefingMaxTokens,
} from "@/lib/briefing/constants";
import {
  parseJsonObject,
  pruneWeakComposition,
  validateComposition,
  validateShortlist,
} from "@/lib/briefing/validate";
import type { GenerateFailureCode, GenerateResult } from "@/lib/briefing/types";
import {
  CUSTOM_SERVICE,
  findService,
  missingFields,
  modelFor,
  readLlmConfig,
  readLlmReply,
  type LlmConfig,
} from "@/lib/llm";
import {
  captureRepairOutput,
  MAX_REPAIR_OUTPUT_BYTES,
  safeDiagnosticText,
} from "@/lib/briefing/repair";
import { writeBriefingLog } from "./logging";
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
  repairOutput?: unknown;
};

const MAX_FEEDBACK = 20;
const MAX_FEEDBACK_LINE = 200;

function failure(
  code: GenerateFailureCode,
  message: string,
  retryable: boolean,
  status: number,
  errors?: string[],
  repairOutput?: string,
): Response {
  const body: GenerateResult = {
    ok: false,
    code,
    message,
    retryable,
    ...(repairOutput ? { repairOutput } : {}),
    ...(errors
      ? {
          errors: errors
            .slice(0, 20)
            .map((line) => line.replace(/"[^"\n]*"/g, "<reference>").slice(0, 200)),
        }
      : {}),
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
  const schema = phase === "shortlist" ? SHORTLIST_INPUT_SCHEMA : COMPOSE_INPUT_SCHEMA;
  if (schemaErrors(record, schema).length) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.editionDate))) return null;
  try {
    Intl.DateTimeFormat("en", { timeZone: String(record.timezone) }).format(0);
  } catch {
    return null;
  }
  return { phase, input: record };
}

function readFeedback(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(0, MAX_FEEDBACK)
    .map((line) => line.slice(0, MAX_FEEDBACK_LINE));
}

type Trace = {
  requestId: string;
  secrets: string[];
  parameters?: Record<string, unknown>;
  upstreamStatus?: number;
  preview?: string;
};

export async function POST(request: Request): Promise<Response> {
  const trace: Trace = { requestId: crypto.randomUUID(), secrets: [] };
  const started = Date.now();
  writeBriefingLog("info", "briefing.request", {
    requestId: trace.requestId,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  let response: Response;
  try {
    response = await handle(request, trace);
  } catch (cause) {
    writeBriefingLog(
      "error",
      "briefing.exception",
      {
        requestId: trace.requestId,
        message: cause instanceof Error ? cause.message : "Unknown error",
      },
      trace.secrets,
    );
    response = failure(
      "PROVIDER_UNAVAILABLE",
      "The briefing request failed unexpectedly. Try Resume.",
      true,
      500,
    );
  }
  const result = (await response.clone().json()) as Record<string, unknown>;
  const output = result.result as Record<string, unknown> | undefined;
  writeBriefingLog(
    response.status < 400
      ? "info"
      : response.status >= 500 && response.status !== 502
        ? "error"
        : "warn",
    "briefing.response",
    {
      requestId: trace.requestId,
      durationMs: Date.now() - started,
      parameters: trace.parameters,
      response: {
        status: response.status,
        upstreamStatus: trace.upstreamStatus,
        code: result.code,
        message: result.message,
        errors: result.errors,
        usage: result.usage,
        counts: output
          ? Object.fromEntries(
              Object.entries(output)
                .filter(([, value]) => Array.isArray(value))
                .map(([key, value]) => [key, (value as unknown[]).length]),
            )
          : undefined,
        preview: trace.preview,
      },
    },
    trace.secrets,
  );
  response.headers.set("x-briefing-request-id", trace.requestId);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function handle(request: Request, trace: Trace): Promise<Response> {
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

  let raw: string;
  try {
    raw = await readCapped(
      new Response(request.body, { headers: request.headers }),
      BRIEFING_BODY_LIMITS.compose + MAX_REPAIR_OUTPUT_BYTES * 2 + 64,
    );
  } catch {
    return failure("INVALID_INPUT", "The request body is too large or unreadable.", false, 413);
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
  const feedback = readFeedback(body.retryFeedback);
  const previous =
    typeof body.repairOutput === "string" && feedback.length
      ? captureRepairOutput(body.repairOutput)
      : undefined;
  if (body.repairOutput !== undefined && !previous) {
    return failure(
      "INVALID_INPUT",
      "Repair context must be a complete JSON object within its budget and include validation feedback.",
      false,
      400,
    );
  }
  const repairBytes = previous
    ? new TextEncoder().encode(JSON.stringify(body.repairOutput)).byteLength + 20
    : 0;
  if (new TextEncoder().encode(raw).byteLength > limit + repairBytes) {
    return failure("INVALID_INPUT", `The ${read.phase} body is over its budget.`, false, 413);
  }

  const envelope = parsed as Record<string, unknown>;
  const modelMap = envelope.models;
  const keyMap = envelope.keys;
  const selected = typeof envelope.service === "string" ? envelope.service : "";
  const selectedModel =
    modelMap && typeof modelMap === "object"
      ? (modelMap as Record<string, unknown>)[selected]
      : undefined;
  const selectedKey =
    keyMap && typeof keyMap === "object"
      ? (keyMap as Record<string, unknown>)[selected]
      : undefined;
  if (
    typeof selectedModel !== "string" ||
    !/^[a-zA-Z0-9._:/-]{1,128}$/.test(selectedModel) ||
    typeof selectedKey !== "string" ||
    !selectedKey.trim() ||
    selectedKey.length > 512
  ) {
    return failure(
      "INVALID_INPUT",
      "Supply a valid model ID and API key for the selected provider.",
      false,
      400,
    );
  }
  const config: LlmConfig = readLlmConfig(parsed);
  trace.secrets = Object.values(config.keys).filter((key): key is string => !!key);
  const service = findService(config.service);
  if (
    !service ||
    (!service.baseUrl && service.id !== CUSTOM_SERVICE) ||
    (parsed as Record<string, unknown>).service !== config.service
  ) {
    return failure(
      "PROVIDER_UNAVAILABLE",
      "Choose a supported hosted provider, or use local Ollama directly in this browser.",
      false,
      400,
    );
  }
  if (service.id === CUSTOM_SERVICE) {
    let target: URL;
    try {
      target = new URL(config.baseUrl);
    } catch {
      return failure(
        "INVALID_INPUT",
        "Supply an absolute HTTPS base URL for the custom API.",
        false,
        400,
      );
    }
    if (
      typeof envelope.baseUrl !== "string" ||
      envelope.baseUrl.length > 300 ||
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !isSafeTargetUrl(target.href)
    ) {
      return failure(
        "INVALID_INPUT",
        "Custom hosted APIs require a public HTTPS base URL without credentials, query or fragment. Local APIs are called directly by your browser.",
        false,
        400,
      );
    }
    if (envelope.wire !== "openai" && envelope.wire !== "anthropic")
      return failure(
        "INVALID_INPUT",
        "Choose OpenAI-compatible or Anthropic-compatible format.",
        false,
        400,
      );
  }
  // Refused rather than called half-built: a service with no model or no key
  // would only answer with somebody else's error message.
  if (missingFields(service, config).length > 0) {
    const missing = missingFields(service, config)
      .map((field) => field.label)
      .join(", ");
    return failure("PROVIDER_UNAVAILABLE", `${service.label} still needs: ${missing}.`, false, 400);
  }

  const envelopeRunId = envelope.runId;
  trace.parameters = {
    runId:
      typeof envelopeRunId === "string" && /^[a-zA-Z0-9_@/#.+-]{1,180}$/.test(envelopeRunId)
        ? envelopeRunId
        : undefined,
    attempt:
      Number.isInteger(envelope.attempt) &&
      Number(envelope.attempt) >= 1 &&
      Number(envelope.attempt) <= 3
        ? envelope.attempt
        : undefined,
    phase: read.phase,
    provider: service.id,
    model: modelFor(config),
    maxTokens: briefingMaxTokens(read.phase, service.id),
    repair: feedback.length > 0,
    editionDate: read.input.editionDate,
    timezone: read.input.timezone,
    outputLanguage: read.input.outputLanguage,
    inputCounts: Object.fromEntries(
      Object.entries(read.input)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as unknown[]).length]),
    ),
    feedback,
  };
  writeBriefingLog(
    "info",
    "briefing.model_request",
    { requestId: trace.requestId, parameters: trace.parameters },
    trace.secrets,
  );
  const repairOutput = previous ? captureRepairOutput(previous, trace.secrets) : undefined;
  const messages =
    read.phase === "shortlist"
      ? buildShortlistMessages(read.input as never, feedback, repairOutput)
      : buildComposeMessages(read.input as never, feedback, repairOutput);

  const call = service.call(config, messages, {
    maxTokens: briefingMaxTokens(read.phase, service.id),
    jsonOutput: true,
  });
  try {
    const res = await fetch(call.url, {
      method: "POST",
      redirect: "manual",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(BRIEFING_LLM_TIMEOUT_MS)]),
    });
    trace.upstreamStatus = res.status;
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      return failure(
        "PROVIDER_ERROR",
        `${service.label} redirected the request. No credentials were forwarded.`,
        false,
        502,
      );
    }
    const reply = await readLlmReply(res, service, config);
    if (!reply.ok) {
      if (reply.truncated)
        return failure(
          "OUTPUT_TRUNCATED",
          "The model's answer ran out of room before the JSON ended.",
          true,
          502,
          [
            "output: cut off at the token limit — write more compactly, with shorter excerpts and fewer optional sections",
          ],
        );
      const code: GenerateFailureCode =
        reply.status === 429
          ? "RATE_LIMITED"
          : reply.status === 408 || reply.status === 504
            ? "TIMED_OUT"
            : "PROVIDER_ERROR";
      return failure(
        code,
        reply.safeError,
        reply.status === 408 || reply.status === 429 || reply.status >= 500,
        502,
      );
    }

    trace.preview = safeDiagnosticText(
      captureRepairOutput(reply.text, trace.secrets) ?? "[Non-JSON or oversized response omitted]",
      trace.secrets,
    );
    const answer = parseJsonObject(reply.text);
    if (answer === null) {
      // A cut-off answer is not a wrong one: "not JSON" about a JSON that ran
      // out of room sends the reader to the wrong fix.
      return reply.truncated
        ? failure(
            "OUTPUT_TRUNCATED",
            "The model's answer ran out of room before the JSON ended.",
            true,
            502,
            [
              "output: cut off at the token limit — write more compactly, with shorter excerpts and fewer optional sections",
            ],
          )
        : failure("INVALID_OUTPUT", "The model's answer was not JSON.", true, 502, [
            "output: expected one JSON object",
          ]);
    }
    const trimmed =
      read.phase === "compose"
        ? pruneWeakComposition(answer, read.input as never)
        : { output: answer, omitted: 0, omittedSections: 0 };
    const validated =
      read.phase === "shortlist"
        ? validateShortlist(trimmed.output, read.input as never)
        : validateComposition(trimmed.output, read.input as never);
    if (!validated.ok) {
      if (validated.errors.every((e) => e.startsWith("INSUFFICIENT_CONTENT")))
        return failure(
          "INSUFFICIENT_CONTENT",
          "No proposed topic meets the editorial and evidence requirements yet. There is no minimum article count.",
          false,
          422,
        );
      return failure(
        "INVALID_OUTPUT",
        "The model's answer did not match the phase schema.",
        true,
        502,
        validated.errors,
        captureRepairOutput(JSON.stringify(answer), trace.secrets),
      );
    }
    return Response.json(
      {
        ok: true,
        phase: read.phase,
        result: validated.value,
        ...(trimmed.omitted ? { omittedWeakItems: trimmed.omitted } : {}),
        ...(trimmed.omittedSections ? { omittedUnsupportedSections: trimmed.omittedSections } : {}),
        provider: service.id,
        model: modelFor(config),
        ...(reply.usage ? { usage: reply.usage } : {}),
      } satisfies GenerateResult,
      { headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "TimeoutError")
      return failure("TIMED_OUT", "The model request timed out.", true, 504);
    return failure(
      "PROVIDER_UNAVAILABLE",
      `Could not reach ${service.label}. Check the connection and try Resume; an earlier request may already have been billed.`,
      true,
      502,
    );
  }
}
