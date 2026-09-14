import { readArticle } from "@/lib/article-server";
import { FeedError } from "@/lib/feed-server";
import { fromAnotherSite, withinRateLimit } from "../guards";

export const dynamic = "force-dynamic";

/**
 * Full-text extraction for one article.
 *
 *   GET /api/article?url=https://example.com/a-piece
 *   GET /api/article?url=…&etag="v1"            (conditional)
 *
 * Called when a reader opens a story that has an article URL: the original
 * page is the preferred body, and this fetches or revalidates it. It runs one
 * page at a time — never a background sweep of every subscription — and
 * returns the reader's own block model. An `etag` or `lastModified` from a
 * previous response is forwarded as a conditional request; a 304 comes back
 * as `notModified` rather than a body.
 *
 * Unlike `/api/feed`, the target here is routinely a different origin, so
 * `fromAnotherSite` protects this endpoint while the target's own safety rules
 * come from `isSafeTargetUrl`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const input = params.get("url") ?? "";
  const etag = params.get("etag") ?? undefined;
  const lastModified = params.get("lastModified") ?? undefined;

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
    return Response.json({ ok: false, error: "No article address was given." }, { status: 400 });
  }

  try {
    const result = await readArticle(input, { etag, lastModified });
    if (result.status === "not-modified") {
      return Response.json(
        { ok: true, notModified: true, etag: result.etag, lastModified: result.lastModified },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { ok: true, article: result.article },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 500;
    const message =
      error instanceof FeedError ? error.message : "Something went wrong while reading that page.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
