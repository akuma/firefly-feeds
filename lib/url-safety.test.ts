import { describe, expect, it } from "vitest";
import { isSafeTargetUrl } from "./url-safety";

describe("isSafeTargetUrl", () => {
  it("allows ordinary public web addresses", () => {
    expect(isSafeTargetUrl("https://example.com/a-piece")).toBe(true);
    expect(isSafeTargetUrl("http://blog.example.org/2026/post")).toBe(true);
    expect(isSafeTargetUrl("https://8.8.8.8/")).toBe(true);
  });

  it("refuses anything that is not http(s)", () => {
    expect(isSafeTargetUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeTargetUrl("ftp://example.com/x")).toBe(false);
    expect(isSafeTargetUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeTargetUrl("not a url")).toBe(false);
  });

  it("refuses loopback and local names", () => {
    expect(isSafeTargetUrl("http://localhost/x")).toBe(false);
    expect(isSafeTargetUrl("http://api.localhost/x")).toBe(false);
    expect(isSafeTargetUrl("http://thing.local/x")).toBe(false);
    expect(isSafeTargetUrl("http://foo.internal/x")).toBe(false);
    expect(isSafeTargetUrl("http://127.0.0.1/x")).toBe(false);
    expect(isSafeTargetUrl("http://127.1.2.3/x")).toBe(false);
    expect(isSafeTargetUrl("http://[::1]/x")).toBe(false);
  });

  it("refuses private and link-local ranges, including metadata", () => {
    expect(isSafeTargetUrl("http://10.0.0.5/x")).toBe(false);
    expect(isSafeTargetUrl("http://172.16.1.1/x")).toBe(false);
    expect(isSafeTargetUrl("http://192.168.1.1/x")).toBe(false);
    expect(isSafeTargetUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeTargetUrl("http://100.64.0.1/x")).toBe(false);
    expect(isSafeTargetUrl("http://[fd00::1]/x")).toBe(false);
    expect(isSafeTargetUrl("http://[fe80::1]/x")).toBe(false);
    expect(isSafeTargetUrl("http://metadata.google.internal/computeMetadata")).toBe(false);
  });
});
