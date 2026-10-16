export const MAX_REPAIR_OUTPUT_BYTES = 64 * 1024;

const CREDENTIAL_FIELD =
  /^(?:api.?key|authorization|password|secret|access.?token|refresh.?token)$/i;

function redact(text: string, secrets: readonly string[]): string {
  let safe = text;
  for (const secret of secrets.filter(Boolean)) {
    safe = safe.split(secret).join("[redacted]");
    safe = safe.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]");
  }
  return safe.replace(
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{8,}|\bAIza[A-Za-z0-9_-]{12,}/g,
    "[redacted]",
  );
}

export function safeDiagnosticText(
  text: string,
  secrets: readonly string[] = [],
  limit = 800,
): string {
  const safe = redact(text, secrets);
  return safe.length <= limit
    ? safe
    : `${safe.slice(0, limit)}… [truncated ${safe.length - limit} chars]`;
}

/** Preserve complete invalid JSON for correction, not arbitrary instructions or partial output. */
export function captureRepairOutput(
  text: string,
  secrets: readonly string[] = [],
): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const clean = (value: unknown): unknown => {
      if (typeof value === "string") return redact(value, secrets);
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            redact(key, secrets),
            CREDENTIAL_FIELD.test(key) ? "[redacted]" : clean(child),
          ]),
        );
      return value;
    };
    const output = JSON.stringify(clean(parsed));
    return new TextEncoder().encode(output).byteLength <= MAX_REPAIR_OUTPUT_BYTES
      ? output
      : undefined;
  } catch {
    return undefined;
  }
}
