import { describe, expect, it } from "vite-plus/test";
import { isLocalPreviewRequest } from "./NetworkPolicy.ts";

describe("preview network boundary", () => {
  it.each([
    "http://localhost:5173/path",
    "https://127.0.0.1:3000/image.png",
    "ws://localhost:5173/hmr",
    "wss://[::1]:3000/ws",
    "about:blank",
    "about:srcdoc",
    "data:image/png;base64,AAAA",
    "blob:http://localhost:3000/id",
  ])("allows local resource %s", (url) => expect(isLocalPreviewRequest(url)).toBe(true));
  it.each([
    "https://example.com",
    "https://cdn.example.com/script.js",
    "wss://example.com/ws",
    "http://192.168.1.10",
    "http://localhost.evil.test",
    "http://user:secret@localhost",
    "https://127.0.0.1.evil.test",
    "file:///etc/passwd",
    "t3code://app/api",
    "https://localhost@evil.test",
    "ftp://127.0.0.1",
    "invalid",
  ])("blocks remote or privileged resource %s", (url) =>
    expect(isLocalPreviewRequest(url)).toBe(false),
  );
});
