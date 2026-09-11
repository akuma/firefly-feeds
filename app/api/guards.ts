/**
 * Request guards shared by the routes that fetch something on the reader's
 * behalf.
 *
 * These protect *our* endpoint — they are not the rules for fetching a
 * publisher's page. A cross-origin article URL is the normal case for the
 * extractor, so its own safety rules live in `lib/url-safety.ts`.
 */

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

export async function withinRateLimit(request: Request): Promise<boolean> {
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
