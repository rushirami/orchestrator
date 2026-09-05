import { describe, expect, it } from "vite-plus/test";

import { parseLocalBackendUrl } from "./localBackendUrl.ts";

describe("local backend endpoints", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])("accepts loopback %s", (host) => {
    expect(parseLocalBackendUrl(`http://${host}:3773`, "http:").hostname).toBe(host);
    expect(parseLocalBackendUrl(`ws://${host}:3773/ws`, "ws:").pathname).toBe("/ws");
  });

  it.each([
    "http://192.168.1.2:3773",
    "http://example.com",
    "http://127.0.0.1.example.com",
    "https://127.0.0.1",
    "http://user:password@127.0.0.1",
    "http://127.0.0.1?credential=secret",
    "http://127.0.0.1#secret",
    "http://127.0.0.1/proxy",
    "http://[::]",
    "/relative",
  ])("rejects nonlocal or credential-bearing input %s", (raw) => {
    expect(() => parseLocalBackendUrl(raw, "http:")).toThrow();
  });
});
