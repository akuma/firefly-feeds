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

  it("keeps a body image in its place instead of lifting it to the cover", () => {
    const article = extractArticle(ARTICLE, "https://example.com/a-piece");
    // no og:image, so the first body figure is the cover
    expect(article.image).toBe("https://example.com/lead.jpg");
    // …but it is still in the body, where the piece put it
    expect(article.blocks.some((b) => b.kind === "figure" && b.src === article.image)).toBe(true);
  });

  it("uses the page's metadata image as the cover when it has one", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:image" content="https://example.com/hero.jpg">
      <title>With a hero</title>
    </head><body><article><h1>With a hero</h1>
      <img src="https://example.com/inline.jpg" width="800" height="600" alt="Inline">
      ${paragraph("Body text that is long enough to be a real article.")}
    </article></body></html>`;
    const article = extractArticle(page, "https://example.com/a");
    expect(article.image).toBe("https://example.com/hero.jpg");
    // the body image is not moved or removed
    expect(
      article.blocks.some((b) => b.kind === "figure" && b.src === "https://example.com/inline.jpg"),
    ).toBe(true);
  });

  it("keeps a metadata cover whose URL contains crop coordinates", () => {
    // the og:image was once mistaken for a 1x1 pixel because “1751x1143”
    // contains that substring
    const hero =
      "https://thumb.test/fit-in/1600x0/filters:focal(1751x1143:1752x1144)/https://cdn.test/heat.jpg";
    const page = `<!doctype html><html><head>
      <meta property="og:image" content="${hero}">
      <title>Heat</title>
    </head><body><article><h1>Heat</h1>
      ${paragraph("Body text that is long enough to be a real article.")}
    </article></body></html>`;
    const article = extractArticle(page, "https://example.com/heat");
    expect(article.image).toBe(hero);
  });

  it("falls back to a body image when the page declares no cover", () => {
    const page = `<!doctype html><html><head><title>No cover</title></head><body><article><h1>No cover</h1>
      <img src="https://cdn.test/chart.png" width="800" height="600" alt="Chart">
      ${paragraph("Body text that is long enough to be a real article.")}
    </article></body></html>`;
    const article = extractArticle(page, "https://example.com/a");
    expect(article.image).toBe("https://cdn.test/chart.png");
  });

  it("leaves a mid-article image where the piece put it", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn.test/cover.jpg">
      <title>Text first</title>
    </head><body><article><h1>Text first</h1>
      ${paragraph("Opening paragraph before any picture.")}
      <figure><img src="https://cdn.test/inset.jpg" width="800" height="600" alt="Inset"><figcaption>An inset caption.</figcaption></figure>
      ${paragraph("More body text after the picture.")}
    </article></body></html>`;
    const article = extractArticle(page, "https://example.com/a");
    expect(article.image).toBe("https://cdn.test/cover.jpg");
    const kinds = article.blocks.map((b) => b.kind);
    // the picture stays after the opening paragraph, not above it
    expect(kinds.indexOf("figure")).toBeGreaterThan(kinds.indexOf("p"));
    // and it keeps the caption the page printed under it
    expect(article.blocks.find((b) => b.kind === "figure")).toMatchObject({
      caption: "An inset caption.",
    });
  });

  it("flags a page that declares itself a video but has no embeddable player", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:type" content="video.other">
      <meta property="og:image" content="https://cdn.test/frame.jpg">
      <title>A BBC video</title>
    </head><body><article><h1>A BBC video</h1>
      ${paragraph("A short description of the video.")}
    </article></body></html>`;
    const article = extractArticle(page, "https://example.com/v");
    expect(article.videoPage).toBe(true);
    expect(article.image).toBe("https://cdn.test/frame.jpg");
  });

  it("does not flag an ordinary article as a video page", () => {
    const page = `<!doctype html><html><head><meta property="og:type" content="article"><title>A</title></head><body><article><h1>A</h1>${paragraph("Body text that is long enough to be a real article.")}</article></body></html>`;
    expect(extractArticle(page, "https://example.com/a").videoPage).toBeUndefined();
  });

  it("flags a website page whose primary entity is a VideoObject", () => {
    // BBC's .co.uk mirror says `website` but carries the video in JSON-LD
    const page = `<!doctype html><html><head>
      <meta property="og:type" content="website">
      <meta property="og:image" content="https://cdn.test/frame.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"A clip"}</script>
      <title>A clip</title>
    </head><body><article><h1>A clip</h1>
      ${paragraph("A short description of the video.")}
    </article></body></html>`;
    expect(extractArticle(page, "https://example.com/v").videoPage).toBe(true);
  });

  it("does not flag an article that merely embeds a VideoObject", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:type" content="article">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Embedded"}</script>
      <title>Article</title>
    </head><body><article><h1>Article</h1>
      ${paragraph("Body text that is long enough to be a real article.")}
    </article></body></html>`;
    expect(extractArticle(page, "https://example.com/a").videoPage).toBeUndefined();
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

const VIDEO_PAGE = `<!doctype html>
<html>
  <head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"The Chinese room","embedUrl":"https://www.youtube.com/embed/3ezPMAoxSbw"}</script>
  </head>
  <body>
    <article>
      <h1>The Chinese room</h1>
      ${paragraph("Devised by the late US philosopher John Searle in 1980.")}
      <p>Video by TED-Ed</p>
      <p>Directors: Hernando Bahamon</p>
      <p>Producer: Sazia Afrin</p>
      <p>Writers: Charles Wallace</p>
    </article>
  </body>
</html>`;

describe("video embeds", () => {
  it("turns a schema.org VideoObject into a playable video block", () => {
    const article = extractArticle(VIDEO_PAGE, "https://example.com/videos/x");
    expect(article.blocks[0]).toMatchObject({
      kind: "video",
      provider: "youtube",
      id: "3ezPMAoxSbw",
      title: "The Chinese room",
    });
  });

  it("reads a Vimeo player from Open Graph metadata", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:video:url" content="https://player.vimeo.com/video/123456789">
    </head><body><article><h1>V</h1>${paragraph("Some body text.")}</article></body></html>`;
    const article = extractArticle(page, "https://example.com/v");
    expect(article.blocks.find((b) => b.kind === "video")).toMatchObject({
      provider: "vimeo",
      id: "123456789",
    });
  });

  it("refuses a video from a host that is not allowlisted", () => {
    const page = `<!doctype html><html><head>
      <meta property="og:video:url" content="https://evil.example/embed/abc">
    </head><body><article><h1>V</h1>${paragraph("Some body text.")}</article></body></html>`;
    const article = extractArticle(page, "https://example.com/v");
    expect(article.blocks.some((b) => b.kind === "video")).toBe(false);
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
