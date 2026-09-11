import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  hashString,
  htmlToBlocks,
  htmlToSummary,
  htmlToText,
  isSafeUrl,
} from "./feed-html";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("A&amp;B")).toBe("A&B");
    expect(decodeEntities("caf&#233;")).toBe("café");
    expect(decodeEntities("caf&#xe9;")).toBe("café");
    expect(decodeEntities("5 &lt; 6 &gt; 4")).toBe("5 < 6 > 4");
  });

  it("decodes the typographic entities feeds actually use", () => {
    expect(decodeEntities("wait&hellip;")).toBe("wait…");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
    expect(decodeEntities("it&rsquo;s")).toBe("it’s");
  });

  it("leaves unknown entities and refuses to emit surrogate halves", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#999999999;")).toBe("&#999999999;");
  });
});

describe("isSafeUrl", () => {
  it("accepts http, https and protocol-relative", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("http://example.com/a")).toBe(true);
    expect(isSafeUrl("//example.com/a")).toBe(true);
  });

  it("rejects javascript, data and relative URLs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("/relative")).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });
});

describe("hashString", () => {
  it("is deterministic and non-negative", () => {
    expect(hashString("kottke")).toBe(hashString("kottke"));
    expect(hashString("kottke")).toBeGreaterThanOrEqual(0);
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});

describe("htmlToText", () => {
  it("turns block boundaries into line breaks and strips the rest", () => {
    const text = htmlToText("<p>One</p><p>Two</p><div>Three</div>");
    expect(text.split("\n").filter(Boolean)).toHaveLength(3);
    expect(text).toContain("One");
    expect(text).toContain("Three");
  });

  it("drops script and style content entirely", () => {
    const text = htmlToText("<p>Keep</p><script>window.x=1</script><style>a{}</style>");
    expect(text).toBe("Keep");
    expect(text).not.toContain("window.x");
  });
});

describe("htmlToSummary", () => {
  it("truncates on a sentence boundary with an ellipsis", () => {
    const long = `<p>${"First sentence here. ".repeat(20)}</p>`;
    const summary = htmlToSummary(long, 100);
    expect(summary.length).toBeLessThanOrEqual(101);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("returns short text unchanged", () => {
    expect(htmlToSummary("<p>A short note.</p>")).toBe("A short note.");
  });
});

describe("htmlToBlocks", () => {
  it("maps the common feed vocabulary onto the reader's own blocks", () => {
    const { blocks } = htmlToBlocks(`
      <p>Opening paragraph.</p>
      <h2>A heading</h2>
      <blockquote>Something worth pulling out.</blockquote>
      <ul><li>One</li><li>Two</li></ul>
      <pre>const a = 1;</pre>
    `);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "h2", "quote", "list", "code"]);
    expect(blocks[1]).toMatchObject({ kind: "h2", text: "A heading" });
    expect(blocks[3]).toMatchObject({ items: ["One", "Two"] });
  });

  it("resolves images to absolute URLs and never emits raw HTML", () => {
    const { blocks } = htmlToBlocks(
      '<p>x</p><img src="/photo.jpg" alt="A photo" width="800" height="600">',
      "https://example.com/posts/one",
    );
    const figure = blocks.find((b) => b.kind === "figure");
    expect(figure).toMatchObject({ src: "https://example.com/photo.jpg", caption: "A photo" });
    expect(JSON.stringify(blocks)).not.toContain("<img");
  });

  it("discards tracking pixels, avatars and share badges", () => {
    const { blocks } = htmlToBlocks(`
      <img src="https://feedburner.google.com/pixel.gif" width="1" height="1">
      <img src="https://gravatar.com/avatar/abc" width="200" height="200">
      <p>Real content.</p>
    `);
    expect(blocks.some((b) => b.kind === "figure")).toBe(false);
  });

  it("removes the WordPress trailer even when it carries no title", () => {
    const { blocks } = htmlToBlocks(
      "<p>Actual writing.</p><p>The post Appeared First On Example. </p>",
    );
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).not.toMatch(/appeared first on/i);
  });

  it("removes a trailing 'Read more' but keeps the prose before it", () => {
    const { blocks } = htmlToBlocks("<p>Real sentence.</p><p>Continue reading</p>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ text: "Real sentence." });
  });

  it("leaves a body that merely mentions a post trailer alone", () => {
    const { blocks } = htmlToBlocks("<p>Why the post appeared first on the page matters.</p>");
    expect(blocks).toHaveLength(1);
  });

  it("stops at the character budget and says it truncated", () => {
    const html = Array.from({ length: 40 }, (_, i) => `<p>${"word ".repeat(80)}${i}</p>`).join("");
    const { blocks, truncated } = htmlToBlocks(html);
    expect(truncated).toBe(true);
    expect(blocks.length).toBeLessThanOrEqual(60);
    expect(JSON.stringify(blocks).length).toBeLessThan(12_000);
  });

  it("does not claim truncation for a body that fits", () => {
    const { truncated } = htmlToBlocks("<p>Short.</p>");
    expect(truncated).toBe(false);
  });

  it("collapses duplicate neighbouring paragraphs", () => {
    const { blocks } = htmlToBlocks("<p>Same.</p><p>Same.</p>");
    expect(blocks).toHaveLength(1);
  });

  it("ignores empty input and self-closing-only markup", () => {
    expect(htmlToBlocks("").blocks).toEqual([]);
    expect(htmlToBlocks("<hr><br>").blocks).toEqual([]);
  });

  it("splits a runaway paragraph rather than emitting one enormous block", () => {
    const runaway = `<p>${"This is a sentence. ".repeat(200)}</p>`;
    const { blocks } = htmlToBlocks(runaway);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      if (block.kind === "p") expect(block.text.length).toBeLessThan(1000);
    }
  });
});
