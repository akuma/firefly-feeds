import { describe, expect, it } from "vitest";
import { FeedError, layoutFor, normalizeInputUrl, parseFeedXml, readCapped } from "./feed-server";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Weekly</title>
    <link>https://example.com</link>
    <description>Notes from nowhere</description>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <dc:creator>Ada Lovelace</dc:creator>
      <pubDate>Thu, 11 Sep 2025 09:00:00 GMT</pubDate>
      <description>&lt;p&gt;A summary.&lt;/p&gt;</description>
      <content:encoded><![CDATA[<p>Body one.</p><p>Body two.</p>]]></content:encoded>
      <media:content url="https://example.com/hero.jpg" medium="image"/>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/second</link>
      <description>Short.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Weekly</title>
  <subtitle>An atom feed</subtitle>
  <author><name>Grace Hopper</name></author>
  <link rel="alternate" type="text/html" href="https://atom.example/"/>
  <link rel="self" href="https://atom.example/feed.xml"/>
  <entry>
    <title>An entry</title>
    <link rel="self" href="https://atom.example/self"/>
    <link rel="alternate" href="/entry-one"/>
    <published>2025-09-10T12:00:00Z</published>
    <content type="html">&lt;p&gt;Atom body.&lt;/p&gt;</content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example/">
    <title>RDF Weekly</title>
    <link>https://rdf.example/</link>
  </channel>
  <item rdf:about="https://rdf.example/one">
    <title>An RDF item</title>
    <link>https://rdf.example/one</link>
    <dc:date>2025-09-09T08:00:00Z</dc:date>
    <description>RDF body.</description>
  </item>
</rdf:RDF>`;

const rssItem = (title: string, link: string) =>
  `<item><title>${title}</title><link>${link}</link><description>x</description></item>`;
const rssDoc = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title><link>https://x.test</link><description>d</description>${items}</channel></rss>`;
const rssWith = (item: string) =>
  `<rss version="2.0"><channel><title>X</title><link>https://x.test</link><description>d</description>${item}</channel></rss>`;
const atomWith = (entry: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><title>X</title>${entry}</feed>`;

describe("normalizeInputUrl", () => {
  it("adds https to a bare host", () => {
    expect(normalizeInputUrl("daringfireball.net")).toBe("https://daringfireball.net/");
  });

  it("keeps an explicit scheme and path", () => {
    expect(normalizeInputUrl("https://example.com/feed.xml")).toBe("https://example.com/feed.xml");
  });

  it("rejects empty input and non-web schemes", () => {
    expect(() => normalizeInputUrl("   ")).toThrow(FeedError);
    expect(() => normalizeInputUrl("file:///etc/passwd")).toThrow(/http/i);
    expect(() => normalizeInputUrl("javascript:alert(1)")).toThrow(FeedError);
  });
});

describe("parseFeedXml", () => {
  it("parses RSS 2.0 with namespaced modules", () => {
    const feed = parseFeedXml(RSS, "https://example.com/feed");
    expect(feed.kind).toBe("rss");
    expect(feed.title).toBe("Example Weekly");
    // an absolute href is passed through untouched, not rewritten
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.description).toBe("Notes from nowhere");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].author).toBe("Ada Lovelace");
    expect(feed.items[0].image).toBe("https://example.com/hero.jpg");
    expect(feed.items[0].body.map((b) => b.kind)).toEqual(["p", "p"]);
    expect(feed.items[0].publishedMs).toBe(Date.parse("Thu, 11 Sep 2025 09:00:00 GMT"));
  });

  it("parses Atom and falls back to the feed-level author", () => {
    const feed = parseFeedXml(ATOM, "https://atom.example/feed.xml");
    expect(feed.kind).toBe("atom");
    expect(feed.title).toBe("Atom Weekly");
    // the rel=self link must not win over rel=alternate
    expect(feed.siteUrl).toBe("https://atom.example/");
    expect(feed.items[0].link).toBe("https://atom.example/entry-one");
    expect(feed.items[0].author).toBe("Grace Hopper");
  });

  it("parses RSS 1.0 / RDF", () => {
    const feed = parseFeedXml(RDF, "https://rdf.example/rdf");
    expect(feed.kind).toBe("rdf");
    expect(feed.title).toBe("RDF Weekly");
    expect(feed.items[0].title).toBe("An RDF item");
  });

  it("keeps entry ids stable when a new entry is inserted above them", () => {
    // the id used to include the entry's position, so a feed that published a
    // new post handed every later story a new id — remounting the whole list
    // and orphaning its reading state on every refresh
    const before = parseFeedXml(
      rssDoc(rssItem("Second", "https://x.test/second")),
      "https://x.test/feed",
    );
    const after = parseFeedXml(
      rssDoc(rssItem("First", "https://x.test/first") + rssItem("Second", "https://x.test/second")),
      "https://x.test/feed",
    );

    const secondBefore = before.items.find((i) => i.link === "https://x.test/second")!;
    const secondAfter = after.items.find((i) => i.link === "https://x.test/second")!;
    expect(secondAfter.id).toBe(secondBefore.id);
  });

  it("throws a typed error for a document that is not a feed", () => {
    expect(() => parseFeedXml("<html><body>hi</body></html>", "https://x.example")).toThrow(
      /no feed/i,
    );
  });

  it("throws when a feed has no readable entries", () => {
    const empty = `<rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    expect(() => parseFeedXml(empty, "https://x.example/feed")).toThrow(FeedError);
  });

  it("survives a malformed date instead of failing the whole feed", () => {
    const feed = parseFeedXml(
      `<rss version="2.0"><channel><title>T</title><item><title>A</title><pubDate>not a date</pubDate><description>x</description></item></channel></rss>`,
      "https://x.example/feed",
    );
    expect(feed.items[0].publishedMs).toBeUndefined();
  });

  it("gives each entry a stable id across repeated parses", () => {
    const a = parseFeedXml(RSS, "https://example.com/feed");
    const b = parseFeedXml(RSS, "https://example.com/feed");
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });

  describe("article identity", () => {
    it("prefers the RSS guid over the link", () => {
      const idFor = (link: string) =>
        parseFeedXml(
          rssWith(
            `<item><title>A</title><guid isPermaLink="false">urn:uuid:stable</guid><link>${link}</link><description>x</description></item>`,
          ),
          "https://x.test/feed",
        ).items[0].id;
      // the publisher's id survives a URL change
      expect(idFor("https://x.test/a")).toBe(idFor("https://x.test/moved"));
    });

    it("prefers the Atom entry id over the link", () => {
      const idFor = (link: string) =>
        parseFeedXml(
          atomWith(
            `<entry><title>A</title><id>tag:x.test,2025:stable</id><link href="${link}"/><updated>2025-09-10T12:00:00Z</updated><content type="html">&lt;p&gt;x&lt;/p&gt;</content></entry>`,
          ),
          "https://x.test/feed.xml",
        ).items[0].id;
      expect(idFor("https://x.test/a")).toBe(idFor("https://x.test/moved"));
    });

    it("falls back to the link when the publisher offers no id", () => {
      const feed = parseFeedXml(
        rssWith(
          `<item><title>A</title><link>https://x.test/a</link><description>x</description></item>`,
        ),
        "https://x.test/feed",
      );
      const again = parseFeedXml(
        rssWith(
          `<item><title>A renamed</title><link>https://x.test/a</link><description>new body</description></item>`,
        ),
        "https://x.test/feed",
      );
      expect(feed.items[0].id).toBe(again.items[0].id);
    });

    it("uses title and published time when there is neither id nor link", () => {
      const idFor = (title: string, date: string, body: string) =>
        parseFeedXml(
          rssWith(
            `<item><title>${title}</title><pubDate>${date}</pubDate><description>${body}</description></item>`,
          ),
          "https://x.test/feed",
        ).items[0].id;
      const base = idFor("A", "Thu, 11 Sep 2025 09:00:00 GMT", "first");
      // a renamed body does not move the identity
      expect(idFor("A", "Thu, 11 Sep 2025 09:00:00 GMT", "second")).toBe(base);
      // but a different entry does
      expect(idFor("B", "Thu, 11 Sep 2025 09:00:00 GMT", "first")).not.toBe(base);
    });

    it("keeps an item that has a publisher id but no article URL", () => {
      const feed = parseFeedXml(
        rssWith(
          `<item><title>A</title><guid>urn:uuid:no-url</guid><description>x</description></item>`,
        ),
        "https://x.test/feed",
      );
      expect(feed.items[0].link).toBeUndefined();
      expect(feed.items[0].id).toBeTruthy();
    });

    it("never derives identity from the entry's position", () => {
      const one = parseFeedXml(
        rssWith(rssItem("Only", "https://x.test/only")),
        "https://x.test/feed",
      ).items[0].id;
      const second = parseFeedXml(
        rssWith(
          rssItem("Inserted", "https://x.test/inserted") + rssItem("Only", "https://x.test/only"),
        ),
        "https://x.test/feed",
      ).items.find((i) => i.link === "https://x.test/only")!.id;
      expect(second).toBe(one);
    });
  });

  it("tells a full body from a summary by which field it came from", () => {
    const feed = parseFeedXml(RSS, "https://example.com/feed");
    // `<content:encoded>` is the publisher handing over the piece
    expect(feed.items[0].contentState).toBe("full");
    // `<description>` alone is their summary
    expect(feed.items[1].contentState).toBe("summary");
  });

  describe("cover images", () => {
    it("uses a body image as the cover and leaves it in the body", () => {
      const feed = parseFeedXml(
        `<rss version="2.0"><channel><title>T</title><link>https://x.test</link><description>d</description><item><title>A</title><link>https://x.test/a</link><description><![CDATA[<p>Text</p><img src="https://x.test/lead.jpg" width="800" height="600" alt="Lead"><p>More</p>]]></description></item></channel></rss>`,
        "https://x.test/feed",
      );
      expect(feed.items[0].image).toBe("https://x.test/lead.jpg");
      // the image is a stream thumbnail only; the body keeps it where it was
      expect(feed.items[0].body.filter((b) => b.kind === "figure")).toHaveLength(1);
      expect(feed.items[0].body.some((b) => b.kind === "p")).toBe(true);
    });

    it("prefers the feed's declared cover and still leaves the body alone", () => {
      const feed = parseFeedXml(
        `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title><link>https://x.test</link><description>d</description><item><title>A</title><link>https://x.test/a</link><description><![CDATA[<p>Text</p><img src="https://x.test/hero.jpg" width="800" height="600" alt="Hero">]]></description><media:content url="https://x.test/hero.jpg"/></item></channel></rss>`,
        "https://x.test/feed",
      );
      expect(feed.items[0].image).toBe("https://x.test/hero.jpg");
      expect(feed.items[0].body.filter((b) => b.kind === "figure")).toHaveLength(1);
    });
  });

  it("downgrades a content body that ends in a read-more stub", () => {
    const body = "Substantial paragraph text that runs on. ".repeat(20);
    const feed = parseFeedXml(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title><item><title>A</title><link>https://x.example/a</link><content:encoded><![CDATA[<p>${body}</p><p><a href="/a">Continue reading</a></p>]]></content:encoded></item></channel></rss>`,
      "https://x.example/feed",
    );
    expect(feed.items[0].contentState).toBe("summary");
  });

  it("downgrades a content body that is exactly the description", () => {
    // some feeds put their one-paragraph teaser in content:encoded
    const feed = parseFeedXml(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title><item><title>A</title><link>https://x.example/a</link><description>Just the teaser.</description><content:encoded><![CDATA[<p>Just the teaser.</p>]]></content:encoded></item></channel></rss>`,
      "https://x.example/feed",
    );
    expect(feed.items[0].contentState).toBe("summary");
  });

  it("marks a body cut by our own budget as truncated", () => {
    const huge = `<p>${"word ".repeat(3000)}</p>`;
    const feed = parseFeedXml(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title><item><title>A</title><link>https://x.example/a</link><content:encoded><![CDATA[${huge}]]></content:encoded></item></channel></rss>`,
      "https://x.example/feed",
    );
    expect(feed.items[0].contentState).toBe("truncated");
  });
});

describe("readCapped", () => {
  it("reads a document that fits", async () => {
    const body = "<rss><channel><title>Fine</title></channel></rss>";
    expect(await readCapped(new Response(body), 1000)).toBe(body);
  });

  it("refuses from the declared length, without touching the body", async () => {
    // a ReadableStream starts pulling as soon as it is constructed, so counting
    // pulls proves nothing. Booby-trapping the reader does.
    const booby = new Error("the body should not have been read");
    const response = {
      headers: new Headers({ "content-length": "99999999" }),
      body: {
        getReader: () => {
          throw booby;
        },
      },
      text: () => {
        throw booby;
      },
    } as unknown as Response;

    await expect(readCapped(response, 1000)).rejects.toThrow(/too large/i);
  });

  it("stops mid-stream when the body is larger than it claimed", async () => {
    // no content-length, so the ceiling has to be enforced while reading
    let chunksSent = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          chunksSent += 1;
          controller.enqueue(new Uint8Array(1000));
        },
      }),
      { headers: { "content-type": "application/xml" } },
    );

    await expect(readCapped(response, 2500)).rejects.toThrow(FeedError);
    // three chunks of a thousand against a 2500 ceiling — not a hundred
    expect(chunksSent).toBeLessThanOrEqual(4);
  });

  it("counts bytes, not characters", async () => {
    // a multi-byte character split across chunks must not be miscounted
    const text = "科技爱好者周刊".repeat(200);
    const bytes = new TextEncoder().encode(text);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 7) {
            controller.enqueue(bytes.slice(i, i + 7));
          }
          controller.close();
        },
      }),
    );
    expect(await readCapped(response, 1_000_000)).toBe(text);
  });
});

describe("layoutFor", () => {
  it("follows the story, not its position in the feed", () => {
    // a picture earns a thumbnail row
    expect(layoutFor({ hasImage: true, hasSummary: true })).toBe("standard");
    // otherwise the standard row
    expect(layoutFor({ hasImage: false, hasSummary: true })).toBe("compact");
    // and only a genuinely bare entry gets the contents-page row, where
    // hiding a summary that does not exist costs nothing
    expect(layoutFor({ hasImage: false, hasSummary: false })).toBe("brief");
    expect(layoutFor({ hasImage: true, hasSummary: false })).toBe("brief");
  });
});
