import {
  findService,
  missingFields,
  modelFor,
  readLlmReply,
  serviceReady,
  type LlmConfig,
} from "../llm";
import { BRIEFING_LLM_TIMEOUT_MS, BRIEFING_MAX_TOKENS } from "./constants";
import { buildComposeMessages, buildShortlistMessages } from "./prompts";
import { parseJsonObject, validateComposition, validateShortlist } from "./validate";
import type {
  ComposeInput,
  GenerateFailure,
  GenerateFailureCode,
  GeneratePhase,
  GenerateResult,
  ShortlistInput,
} from "./types";

/**
 * One phase, one call — the unit the whole run is priced in.
 *
 * The model configuration is the application's existing one (`lib/llm.ts`),
 * unchanged: a local Ollama is called from the reader's own machine, everything
 * else travels to this app's endpoint so the key never leaves the page. What is
 * new here is only the contract: whatever a provider answers is parsed and
 * validated against the phase's schema before anything trusts it.
 */

function failure(
  code: GenerateFailureCode,
  message: string,
  retryable: boolean,
  errors?: string[],
): GenerateFailure {
  return { ok: false, code, message, retryable, ...(errors ? { errors } : {}) };
}

/** The reader may stop a run; the abort is not the provider failing. */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(BRIEFING_LLM_TIMEOUT_MS);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

export async function generatePhase(input: {
  phase: GeneratePhase;
  payload: ShortlistInput | ComposeInput;
  llm: LlmConfig;
  retryFeedback?: string[];
  signal?: AbortSignal;
}): Promise<GenerateResult> {
  const { phase, payload, llm, retryFeedback = [] } = input;
  const service = findService(llm.service);
  if (!service) {
    return failure("PROVIDER_UNAVAILABLE", "Choose a model in Settings.", false);
  }
  if (!serviceReady(service, llm)) {
    const missing = missingFields(service, llm)
      .map((field) => field.label)
      .join(", ");
    return failure("PROVIDER_UNAVAILABLE", `${service.label} still needs: ${missing}.`, false);
  }

  const messages =
    phase === "shortlist"
      ? buildShortlistMessages(payload as ShortlistInput, retryFeedback)
      : buildComposeMessages(payload as ComposeInput, retryFeedback);

  let parsed: unknown;
  let provider: string = service.id;
  let model = modelFor(llm);
  let truncated = false;
  try {
    if (service.direct?.(llm)) {
      const call = service.call(llm, messages, { maxTokens: BRIEFING_MAX_TOKENS[phase] });
      const res = await fetch(call.url, {
        method: "POST",
        headers: call.headers,
        body: JSON.stringify(call.body),
        signal: withTimeout(input.signal),
      });
      const reply = await readLlmReply(res, service, llm);
      if (!reply.ok) {
        return failure(
          reply.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
          reply.error,
          reply.status === 429 || reply.status >= 500,
        );
      }
      truncated = reply.truncated;
      parsed = parseJsonObject(reply.text);
    } else {
      const res = await fetch("/api/briefing/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase, input: payload, retryFeedback, ...llm }),
        signal: withTimeout(input.signal),
      });
      const data = (await res.json()) as GenerateResult;
      if (!data.ok) return data;
      provider = data.provider;
      model = data.model;
      parsed = data.result;
    }
  } catch (error) {
    if (input.signal?.aborted) {
      return failure("TIMED_OUT", "The run was cancelled.", true);
    }
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return failure(timedOut ? "TIMED_OUT" : "PROVIDER_ERROR", "Could not reach the model.", true);
  }

  // The reply is validated again here even when the server already did: both
  // ends run the same functions, so a direct call and a routed call cannot
  // come to different conclusions about what may be published.
  if (parsed === null) {
    // A cut-off answer is not a wrong one: saying "not JSON" about a JSON that
    // ran out of room sends the reader to the wrong fix.
    return truncated
      ? failure(
          "OUTPUT_TRUNCATED",
          "The model's answer ran out of room before the JSON ended.",
          true,
          [
            "output: cut off at the token limit — write more compactly, with shorter excerpts and fewer optional sections",
          ],
        )
      : failure("INVALID_OUTPUT", "The model's answer was not JSON.", true, [
          "output: expected one JSON object",
        ]);
  }
  const validated =
    phase === "shortlist"
      ? validateShortlist(parsed, payload as ShortlistInput)
      : validateComposition(parsed, payload as ComposeInput);
  if (!validated.ok) {
    return failure(
      "INVALID_OUTPUT",
      "The model's answer did not match the phase schema.",
      true,
      validated.errors,
    );
  }
  return { ok: true, phase, result: validated.value, provider, model };
}
