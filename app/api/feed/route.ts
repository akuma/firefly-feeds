import { FeedError, layoutFor, readFeed } from "@/lib/feed-server";
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
          truncated: Boolean(item.truncated),
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

/* ---------------------------------------------------------------- guards */

type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** Native in workerd, absent everywhere else. See `rateLimiter`. */
const WORKERS_MODULE = "cloudflare:workers";

/**
 * Cloudflare's rate-limiting binding, when the runtime has one.
 *
 * Imported lazily and defensively: the same build also runs under `vinext
 * start` on Node, where `cloudflare:workers` does not resolve. There the
 * limiter is simply absent, which is correct — the Node server is a local
 * production check, not the deployment.
 *
 * The limit itself is in `wrangler.jsonc`: 40 requests a minute per address.
 * Adding a source costs two requests and refreshing one costs a single, so no
 * real reader comes close.
 *
 * Know what this is. Cloudflare describes the API as "permissive, eventually
 * consistent, and intentionally designed to not be used as an accurate
 * accounting system" — each request consults a locally cached counter that
 * converges shortly afterwards. Measured against the deployed Worker: a trickle
 * of two requests a second never trips it, while a 300-request burst in eight
 * seconds drew 20 rejections and left the window saturated for what followed.
 * It damps abuse; it is not a hard quota. A zone-level rate limiting rule in
 * front of the Worker is the ceiling, and it applies before this code runs.
 *
 * The key is the client address, which Cloudflare advises against in general
 * because addresses are shared. An endpoint with no accounts has no better
 * actor to key on, and the failure mode — a shared network throttled together
 * — is preferable to having no limiter at all.
 */
async function rateLimiter(): Promise<RateLimiter | null> {
  try {
    // A variable, so no bundler tries to resolve the specifier statically: it
    // exists in workerd and nowhere else, and a hard import would fail the Node
    // build and the test run before the catch could ever help.
    const mod = (await import(/* @vite-ignore */ WORKERS_MODULE)) as {
      env?: Record<string, unknown>;
    };
    const binding = mod.env?.FEED_FETCH;
    if (binding && typeof (binding as RateLimiter).limit === "function") {
      return binding as RateLimiter;
    }
  } catch {
    /* not on Workers */
  }
  return null;
}

async function withinRateLimit(request: Request): Promise<boolean> {
  const limiter = await rateLimiter();
  if (!limiter) return true;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    // never let the limiter's own failure take the reader down with it
    return true;
  }
}

/**
 * Rejects requests a browser made from somebody else's page, so the Worker
 * cannot be quietly embedded as another site's backend. Requests with no
 * `Origin` at all — curl, a native app, a same-origin GET — are allowed; the
 * rate limit is what covers those.
 */
export function fromAnotherSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
