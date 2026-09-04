import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resolveListenHost } from "./listenHost.ts";

it.effect("uses loopback literals without resolving hostnames", () =>
  Effect.gen(function* () {
    assert.equal(yield* resolveListenHost(undefined), "127.0.0.1");
    assert.equal(yield* resolveListenHost(" localhost "), "127.0.0.1");
    assert.equal(yield* resolveListenHost("127.0.0.1"), "127.0.0.1");
    assert.equal(yield* resolveListenHost("::1"), "::1");
  }),
);
it.effect("rejects wildcard, LAN, tailnet, and arbitrary hostnames", () =>
  Effect.gen(function* () {
    for (const host of [
      "0.0.0.0",
      "::",
      "192.168.1.2",
      "100.100.1.1",
      "172.27.0.99",
      "example.com",
      "localhost.example.com",
      "",
    ]) {
      const error = yield* resolveListenHost(host).pipe(Effect.flip);
      assert.equal(error._tag, "NonLoopbackListenHostError");
    }
  }),
);
