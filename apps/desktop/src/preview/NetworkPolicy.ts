/** Every preview request, including redirects and subresources, stays on loopback. */
export function isLocalPreviewRequest(rawUrl: string): boolean {
  if (rawUrl === "about:blank" || rawUrl === "about:srcdoc") return true;
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "data:" || url.protocol === "blob:") return true;
    return (
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}
