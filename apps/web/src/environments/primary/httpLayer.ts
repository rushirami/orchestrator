import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/unstable/http";

export function makePrimaryEnvironmentHttpLayer() {
  return Layer.unwrap(
    Effect.sync(() =>
      Layer.merge(
        remoteHttpClientLayer(globalThis.fetch),
        Layer.succeed(FetchHttpClient.RequestInit, { credentials: "omit" }),
      ),
    ),
  );
}

export const primaryEnvironmentHttpLayer = makePrimaryEnvironmentHttpLayer();
