import { describe, expect, it } from "vitest";
import { blockText, diffParagraphs, paragraphTexts } from "./lab-types";
import type { Block } from "./types";

describe("blockText", () => {
  it("shows a figure's caption, not just its URL", () => {
    expect(
      blockText({ kind: "figure", src: "https://e.test/a.jpg", caption: "A caption", seed: 1 }),
    ).toBe("https://e.test/a.jpg — A caption");
  });

  it("falls back to the URL when a figure has no caption", () => {
    expect(blockText({ kind: "figure", src: "https://e.test/a.jpg", caption: "", seed: 1 })).toBe(
      "https://e.test/a.jpg",
    );
  });
});

describe("paragraphTexts", () => {
  it("keeps paragraph-like blocks and drops the rest", () => {
    const blocks: Block[] = [
      { kind: "p", text: "First." },
      { kind: "figure", src: "https://e.test/a.jpg", caption: "", seed: 1 },
      { kind: "h2", text: "A heading" },
      { kind: "list", items: ["one", "two"] },
    ];
    expect(paragraphTexts(blocks)).toEqual(["First.", "A heading"]);
  });
});

describe("diffParagraphs", () => {
  it("marks paragraphs unique to each side and keeps shared ones", () => {
    expect(diffParagraphs(["shared", "only a"], ["shared", "only b"])).toEqual([
      { kind: "same", text: "shared" },
      { kind: "onlyA", text: "only a" },
      { kind: "onlyB", text: "only b" },
    ]);
  });
});
