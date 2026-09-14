import { fetchPage } from "@/lib/article-server";
import { FeedError } from "@/lib/feed-server";
import { runDefuddle, runReadability } from "@/lib/lab-extract";
import type { ExtractOptions } from "@/lib/lab-types";
import { fromAnotherSite, withinRateLimit } from "../../guards";

export const dynamic = "force-dynamic";

/**
 * Extractor comparison lab — development only.
 *
 *   GET /api/lab/compare?url=https://example.com/a-piece
 *   GET /api/lab/compare?url=…&charThreshold=800&removeLowScoring=0
 *
 * Fetches a page once, then runs Readability and Defuddle over the same HTML
 * so the only difference is the extractor. It is deliberately absent from a
 * production build, and it reuses the reader's own fetch guards rather than
 * inventing a second, less careful network path.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const input = params.get("url") ?? "";

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

  const charThreshold = Number(params.get("charThreshold"));
  const options: ExtractOptions = {
    charThreshold: Number.isFinite(charThreshold) && charThreshold > 0 ? charThreshold : undefined,
    keepClasses: params.get("keepClasses") === "1",
    removeLowScoring: params.get("removeLowScoring") !== "0",
    removeHiddenElements: params.get("removeHiddenElements") !== "0",
    removeSmallImages: params.get("removeSmallImages") !== "0",
    includeReplies: params.get("includeReplies") === "1",
    standardize: params.get("standardize") !== "0",
  };

  try {
    const { html, finalUrl } = await fetchPage(input);
    return Response.json(
      {
        ok: true,
        url: finalUrl,
        readability: runReadability(html, finalUrl, options),
        defuddle: runDefuddle(html, finalUrl, options),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 500;
    const message =
      error instanceof FeedError ? error.message : "Something went wrong while reading that page.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
