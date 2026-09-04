import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Path from "effect/Path";
import * as NodeURL from "node:url";
import { beforeEach, vi } from "vite-plus/test";

const { handleMock, netFetchMock, unhandleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  netFetchMock: vi.fn(),
  unhandleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  net: { fetch: netFetchMock },
  protocol: { handle: handleMock, unhandle: unhandleMock },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

describe("ElectronProtocol", () => {
  beforeEach(() => {
    handleMock.mockReset();
    netFetchMock.mockReset();
    unhandleMock.mockReset();
  });

  it.effect("loads packaged renderer files without contacting the backend", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-renderer-" });
      yield* fs.writeFileString(path.join(directory, "index.html"), "<html>desktop</html>");
      yield* fs.writeFileString(path.join(directory, "app.js"), "console.log('desktop')");
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock.mockResolvedValue(new Response("local bytes"));
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      yield* protocol.registerDesktopProtocol({
        scheme: "t3code",
        renderer: { directory },
        backendOrigin: new URL("http://127.0.0.1:3773/"),
      });
      const root = yield* fs.realPath(directory);
      for (const [url, file] of [
        ["/", "index.html"],
        ["/app.js", "app.js"],
      ]) {
        const response = yield* Effect.promise(() => handler!(new Request(`t3code://app${url}`)));
        assert.equal(response.status, 200);
        assert.include(response.headers.get("content-security-policy") ?? "", "default-src 'self'");
        assert.equal(
          netFetchMock.mock.lastCall?.[0],
          NodeURL.pathToFileURL(path.join(root, file!)).href,
        );
      }
      const missing = yield* Effect.promise(() => handler!(new Request("t3code://app/missing.js")));
      assert.equal(missing.status, 404);
      const post = yield* Effect.promise(() =>
        handler!(new Request("t3code://app/", { method: "POST" })),
      );
      assert.equal(post.status, 405);
      assert.equal(netFetchMock.mock.calls.length, 2);
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("does not read renderer paths or symlinks outside the bundled directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-renderer-paths-" });
      const directory = path.join(parent, "renderer");
      yield* fs.makeDirectory(directory);
      yield* fs.writeFileString(path.join(parent, "private.txt"), "private");
      yield* fs.symlink(path.join(parent, "private.txt"), path.join(directory, "escape.txt"));
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      const protocol = yield* ElectronProtocol.ElectronProtocol;
      yield* protocol.registerDesktopProtocol({
        scheme: "t3code",
        renderer: { directory },
        backendOrigin: new URL("http://127.0.0.1:3773/"),
      });
      for (const suffix of [
        "escape.txt",
        "..%2fprivate.txt",
        "%5c..%5cprivate.txt",
        "%00",
        "%invalid",
      ]) {
        const response = yield* Effect.promise(() =>
          handler!(new Request(`t3code://app/${suffix}`)),
        );
        assert.include([400, 404], response.status);
      }
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("proxies the stable renderer origin to the current app server", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock.mockResolvedValue(new Response("ok"));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code-dev",
            renderer: { devOrigin: new URL("http://127.0.0.1:3773/") },
            backendOrigin: new URL("http://127.0.0.1:3774/"),
          });
          assert.isDefined(handler);

          const response = yield* Effect.promise(() =>
            handler!(
              new Request("t3code-dev://app/api/health?verbose=1", {
                headers: {
                  accept: "application/json",
                  origin: "t3code-dev://app",
                  referer: "t3code-dev://app/",
                  "sec-fetch-site": "same-origin",
                },
              }),
            ),
          );
          assert.equal(yield* Effect.promise(() => response.text()), "ok");
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "connect-src 'self' http: https: ws: wss:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "img-src 'self' t3code-dev: blob: data: http: https:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "font-src 'self' t3code-dev: data:",
          );
        }),
      );

      assert.deepEqual(
        handleMock.mock.calls.map((call) => call[0]),
        ["t3code-dev"],
      );
      assert.equal(netFetchMock.mock.calls[0]?.[0], "http://127.0.0.1:3774/api/health?verbose=1");
      const forwardedHeaders = new Headers(netFetchMock.mock.calls[0]?.[1]?.headers);
      assert.equal(forwardedHeaders.get("accept"), "application/json");
      assert.equal(forwardedHeaders.get("origin"), "t3code-dev://app");
      assert.equal(forwardedHeaders.get("referer"), "t3code-dev://app/");
      assert.equal(forwardedHeaders.get("sec-fetch-site"), "same-origin");
      assert.deepEqual(unhandleMock.mock.calls, [["t3code-dev"]]);
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("rejects custom protocol requests for another host", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code",
            renderer: { devOrigin: new URL("http://127.0.0.1:3773/") },
            backendOrigin: new URL("http://127.0.0.1:3773/"),
          });
          return yield* Effect.promise(() => handler!(new Request("t3code://other/")));
        }),
      );

      assert.equal(response.status, 404);
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("retries transient renderer target failures", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5733"))
        .mockResolvedValueOnce(new Response("ready"));

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3code-dev",
            renderer: { devOrigin: new URL("http://127.0.0.1:5733/") },
            backendOrigin: new URL("http://127.0.0.1:3773/"),
          });
          return yield* Effect.promise(() => handler!(new Request("t3code-dev://app/")));
        }),
      );

      assert.equal(yield* Effect.promise(() => response.text()), "ready");
      assert.equal(netFetchMock.mock.calls.length, 2);
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("preserves protocol registration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol registration failed");
      handleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const error = yield* Effect.scoped(
        protocol.registerDesktopProtocol({
          scheme: "t3code-dev",
          renderer: { devOrigin: new URL("http://127.0.0.1:3773/") },
          backendOrigin: new URL("http://127.0.0.1:3774/"),
        }),
      ).pipe(Effect.flip);

      assert.instanceOf(error, ElectronProtocol.ElectronProtocolRegistrationError);
      assert.equal(error.scheme, "t3code-dev");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, 'Failed to register Electron protocol scheme "t3code-dev".');
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it.effect("preserves protocol unregistration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol unregistration failed");
      unhandleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const exit = yield* Effect.exit(
        Effect.scoped(
          protocol.registerDesktopProtocol({
            scheme: "t3code",
            renderer: { devOrigin: new URL("http://127.0.0.1:3773/") },
            backendOrigin: new URL("http://127.0.0.1:3773/"),
          }),
        ),
      );

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ElectronProtocol.ElectronProtocolUnregistrationError);
        assert.equal(error.scheme, "t3code");
        assert.strictEqual(error.cause, cause);
        assert.equal(error.message, 'Failed to unregister Electron protocol scheme "t3code".');
      }
    }).pipe(Effect.provide([ElectronProtocol.layer, NodeServices.layer])),
  );

  it("keeps executable sources host-restricted while allowing runtime network resources", () => {
    const policy = ElectronProtocol.makeDesktopContentSecurityPolicy({
      scheme: "t3code",
      renderer: { devOrigin: new URL("http://127.0.0.1:3773/") },
      backendOrigin: new URL("http://127.0.0.1:3773/"),
    });
    const directives = Object.fromEntries(
      policy.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );

    assert.deepEqual(directives["script-src"], ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
    assert.deepEqual(directives["connect-src"], ["'self'", "http:", "https:", "ws:", "wss:"]);
    assert.deepEqual(directives["img-src"], [
      "'self'",
      "t3code:",
      "blob:",
      "data:",
      "http:",
      "https:",
    ]);
    assert.deepEqual(directives["media-src"], ["'self'", "t3code:", "blob:", "http:", "https:"]);
    assert.deepEqual(directives["font-src"], ["'self'", "t3code:", "data:"]);
  });
});
