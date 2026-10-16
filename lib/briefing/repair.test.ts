import { expect, it } from "vitest";
import { captureRepairOutput, safeDiagnosticText, MAX_REPAIR_OUTPUT_BYTES } from "./repair";

it("preserves the failed JSON shape while redacting credentials", () => {
  const captured = captureRepairOutput(
    '{"groups":[{"articleIds":"one"}],"apiKey":"private","note":"Bearer abcdef12345 secret-test-key"}',
    ["secret-test-key"],
  );
  expect(JSON.parse(captured!)).toMatchObject({
    groups: [{ articleIds: "one" }],
    apiKey: "[redacted]",
  });
  expect(captured).not.toMatch(/private|abcdef12345|secret-test-key/);
});

it("omits oversized or incomplete output rather than sending cut JSON", () => {
  expect(captureRepairOutput('{"groups":[')).toBeUndefined();
  expect(
    captureRepairOutput(JSON.stringify({ text: "中".repeat(MAX_REPAIR_OUTPUT_BYTES) })),
  ).toBeUndefined();
});

it("bounds diagnostic text after redacting known secrets", () => {
  const text = safeDiagnosticText(
    "secret-test-key " + "x".repeat(10_000),
    ["secret-test-key"],
    200,
  );
  expect(text.length).toBeLessThanOrEqual(240);
  expect(text).not.toContain("secret-test-key");
  expect(text).toContain("truncated");
});

it("redacts credentials even when the model returns them as object keys", () => {
  const captured = captureRepairOutput(
    JSON.stringify({ "secret-test-key": "note", nested: { "Bearer abcdef12345": "note" } }),
    ["secret-test-key"],
  );
  expect(captured).not.toMatch(/secret-test-key|abcdef12345/);
  expect(JSON.parse(captured!)).toHaveProperty("[redacted]", "note");
});
