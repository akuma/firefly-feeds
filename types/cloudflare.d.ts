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
  };
}
