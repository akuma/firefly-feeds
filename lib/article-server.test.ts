import { describe, expect, it } from "vitest";
import { extractArticle, readArticle } from "./article-server";
import { FeedError } from "./feed-server";

const paragraph = (lead: string) =>
  `<p>${lead} ${"The quick brown fox jumps over the lazy dog. ".repeat(12)}</p>`;

const ARTICLE = `<!doctype html>
<html>
  <head><title>An Example Piece</title></head>
  <body>
    <nav><a href="/">Home</a> · <a href="/about">About</a></nav>
    <article>
      <h1>An Example Piece</h1>
      <p class="byline">By Ada Lovelace</p>
      ${paragraph("First paragraph.")}
      ${paragraph("Second paragraph.")}
      <img src="/lead.jpg" alt="A lead image">
    </article>
    <footer>© Example</footer>
  </body>
</html>`;

describe("extractArticle", () => {
  it("pulls the body out of a page as reader blocks", () => {
    const article = extractArticle(ARTICLE, "https://example.com/a-piece");
    expect(article.title).toBe("An Example Piece");
    expect(article.blocks.length).toBeGreaterThan(0);
    expect(article.blocks.some((b) => b.kind === "p")).toBe(true);
    // relative URLs are resolved against the article that was fetched
    expect(article.image).toBe("https://example.com/lead.jpg");
    // the nav and footer do not come along
    expect(JSON.stringify(article.blocks)).not.toContain("About");
  });

  it("fails when the page has no article in it", () => {
    const nav = `<!doctype html><html><body><nav><a href="/">Home</a></nav><p>Hi</p></body></html>`;
    expect(() => extractArticle(nav, "https://example.com/")).toThrow(FeedError);
  });
});

describe("readArticle", () => {
  it("refuses a target address before making any request", async () => {
    await expect(readArticle("http://localhost/x")).rejects.toThrow(/cannot be read/i);
    await expect(readArticle("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      FeedError,
    );
  });

  it("re-validates after a redirect", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/secret" },
      })) as typeof fetch;
    try {
      await expect(readArticle("https://example.com/a")).rejects.toThrow(/cannot be read/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads an HTML page and rejects anything else", async () => {
    const original = globalThis.fetch;
    const pages: Record<string, Response> = {
      "https://example.com/a": new Response(ARTICLE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      "https://example.com/json": new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      return pages[String(input)] ?? new Response("", { status: 404 });
    }) as typeof fetch;
    try {
      const article = await readArticle("https://example.com/a");
      expect(article.blocks.length).toBeGreaterThan(0);
      await expect(readArticle("https://example.com/json")).rejects.toThrow(/not a web page/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});
