import { FeedError, layoutFor, readFeed } from "@/lib/feed-server";
import { fromAnotherSite, withinRateLimit } from "../guards";
import { hashString } from "@/lib/feed-html";
import { readingTime } from "@/lib/reading";

export const dynamic = "force-dynamic";

/**
 * Feed intake. Runs on the server so publishers never have to send CORS
 * headers, and so the reader's own page stays free of third-party requests
 * until the reader chooses to subscribe.
 *
 *   GET /api/feed?url=daringfireball.net            → preview (first 5 items)
 *   GET /api/feed?url=daringfireball.net&full=1     → every item, with bodies
 *
 * This endpoint is public, and it fetches a URL somebody else chose. That is
 * the whole feature, so it cannot be an allowlist — but it does mean the route
 * needs to be a poor proxy to abuse, and it is not allowed to be other people's
 * backend. See `withinRateLimit` and `fromAnotherSite`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get("url") ?? "";
  const full = params.get("full") === "1";

  if (fromAnotherSite(request)) {
    return Response.json(
      { ok: false, error: "This endpoint only serves the Firefly Feeds application." },
      { status: 403 },
    );
  }

  if (!(await withinRateLimit(request))) {
    return Response.json(
      { ok: false, error: "Too many requests. Give it a minute and try again." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

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
        items: items.map((item) => ({
          ...item,
          body: full ? item.body : [],
          minutes: readingTime(item.body),
          layout: layoutFor({
            hasImage: Boolean(item.image),
            hasSummary: item.summary.trim().length > 0,
          }),
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
