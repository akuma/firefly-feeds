import { FeedError, layoutFor, readFeed } from "@/lib/feed-server";
import { hashString } from "@/lib/feed-html";
import { readingTime } from "@/lib/articles";

export const dynamic = "force-dynamic";

/**
 * Feed intake. Runs on the server so publishers never have to send CORS
 * headers, and so the reader's own page stays free of third-party requests
 * until the reader chooses to subscribe.
 *
 *   GET /api/feed?url=daringfireball.net            → preview (first 5 items)
 *   GET /api/feed?url=daringfireball.net&full=1     → every item, with bodies
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get("url") ?? "";
  const full = params.get("full") === "1";

  if (!input.trim()) {
    return Response.json({ ok: false, error: "Enter a feed or site address." }, { status: 400 });
  }

  try {
    const feed = await readFeed(input);
    const items = full ? feed.items : feed.items.slice(0, 5);

    return Response.json(
      {
        ok: true,
        feed: {
          title: feed.title,
          siteUrl: feed.siteUrl,
          feedUrl: feed.feedUrl,
          description: feed.description,
          kind: feed.kind,
          host: safeHost(feed.siteUrl || feed.feedUrl),
          count: feed.items.length,
          id: `x${hashString(feed.feedUrl).toString(36)}`,
        },
        items: items.map((item, index) => ({
          ...item,
          body: full ? item.body : [],
          truncated: Boolean(item.truncated),
          minutes: readingTime(item.body),
          layout: layoutFor(index, Boolean(item.image), item.body.some((b) => b.kind === "quote")),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 500;
    const message =
      error instanceof FeedError ? error.message : "Something went wrong while reading that feed.";
    return Response.json({ ok: false, error: message }, { status });
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
