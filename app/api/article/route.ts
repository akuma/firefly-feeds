import { readArticle } from "@/lib/article-server";
import { FeedError } from "@/lib/feed-server";
import { fromAnotherSite, withinRateLimit } from "../guards";

export const dynamic = "force-dynamic";

/**
 * Full-text extraction for one article, on demand.
 *
 *   GET /api/article?url=https://example.com/a-piece
 *
 * Called when a reader opens a story whose feed body was only a summary. It
 * fetches the article the reader chose — never a background sweep of every
 * subscription — and returns it as the reader's own block model.
 *
 * Unlike `/api/feed`, the target here is routinely a different origin, so
 * `fromAnotherSite` protects this endpoint while the target's own safety rules
 * come from `isSafeTargetUrl`.
 */
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url") ?? "";

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
    const article = await readArticle(input);
    return Response.json({ ok: true, article }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 500;
    const message =
      error instanceof FeedError ? error.message : "Something went wrong while reading that page.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
