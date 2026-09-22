/**
 * The one Workers module this project touches.
 *
 * `wrangler types` is the usual way to get these, but it writes a 580KB
 * declaration of the entire runtime which re-declares `Request`, `Response`,
 * `Headers` and `fetch` alongside the DOM lib this project already compiles
 * against — and it does not declare `cloudflare:workers` at all. One binding
 * with one method is cheaper to state here than to generate.
 */
declare module "cloudflare:workers" {
  export const env: {
    /**
     * Rate limiting for the public feed endpoint. Configured in
     * `wrangler.jsonc`; absent under `vinext start`, where the route degrades
     * to no limiting.
     */
    FEED_FETCH?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    /**
     * Rate limiting for the classification proxy. Separate from the feed
     * binding because the two are spent differently: every feed refresh costs
     * one request, while enabling classification can cost one per story.
     */
    JEV_CLASSIFY?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    /**
     * The Jev API key. A Worker secret in production, `.dev.vars` locally, and
     * deliberately absent from the client — the browser only ever reaches Jev
     * through `app/api/classify`. A reader may override it with their own key,
     * which travels as a request header and is never written server-side.
     */
    JEV_API_KEY?: string;
  };
}
