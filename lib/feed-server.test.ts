import { describe, expect, it } from "vitest";
import { FeedError, layoutFor, normalizeInputUrl, parseFeedXml } from "./feed-server";

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
});

describe("layoutFor", () => {
  it("gives the newest entry a wider treatment and varies the rest", () => {
    expect(layoutFor(0, true, false)).toBe("standard");
    expect(layoutFor(0, false, false)).toBe("compact");
    expect(layoutFor(3, false, false)).toBe("brief");
    // deterministic: the stream rhythm must not reshuffle between renders
    expect(layoutFor(9, true, false)).toBe(layoutFor(9, true, false));
  });
});
