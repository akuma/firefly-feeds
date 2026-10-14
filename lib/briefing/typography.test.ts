import { describe, expect, it } from "vitest";
import { formatBriefingText } from "./typography";

describe("briefing mixed-script typography", () => {
  it.each([
    ["Feldman对家用AI设备...", "Feldman 对家用 AI 设备..."],
    ["OpenAI的GPT-4.1模型支持128K上下文。", "OpenAI 的 GPT-4.1 模型支持 128K 上下文。"],
    ["Feldman 對家用 AI 設備", "Feldman 對家用 AI 設備"],
    ["模型增长3.5倍，2026年发布。", "模型增长 3.5 倍，2026 年发布。"],
    ["Café与Cafe\u0301都保留原拼写。", "Café 与 Cafe\u0301 都保留原拼写。"],
    ["“AI”与（GPU）保持标点。", "“AI”与（GPU）保持标点。"],
    ["Only English remains unchanged.", "Only English remains unchanged."],
  ])("formats %s", (input, expected) => {
    expect(formatBriefingText(input)).toBe(expected);
    expect(formatBriefingText(expected)).toBe(expected);
  });
  it("preserves URLs, email addresses and code verbatim", () => {
    expect(
      formatBriefingText(
        "参考https://example.com/中文?q=AI，联系foo@example.com咨询AI；代码`AI模型_v2`保持不变。",
      ),
    ).toBe(
      "参考 https://example.com/中文?q=AI，联系 foo@example.com 咨询 AI；代码`AI模型_v2`保持不变。",
    );
    expect(formatBriefingText("```\nconst AI模型 = 2;\n```\n中文AI")).toBe(
      "```\nconst AI模型 = 2;\n```\n中文 AI",
    );
  });
  it("keeps Japanese and Korean editions and detected source text unchanged", () => {
    expect(formatBriefingText("AI技術", "ja")).toBe("AI技術");
    expect(formatBriefingText("AI技術", "ko")).toBe("AI技術");
    expect(formatBriefingText("AI技術について", "source")).toBe("AI技術について");
  });
});
