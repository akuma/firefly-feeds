import {
  findService,
  missingFields,
  modelFor,
  readLlmReply,
  serviceReady,
  type LlmConfig,
} from "../llm";
import { BRIEFING_LLM_TIMEOUT_MS, briefingMaxTokens } from "./constants";
import { captureRepairOutput, safeDiagnosticText } from "./repair";
import { buildComposeMessages, buildShortlistMessages } from "./prompts";
import {
  parseJsonObject,
  pruneWeakComposition,
  validateComposition,
  validateShortlist,
} from "./validate";
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
  repairOutput?: string,
): GenerateFailure {
  return {
    ok: false,
    code,
    message,
    retryable,
    ...(errors ? { errors } : {}),
    ...(repairOutput ? { repairOutput } : {}),
  };
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
  repairOutput?: string;
  runId?: string;
  attempt?: number;
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
      ? buildShortlistMessages(payload as ShortlistInput, retryFeedback, input.repairOutput)
      : buildComposeMessages(payload as ComposeInput, retryFeedback, input.repairOutput);

  let parsed: unknown;
  let repairOutput: string | undefined;
  let provider: string = service.id;
  let model = modelFor(llm);
  let truncated = false;
  let omittedWeakItems = 0;
  let omittedUnsupportedSections = 0;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    if (service.direct?.(llm)) {
      const call = service.call(llm, messages, {
        maxTokens: briefingMaxTokens(phase, service.id),
        jsonOutput: true,
      });
      const res = await fetch(call.url, {
        method: "POST",
        redirect: "manual",
        headers: call.headers,
        body: JSON.stringify(call.body),
        signal: withTimeout(input.signal),
      });
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel();
        return failure(
          "PROVIDER_ERROR",
          "The local API redirected the request. No credentials were forwarded.",
          false,
        );
      }
      const reply = await readLlmReply(res, service, llm);
      if (!reply.ok) {
        if (reply.truncated)
          return failure(
            "OUTPUT_TRUNCATED",
            "The model's answer ran out of room before the JSON ended.",
            true,
            [
              "output: cut off at the token limit — write more compactly, with shorter prose and fewer optional sections",
            ],
          );
        return failure(
          reply.status === 429
            ? "RATE_LIMITED"
            : reply.status === 408 || reply.status === 504
              ? "TIMED_OUT"
              : "PROVIDER_ERROR",
          reply.safeError,
          reply.status === 408 || reply.status === 429 || reply.status >= 500,
        );
      }
      usage = reply.usage;
      truncated = reply.truncated;
      parsed = parseJsonObject(reply.text);
      repairOutput =
        parsed === null
          ? undefined
          : captureRepairOutput(
              JSON.stringify(parsed),
              Object.values(llm.keys).filter((key): key is string => !!key),
            );
    } else {
      const res = await fetch("/api/briefing/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase,
          input: payload,
          retryFeedback,
          repairOutput: input.repairOutput,
          runId: input.runId,
          attempt: input.attempt,
          ...llm,
          models: { [llm.service]: modelFor(llm) },
          keys: { [llm.service]: llm.keys[llm.service] ?? "" },
        }),
        signal: withTimeout(input.signal),
      });
      const data = (await res.json()) as GenerateResult;
      if (!data.ok) return data;
      usage = data.usage;
      omittedWeakItems = data.omittedWeakItems ?? 0;
      omittedUnsupportedSections = data.omittedUnsupportedSections ?? 0;
      provider = data.provider;
      model = data.model;
      parsed = data.result;
    }
  } catch (error) {
    if (input.signal?.aborted) {
      return failure("TIMED_OUT", "The run was cancelled.", true);
    }
    const timedOut =
      (error instanceof Error || error instanceof DOMException) && error.name === "TimeoutError";
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
            "output: cut off at the token limit — write more compactly, with shorter prose and fewer optional sections",
          ],
        )
      : failure("INVALID_OUTPUT", "The model's answer was not JSON.", true, [
          "output: expected one JSON object",
        ]);
  }
  const trimmed =
    phase === "compose"
      ? pruneWeakComposition(parsed, payload as ComposeInput)
      : { output: parsed, omitted: 0, omittedSections: 0 };
  omittedWeakItems += trimmed.omitted;
  omittedUnsupportedSections += trimmed.omittedSections;
  const validated =
    phase === "shortlist"
      ? validateShortlist(trimmed.output, payload as ShortlistInput)
      : validateComposition(trimmed.output, payload as ComposeInput);
  if (!validated.ok) {
    if (validated.errors.every((e) => e.startsWith("INSUFFICIENT_CONTENT")))
      return failure(
        "INSUFFICIENT_CONTENT",
        "No proposed topic meets the editorial and evidence requirements yet. There is no minimum article count.",
        false,
      );
    return failure(
      "INVALID_OUTPUT",
      "The model's answer did not match the phase schema.",
      true,
      validated.errors.slice(0, 20).map((error) =>
        safeDiagnosticText(
          error,
          Object.values(llm.keys).filter((key): key is string => !!key),
          300,
        ),
      ),
      repairOutput,
    );
  }
  return {
    ok: true,
    phase,
    result: validated.value,
    provider,
    model,
    ...(usage ? { usage } : {}),
    ...(omittedWeakItems ? { omittedWeakItems } : {}),
    ...(omittedUnsupportedSections ? { omittedUnsupportedSections } : {}),
  };
}
