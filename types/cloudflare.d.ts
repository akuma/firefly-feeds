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
     * Cloudflare Workers AI: the account the model runs in, and a token with
     * Workers AI permission. Together they are the only way this app reaches
     * Jev; the key never leaves the server. `.dev.vars` locally, Worker
     * secrets/vars in production.
     */
    CF_API_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
    /**
     * The direct Jev (TypeSafe) key, kept only as a fallback for when the
     * Cloudflare account cannot run a third-party model (for example an AI
     * Gateway with no balance and no BYOK configured). Optional.
     */
    JEV_API_KEY?: string;
  };
}
