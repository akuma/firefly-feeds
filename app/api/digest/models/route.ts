import { llmErrorText, ollamaChatModelsUrl, readOllamaChatModels } from "@/lib/llm";
import { fromAnotherSite } from "../../guards";

export const dynamic = "force-dynamic";

/** An address a reader typed, capped like any other. */
const MAX_ENDPOINT = 300;
const TIMEOUT_MS = 20_000;

/**
 * The chat models a local Ollama has, for the Settings picker.
 *
 * The same shape as `/api/classify/models`, and a different filter: a model that
 * can only answer a closed choice cannot write a briefing, so only the ones
 * whose `capabilities` include `completion` are offered. Nothing here presumes a
 * particular model exists.
 */
export async function GET(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }

  const base = new URL(request.url).searchParams.get("base") ?? "";
  if (base.length > MAX_ENDPOINT) {
    return Response.json({ ok: false, error: "That address is too long." }, { status: 400 });
  }

  try {
    const res = await fetch(ollamaChatModelsUrl(base), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      return Response.json(
        { ok: false, error: llmErrorText(raw) ?? "Ollama did not list its models." },
        { status: res.status === 429 ? 429 : 502 },
      );
    }
    return Response.json(
      { ok: true, models: readOllamaChatModels(raw) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, error: "Could not reach Ollama. Is it running at that address?" },
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
