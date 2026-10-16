import { safeDiagnosticText } from "@/lib/briefing/repair";

/** Keep server diagnostics useful without logging prompts, credentials or entire articles. */
export function writeBriefingLog(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
  secrets: readonly string[] = [],
): void {
  const clean = (value: unknown, depth = 0, field = ""): unknown => {
    if (
      /^(?:keys|headers|api.?key|authorization|password|secret|access.?token|refresh.?token)$/i.test(
        field,
      )
    )
      return "[redacted]";
    if (typeof value === "string")
      return safeDiagnosticText(value, secrets, field === "preview" ? 800 : 200);
    if (depth > 5) return "[truncated]";
    if (Array.isArray(value))
      return [
        ...value.slice(0, 3).map((child) => clean(child, depth + 1)),
        ...(value.length > 3 ? [`[truncated ${value.length - 3} items]`] : []),
      ];
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 16)
          .map(([key, child]) => [
            safeDiagnosticText(key, secrets, 100),
            clean(child, depth + 1, key),
          ]),
      );
    return value;
  };
  const metadata = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    event: safeDiagnosticText(event, secrets, 100),
  };
  const sanitized = clean(details) as Record<string, unknown>;
  let line = JSON.stringify({ ...sanitized, ...metadata });
  if (line.length > 4000)
    line = JSON.stringify({
      ...metadata,
      requestId:
        typeof sanitized.requestId === "string"
          ? safeDiagnosticText(sanitized.requestId, secrets, 100)
          : undefined,
      preview: safeDiagnosticText(JSON.stringify(sanitized), secrets, 300),
    });
  console[level](line);
}
