import { describe, expect, it } from "vitest";
import {
  ARTICLE_BODY_BUDGET,
  decodeEntities,
  hashString,
  htmlToBlocks,
  htmlToSummary,
  htmlToText,
  isSafeUrl,
  sharedOpening,
  stripLeadFigure,
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

describe("sharedOpening", () => {
  const house =
    "Subscribe to the newsletter for weekly updates. Write to us at hello@example.com. ";

  it("finds the block a feed repeats in every entry", () => {
    const texts = [house + "First story.", house + "Second story.", house + "Third story."];
    // returned trimmed, so callers can slice without leaving a leading space
    expect(sharedOpening(texts)).toBe(house.trim());
  });

  it("cuts back to a sentence boundary so nothing dangles", () => {
    const texts = [`${house}First story.`, `${house}Second`, `${house}Third story.`];
    const opening = sharedOpening(texts);
    expect(opening.endsWith(".")).toBe(true);
    expect(opening).not.toContain("Second");
  });

  it("cuts at full-width stops too, which is where CJK sentences end", () => {
    const header =
      "这里记录每周值得分享的科技内容，周五发布。本杂志开源，欢迎投稿。" +
      "另有《谁在招人》服务，发布程序员招聘信息。合作请邮件联系（yifeng.ruan@gmail.com）。";
    const texts = [`${header}第一篇内容。`, `${header}第二篇内容。`, `${header}第三篇内容。`];
    expect(sharedOpening(texts)).toBe(header);
  });

  it("says nothing when the entries have nothing in common", () => {
    expect(sharedOpening(["Alpha one.", "Beta two.", "Gamma three."])).toBe("");
  });

  it("ignores a shared opening too short to be boilerplate", () => {
    // three entries opening with the same word is not a subscription pitch
    expect(sharedOpening(["Weekly, part one.", "Weekly, part two.", "Weekly, part three."])).toBe(
      "",
    );
  });

  it("needs a few entries before it will call anything boilerplate", () => {
    expect(sharedOpening([`${house}Only one.`, `${house}And two.`])).toBe("");
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

  it("keeps the feed budget by default but allows the article budget to be asked for", () => {
    // 120 paragraphs of ~300 characters: well past the feed ceiling, inside the
    // article ceiling. The original page must not be cut at the feed budget.
    const html = Array.from({ length: 120 }, (_, i) => `<p>${"word ".repeat(60)}${i}</p>`).join("");
    const feed = htmlToBlocks(html);
    const article = htmlToBlocks(html, undefined, ARTICLE_BODY_BUDGET);
    expect(feed.truncated).toBe(true);
    expect(article.truncated).toBe(false);
    expect(article.blocks.length).toBeGreaterThan(feed.blocks.length);
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

const figureSrcs = (blocks: ReturnType<typeof htmlToBlocks>["blocks"]) =>
  blocks.flatMap((block) => (block.kind === "figure" && block.src ? [block.src] : []));

describe("images", () => {
  it("picks a readable resolution from srcset rather than the smallest thumbnail", () => {
    const { blocks } = htmlToBlocks(
      `<img srcset="https://e.test/small.jpg 320w, https://e.test/mid.jpg 800w, https://e.test/large.jpg 1600w" src="https://e.test/fallback.jpg" alt="x">`,
    );
    expect(figureSrcs(blocks)).toEqual(["https://e.test/large.jpg"]);
  });

  it("takes the largest when every srcset candidate is still a thumbnail", () => {
    const { blocks } = htmlToBlocks(
      `<img srcset="https://e.test/a.jpg 200w, https://e.test/b.jpg 640w" alt="x">`,
    );
    expect(figureSrcs(blocks)).toEqual(["https://e.test/b.jpg"]);
  });

  it("recognises lazy-loading attributes ahead of a placeholder src", () => {
    const { blocks } = htmlToBlocks(
      `<img src="data:image/gif;base64,R0lGOD" data-src="https://e.test/real.jpg" alt="A photo">`,
    );
    expect(figureSrcs(blocks)).toEqual(["https://e.test/real.jpg"]);
  });

  it("recognises data-srcset", () => {
    const { blocks } = htmlToBlocks(
      `<img data-srcset="https://e.test/a.jpg 400w, https://e.test/b.jpg 1400w" data-src="https://e.test/c.jpg" alt="x">`,
    );
    expect(figureSrcs(blocks)).toEqual(["https://e.test/b.jpg"]);
  });

  it("recognises a picture element's source", () => {
    const { blocks } = htmlToBlocks(
      `<picture><source srcset="https://e.test/hero.webp 1200w" type="image/webp"><img src="https://e.test/hero.jpg" alt="Hero"></picture>`,
    );
    expect(figureSrcs(blocks)).toEqual(["https://e.test/hero.webp"]);
  });

  it("discards logos, author portraits and profile pictures", () => {
    const { blocks } = htmlToBlocks(`
      <img src="https://e.test/logo.png" width="600" height="200" alt="Site logo">
      <img src="https://e.test/pic.jpg" class="author-avatar" width="600" height="600">
      <img src="https://e.test/profile.jpg" width="600" height="600" alt="Portrait">
      <p>Real content.</p>
    `);
    expect(figureSrcs(blocks)).toEqual([]);
  });

  it("keeps document order and drops a repeated resolved URL", () => {
    const { blocks } = htmlToBlocks(`
      <img src="https://e.test/a.jpg" width="600" height="400" alt="first">
      <img src="https://e.test/b.jpg" width="600" height="400" alt="second">
      <img src="https://e.test/a.jpg" width="600" height="400" alt="again">
      <img src="https://e.test/c.jpg" width="600" height="400" alt="third">
    `);
    // first occurrence wins; the order is untouched
    expect(figureSrcs(blocks)).toEqual([
      "https://e.test/a.jpg",
      "https://e.test/b.jpg",
      "https://e.test/c.jpg",
    ]);
  });

  it("removes only the lead figure from the body", () => {
    const blocks = [
      { kind: "figure" as const, src: "https://e.test/a.jpg", caption: "", seed: 1 },
      { kind: "p" as const, text: "Text" },
      { kind: "figure" as const, src: "https://e.test/b.jpg", caption: "", seed: 2 },
    ];
    expect(figureSrcs(stripLeadFigure(blocks, "https://e.test/a.jpg"))).toEqual([
      "https://e.test/b.jpg",
    ]);
    // a lead that never appeared in the body removes nothing
    expect(stripLeadFigure(blocks, "https://e.test/c.jpg")).toHaveLength(3);
  });
});
