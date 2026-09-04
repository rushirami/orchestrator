import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
const { readPreparedConnection } = vi.hoisted(() => ({ readPreparedConnection: vi.fn() }));
vi.mock("~/state/session", () => ({ readPreparedConnection }));
import {
  resolveBrowserNavigationTarget,
  resolveDiscoveredServerUrl,
} from "./browserTargetResolver";
const environmentId = EnvironmentId.make("local");
beforeEach(() => readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://127.0.0.1:3773" }));
describe("local preview targets", () => {
  it("opens a local environment port", () => {
    expect(
      resolveBrowserNavigationTarget(environmentId, {
        kind: "environment-port",
        port: 5173,
        path: "/app?q=1",
      }),
    ).toEqual({
      environmentId,
      requestedUrl: "http://localhost:5173/app?q=1",
      resolvedUrl: "http://localhost:5173/app?q=1",
      resolutionKind: "direct",
    });
  });
  it("normalizes local URLs and preserves path, query, and fragment", () => {
    expect(resolveDiscoveredServerUrl(environmentId, "localhost:3000/app?q=1#tab")).toBe(
      "http://localhost:3000/app?q=1#tab",
    );
  });
  it.each([
    "https://example.com/",
    "http://192.168.1.2:3000/",
    "http://user:secret@localhost:3000/",
  ])("rejects %s", (url) => {
    expect(() => resolveBrowserNavigationTarget(environmentId, { kind: "url", url })).toThrow();
    expect(() => resolveDiscoveredServerUrl(environmentId, url)).toThrow();
  });
  it("does not resolve ports against a legacy remote environment", () => {
    readPreparedConnection.mockReturnValue({ httpBaseUrl: "http://192.168.1.2:3773" });
    expect(() =>
      resolveBrowserNavigationTarget(environmentId, { kind: "environment-port", port: 3000 }),
    ).toThrow();
  });
  it("requires the local environment to be connected before opening its ports", () => {
    readPreparedConnection.mockReturnValue(null);
    expect(() =>
      resolveBrowserNavigationTarget(environmentId, { kind: "environment-port", port: 3000 }),
    ).toThrow();
  });
});
