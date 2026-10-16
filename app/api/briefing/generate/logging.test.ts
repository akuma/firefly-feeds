import { afterEach, expect, it, vi } from "vitest";
import { writeBriefingLog } from "./logging";

afterEach(() => vi.restoreAllMocks());

it("writes bounded JSON logs with timestamps, severity and redacted parameters", () => {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  writeBriefingLog(
    "warn",
    "response",
    {
      requestId: "req-1",
      parameters: {
        runId: "run-1",
        attempt: 2,
        phase: "shortlist",
        model: "deepseek-flash",
        apiKey: "private",
        headers: { authorization: "Bearer private" },
      },
      response: { status: 502, preview: "secret-test-key " + "x".repeat(20_000) },
    },
    ["secret-test-key"],
  );
  const line = String(spy.mock.calls[0][0]);
  const entry = JSON.parse(line);
  expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(entry.level).toBe("WARN");
  expect(entry.event).toBe("response");
  expect(entry.requestId).toBe("req-1");
  expect(line.length).toBeLessThanOrEqual(4000);
  expect(line).not.toMatch(/private|secret-test-key/);
  expect(line).toContain("truncated");
});

it("keeps escape-heavy oversized log records valid JSON within the line cap", () => {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  writeBriefingLog("info", "response", {
    requestId: "req-1",
    response: Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`field${i}`, "\u0000".repeat(5000)]),
    ),
  });
  const line = String(spy.mock.calls[0][0]);
  expect(() => JSON.parse(line)).not.toThrow();
  expect(line.length).toBeLessThanOrEqual(4000);
});
