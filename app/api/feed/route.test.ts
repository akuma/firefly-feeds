import { describe, expect, it } from "vitest";
import { fromAnotherSite } from "./route";

/**
 * The rate limiter is a Cloudflare binding with no local implementation worth
 * testing against — under `wrangler dev` it accepts every request — so it is
 * verified against the deployed Worker instead. This is the half that is
 * ordinary code.
 */
const at = (url: string, headers: Record<string, string> = {}) =>
  fromAnotherSite(new Request(url, { headers }));

describe("fromAnotherSite", () => {
  it("refuses a request a browser made from somebody else's page", () => {
    expect(
      at("https://feeds.fireflylabs.studio/api/feed", { "sec-fetch-site": "cross-site" }),
    ).toBe(true);
    expect(
      at("https://feeds.fireflylabs.studio/api/feed", { origin: "https://evil.example" }),
    ).toBe(true);
    // a malformed Origin is not a reason to serve somebody
    expect(at("https://feeds.fireflylabs.studio/api/feed", { origin: "not a url" })).toBe(true);
  });

  it("allows the application's own requests", () => {
    expect(
      at("https://feeds.fireflylabs.studio/api/feed", {
        "sec-fetch-site": "same-origin",
        origin: "https://feeds.fireflylabs.studio",
      }),
    ).toBe(false);
  });

  it("allows requests with no origin at all", () => {
    // curl, a native client, and a same-origin GET all look like this; the rate
    // limit is what covers them, not this check
    expect(at("https://feeds.fireflylabs.studio/api/feed")).toBe(false);
  });
});
