/**
 * Whether an address is a reasonable thing for the server to fetch on the
 * reader's behalf.
 *
 * The extractor fetches a URL the reader supplied, and the request leaves from
 * Cloudflare's network rather than the reader's browser — so the classic SSRF
 * targets are still worth refusing: `localhost`, private ranges, and the
 * link-local metadata endpoints. The check is on the URL itself, so it must be
 * run again after every redirect, since a redirect is a second address.
 *
 * This is not DNS-aware: a public hostname that resolves to a private address
 * is not caught here. On Workers the request egress is Cloudflare's, not the
 * reader's machine, so the worst case is reaching another service on the same
 * edge network, not the reader's LAN.
 */
export function isSafeTargetUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isPublicHost(url.hostname);
}

function isPublicHost(hostname: string): boolean {
  // WHATWG URL keeps IPv6 literals bracketed; strip them before matching
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "metadata.google.internal") return false;

  const v4 = parseIpv4(host);
  if (v4) return isPublicIpv4(v4);

  if (host.includes(":")) return isPublicIpv6(host);

  return true;
}

/** Dotted-quad only; the URL parser already canonicalises the integer forms. */
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPublicIpv4([a, b]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  return true;
}

function isPublicIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return false;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return false; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(host)) return false; // fe80::/10 link-local
  if (host.startsWith("::ffff:")) {
    const v4 = parseIpv4(host.slice("::ffff:".length));
    if (v4) return isPublicIpv4(v4);
  }
  return true;
}
