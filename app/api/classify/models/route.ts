import { ollamaTagsUrl, readOllamaModels } from "@/lib/classify";
import { fromAnotherSite, withinRateLimit } from "../../guards";

export const dynamic = "force-dynamic";

/** An address a reader typed, capped like any other. */
const MAX_ENDPOINT = 300;
const TIMEOUT_MS = 20_000;

/**
 * The decision models a local Ollama has, for the Settings picker.
 *
 * The browser cannot ask Ollama itself: its CORS policy only admits localhost
 * origins, so a reader on a deployed origin could not. The answer is not a
 * secret either — it is a list of model names — so the dialog asks our own
 * origin, which asks Ollama's model list and hands back only the ones that can
 * answer a decision.
 */
export async function GET(request: Request) {
  if (fromAnotherSite(request)) {
    return denied();
  }
  if (!(await withinRateLimit(request, "JEV_CLASSIFY"))) {
    return Response.json(
      { ok: false, error: "Too many requests. Give it a minute and try again." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const base = new URL(request.url).searchParams.get("base") ?? "";
  if (base.length > MAX_ENDPOINT) {
    return Response.json({ ok: false, error: "That address is too long." }, { status: 400 });
  }

  try {
    const res = await fetch(ollamaTagsUrl(base), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      return Response.json(
        { ok: false, error: readProviderError(raw) ?? "Ollama did not list its models." },
        { status: res.status === 429 ? 429 : 502 },
      );
    }
    return Response.json(
      { ok: true, models: readOllamaModels(raw) },
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

/** The first human-readable message in an Ollama error body. */
function readProviderError(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.error === "string" && record.error) return record.error;
  return typeof record.message === "string" && record.message ? record.message : undefined;
}
