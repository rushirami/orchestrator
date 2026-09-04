import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ClientPresentation } from "../platform/capabilities.ts";
import { PrimaryConnectionTarget, SshConnectionTarget, BearerConnectionTarget } from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";

const environmentId = EnvironmentId.make("environment-local");
const layer = ConnectionResolver.layer.pipe(
  Layer.provide(
    Layer.succeed(ClientPresentation, {
      metadata: { label: "Desktop", deviceType: "desktop", surface: "desktop" },
      scopes: [],
    }),
  ),
);
const target = (httpBaseUrl = "http://127.0.0.1:3777", wsBaseUrl = "ws://127.0.0.1:3777") =>
  new PrimaryConnectionTarget({
    environmentId,
    label: "Local",
    httpBaseUrl,
    wsBaseUrl,
    backendId: "wsl:Ubuntu",
  });

describe("local connection resolver", () => {
  it.effect("prepares a desktop backend without any credential service", () =>
    Effect.gen(function* () {
      const resolver = yield* ConnectionResolver.ConnectionResolver;
      const prepared = yield* resolver.prepare({ target: target(), profile: Option.none() });
      expect(prepared.httpAuthorization).toBeNull();
      expect(prepared.httpBaseUrl).toBe("http://127.0.0.1:3777/");
      expect(prepared.target).toEqual(target());
      const socket = new URL(prepared.socketUrl);
      expect(socket.origin).toBe("ws://127.0.0.1:3777");
      expect(socket.pathname).toBe("/ws");
      expect(socket.searchParams.has("wsTicket")).toBe(false);
      expect(socket.searchParams.has("token")).toBe(false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects external HTTP or WebSocket endpoints and embedded credentials", () =>
    Effect.gen(function* () {
      const resolver = yield* ConnectionResolver.ConnectionResolver;
      for (const [http, ws] of [
        ["https://example.com", "ws://127.0.0.1:3777"],
        ["http://127.0.0.1:3777", "ws://192.168.1.2:3777"],
        ["http://user:secret@localhost:3777", "ws://localhost:3777"],
      ]) {
        const error = yield* resolver
          .prepare({ target: target(http, ws), profile: Option.none() })
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "configuration" });
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects saved SSH and bearer remotes", () =>
    Effect.gen(function* () {
      const resolver = yield* ConnectionResolver.ConnectionResolver;
      for (const Target of [SshConnectionTarget, BearerConnectionTarget]) {
        const error = yield* resolver
          .prepare({
            target: new Target({ environmentId, label: "Old remote", connectionId: "old" }),
            profile: Option.none(),
          })
          .pipe(Effect.flip);
        expect(error.reason).toBe("unsupported");
      }
    }).pipe(Effect.provide(layer)),
  );
});
