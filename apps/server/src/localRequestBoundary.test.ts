import { describe, expect, it } from "vite-plus/test";
import { isTrustedLocalRequest, localClientOrigins } from "./localRequestBoundary.ts";

const origins = localClientOrigins(new URL("http://127.0.0.1:5173"));
const host = "127.0.0.1:3773";

describe("local request boundary", () => {
  it("accepts desktop, configured local development, and native local requests", () => {
    for (const authority of [host, "localhost:3773", "[::1]:3773"]) {
      for (const origin of [undefined, ...origins]) {
        expect(
          isTrustedLocalRequest({ host: authority, ...(origin ? { origin } : {}) }, 3773, origins),
        ).toBe(true);
      }
    }
    expect(
      isTrustedLocalRequest(
        { host, referer: "t3code://app/", "sec-fetch-site": "cross-site" },
        3773,
        origins,
      ),
    ).toBe(true);
  });

  it("rejects websites, local project previews, and opaque origins", () => {
    for (const origin of [
      "https://example.com",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "null",
      "t3code://other",
      "t3code://app.evil",
    ]) {
      expect(isTrustedLocalRequest({ host, origin }, 3773, origins)).toBe(false);
      expect(isTrustedLocalRequest({ host, referer: `${origin}/` }, 3773, origins)).toBe(false);
    }
    for (const site of ["cross-site", "same-site", "same-origin"]) {
      expect(isTrustedLocalRequest({ host, "sec-fetch-site": site }, 3773, origins)).toBe(false);
    }
  });

  it("rejects rebinding hosts and wrong ports regardless of forwarded headers", () => {
    for (const authority of [
      "example.com:3773",
      "127.0.0.1.example.com:3773",
      "127.0.0.1:3000",
      "127.0.0.1",
      "127.0.0.1:999999",
      "127.0.0.1:3773/",
      "user@127.0.0.1:3773",
      "",
      "127.0.0.1:3773, example.com",
    ]) {
      expect(
        isTrustedLocalRequest(
          { host: authority, origin: "t3code://app", "x-forwarded-host": host },
          3773,
          origins,
        ),
      ).toBe(false);
    }
    expect(
      isTrustedLocalRequest(
        { host, "x-forwarded-host": "example.com", "x-forwarded-proto": "https" },
        3773,
        origins,
      ),
    ).toBe(true);
  });

  it("never trusts remote development configuration", () => {
    expect(localClientOrigins(new URL("https://remote.example.com"))).toEqual(localClientOrigins());
    expect(localClientOrigins(new URL("file://localhost/path"))).toEqual(localClientOrigins());
  });
});
