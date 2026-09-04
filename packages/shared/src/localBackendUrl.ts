/** Parse an endpoint supplied by the desktop's local backend pool. */
export function parseLocalBackendUrl(raw: string, protocol: "http:" | "ws:"): URL {
  const url = new URL(raw);
  if (
    url.protocol !== protocol ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/" && !(protocol === "ws:" && url.pathname === "/ws"))
  ) {
    throw new Error("The desktop backend must use a plain loopback endpoint.");
  }
  return url;
}
