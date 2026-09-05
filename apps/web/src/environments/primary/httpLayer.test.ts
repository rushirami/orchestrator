import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";
import { makePrimaryEnvironmentHttpLayer } from "./httpLayer";

describe.sequential("local environment HTTP layer", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.effect("sends local HTTP requests without cookies or credentials", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/orchestration/shell");
      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).toBe("omit");
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
    }).pipe(Effect.provide(makePrimaryEnvironmentHttpLayer()));
  });
});
