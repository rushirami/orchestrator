import type { OrchestrationClientOrigin } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ClientCapabilities from "../platform/capabilities.ts";
import { type ConnectionCatalogEntry } from "./catalog.ts";
import type { LocalConnectionTarget, PreparedConnection } from "./model.ts";
import { type ConnectionAttemptError, ConnectionBlockedError } from "./model.ts";

import { parseLocalBackendUrl } from "@t3tools/shared/localBackendUrl";
export class ConnectionResolver extends Context.Service<
  ConnectionResolver,
  {
    readonly prepare: (
      entry: ConnectionCatalogEntry,
    ) => Effect.Effect<PreparedConnection, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/connection/resolver/ConnectionResolver") {}

function primarySocketUrl(
  target: LocalConnectionTarget,
  clientMetadata: OrchestrationClientOrigin | undefined,
): string {
  const url = parseLocalBackendUrl(target.wsBaseUrl, "ws:");
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/ws";
  }
  if (clientMetadata?.surface) url.searchParams.set("clientSurface", clientMetadata.surface);
  if (clientMetadata?.appVersion)
    url.searchParams.set("clientAppVersion", clientMetadata.appVersion);
  return url.toString();
}

export const make = Effect.gen(function* () {
  const presentation = yield* ClientCapabilities.ClientPresentation;
  const prepare = Effect.fn("clientRuntime.connection.prepareLocal")(function* (
    entry: ConnectionCatalogEntry,
  ) {
    const target = entry.target;
    if (target._tag !== "LocalConnectionTarget") {
      return yield* new ConnectionBlockedError({
        reason: "unsupported",
        detail: "Only desktop-managed local backends are supported.",
      });
    }
    return yield* Effect.try({
      try: () =>
        ({
          environmentId: target.environmentId,
          label: target.label,
          httpBaseUrl: parseLocalBackendUrl(target.httpBaseUrl, "http:").href,
          socketUrl: primarySocketUrl(target, presentation.metadata),
          target,
        }) satisfies PreparedConnection,
      catch: () =>
        new ConnectionBlockedError({
          reason: "configuration",
          detail: "The desktop backend must use a loopback endpoint.",
        }),
    });
  });
  return ConnectionResolver.of({ prepare });
});
export const layer = Layer.effect(ConnectionResolver, make);
