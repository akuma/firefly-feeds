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

  it("keeps the lead image out of the body", () => {
    const article = extractArticle(ARTICLE, "https://example.com/a-piece");
    expect(article.image).toBe("https://example.com/lead.jpg");
    // ArticlePane renders the image above the body; a second copy reads as a
    // different picture, or as padding
    expect(article.blocks.some((b) => b.kind === "figure" && b.src === article.image)).toBe(false);
  });

  it("does not cut a real article at the feed budget", () => {
    const body = Array.from(
      { length: 20 },
      (_, i) => `<p>Paragraph ${i}. ${"Long sentence here. ".repeat(30)}</p>`,
    ).join("");
    const page = `<!doctype html><html><head><title>Long</title></head><body><article><h1>Long</h1>${body}</article></body></html>`;
    const article = extractArticle(page, "https://example.com/long");
    // the old pipeline reused the 8,000-character feed budget here and then
    // reported the cut body as complete
    expect(article.truncated).toBe(false);
    expect(JSON.stringify(article.blocks).length).toBeGreaterThan(8_000);
  });

  it("reports truncation when even the article budget is exceeded", () => {
    const body = Array.from(
      { length: 100 },
      (_, i) => `<p>Paragraph ${i}. ${"Long sentence here. ".repeat(30)}</p>`,
    ).join("");
    const page = `<!doctype html><html><head><title>Huge</title></head><body><article><h1>Huge</h1>${body}</article></body></html>`;
    const article = extractArticle(page, "https://example.com/huge");
    expect(article.truncated).toBe(true);
    expect(article.blocks.length).toBeLessThanOrEqual(200);
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
      const result = await readArticle("https://example.com/a");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.article.blocks.length).toBeGreaterThan(0);
      await expect(readArticle("https://example.com/json")).rejects.toThrow(/not a web page/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/** Runs `readArticle` against a fake fetch and returns the headers it sent. */
async function capturedHeaders(
  response: () => Response,
  conditions?: Parameters<typeof readArticle>[1],
): Promise<{ headers: Headers; result: Awaited<ReturnType<typeof readArticle>> }> {
  const original = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return response();
  }) as typeof fetch;
  try {
    const result = await readArticle("https://example.com/a", conditions);
    return { headers: seen[0], result };
  } finally {
    globalThis.fetch = original;
  }
}

describe("conditional GET", () => {
  it("sends If-None-Match and treats 304 as not modified", async () => {
    const { headers, result } = await capturedHeaders(
      () => new Response(null, { status: 304, headers: { etag: '"abc"' } }),
      { etag: '"abc"' },
    );
    expect(headers.get("if-none-match")).toBe('"abc"');
    expect(headers.get("if-modified-since")).toBeNull();
    expect(result.status).toBe("not-modified");
  });

  it("sends If-Modified-Since when there is no ETag", async () => {
    const when = "Wed, 10 Sep 2025 00:00:00 GMT";
    const { headers, result } = await capturedHeaders(() => new Response(null, { status: 304 }), {
      lastModified: when,
    });
    expect(headers.get("if-modified-since")).toBe(when);
    expect(headers.get("if-none-match")).toBeNull();
    expect(result.status).toBe("not-modified");
  });

  it("prefers the ETag when both validators are known", async () => {
    const { headers } = await capturedHeaders(() => new Response(null, { status: 304 }), {
      etag: '"e"',
      lastModified: "Wed, 10 Sep 2025 00:00:00 GMT",
    });
    expect(headers.get("if-none-match")).toBe('"e"');
    expect(headers.get("if-modified-since")).toBeNull();
  });

  it("returns the validators from a 200", async () => {
    const { result } = await capturedHeaders(
      () =>
        new Response(ARTICLE, {
          headers: {
            "content-type": "text/html",
            etag: '"v2"',
            "last-modified": "Wed, 10 Sep 2025 00:00:00 GMT",
          },
        }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.article.etag).toBe('"v2"');
    expect(result.article.lastModified).toBe("Wed, 10 Sep 2025 00:00:00 GMT");
  });
});
