import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import {
  BearerConnectionTarget,
  type ConnectionTarget,
  PrimaryConnectionTarget,
  SshConnectionTarget,
} from "./model.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as ConnectionResolver from "./resolver.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
  providerKind: "cloudflare_tunnel" as const,
};

function catalogEntry(
  target: ConnectionTarget,
  profile: Option.Option<ConnectionProfile> = Option.none(),
): ConnectionCatalogEntry {
  return { target, profile };
}

function unsupported<A>(name: string): Effect.Effect<A> {
  return Effect.die(new Error(`Unexpected relay call: ${name}`));
}

function relayClient(
  connectEnvironment: ManagedRelay.ManagedRelayClient["Service"]["connectEnvironment"],
) {
  return ManagedRelay.ManagedRelayClient.of({
    relayUrl: "https://relay.example.test",
    listEnvironments: () => unsupported("listEnvironments"),
    listDevices: () => unsupported("listDevices"),
    createEnvironmentLinkChallenge: () => unsupported("createEnvironmentLinkChallenge"),
    linkEnvironment: () => unsupported("linkEnvironment"),
    unlinkEnvironment: () => unsupported("unlinkEnvironment"),
    getEnvironmentStatus: () => unsupported("getEnvironmentStatus"),
    connectEnvironment,
    registerDevice: () => unsupported("registerDevice"),
    unregisterDevice: () => unsupported("unregisterDevice"),
    registerLiveActivity: () => unsupported("registerLiveActivity"),
    getAgentActivitySnapshot: () => unsupported("getAgentActivitySnapshot"),
    resetTokenCache: Effect.void,
  });
}

const makeDependencies = Effect.fn("TestConnectionResolver.makeDependencies")((options?: {
  readonly profiles?: ReadonlyArray<ConnectionProfile>;
  readonly credentials?: ReadonlyArray<readonly [string, ConnectionCredential]>;
  readonly connectEnvironment?: ManagedRelay.ManagedRelayClient["Service"]["connectEnvironment"];
  readonly authorizeBearer?: RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]["authorizeBearer"];
  readonly primaryBearerToken?: string;
}) => {
  const profiles = new Map(
    (options?.profiles ?? []).map((profile) => [profile.connectionId, profile]),
  );
  const credentials = new Map(options?.credentials ?? []);

  const profileStore = ConnectionProfileStore.ConnectionProfileStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(profiles.get(connectionId))),
    put: (profile) => Effect.sync(() => void profiles.set(profile.connectionId, profile)),
    remove: (connectionId) => Effect.sync(() => void profiles.delete(connectionId)),
  });
  const credentialStore = ConnectionCredentialStore.ConnectionCredentialStore.of({
    get: (connectionId) => Effect.succeed(Option.fromNullishOr(credentials.get(connectionId))),
    put: (connectionId, credential) =>
      Effect.sync(() => void credentials.set(connectionId, credential)),
    remove: (connectionId) => Effect.sync(() => void credentials.delete(connectionId)),
  });
  const remote = RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization.of({
    authorizeBearer:
      options?.authorizeBearer ??
      ((input) =>
        Effect.succeed({
          environmentId: input.expectedEnvironmentId,
          label: "Authorized bearer environment",
          httpBaseUrl: input.httpBaseUrl,
          socketUrl: "wss://authorized.example.test/ws?wsTicket=bearer",
          httpAuthorization: {
            _tag: "Bearer" as const,
            token: input.bearerToken,
          },
        })),
  });

  const dependencies = Layer.mergeAll(
    Layer.succeed(ConnectionProfileStore.ConnectionProfileStore, profileStore),
    Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, credentialStore),
    Layer.succeed(
      ClientCapabilities.CloudSession,
      ClientCapabilities.CloudSession.of({ clerkToken: Effect.succeed("clerk-session") }),
    ),
    Layer.succeed(
      ClientCapabilities.PrimaryEnvironmentAuth,
      ClientCapabilities.PrimaryEnvironmentAuth.of({
        bearerToken: Effect.succeed(Option.fromNullishOr(options?.primaryBearerToken)),
      }),
    ),
    Layer.succeed(
      ClientCapabilities.ClientPresentation,
      ClientCapabilities.ClientPresentation.of({
        metadata: { label: "Test Client", deviceType: "desktop", surface: "web" },
        scopes: [],
      }),
    ),
    Layer.succeed(
      ClientCapabilities.RelayDeviceIdentity,
      ClientCapabilities.RelayDeviceIdentity.of({
        deviceId: Effect.succeed(Option.some("device-1")),
      }),
    ),
    Layer.succeed(RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization, remote),
    Layer.succeed(
      ManagedRelay.ManagedRelayClient,
      relayClient(
        options?.connectEnvironment ??
          ((input) =>
            Effect.succeed({
              environmentId: input.environmentId,
              endpoint: ENDPOINT,
              credential: "relay-bootstrap",
              expiresAt: "2026-06-06T00:00:00.000Z",
            })),
      ),
    ),
  );

  return Effect.succeed(ConnectionResolver.layer.pipe(Layer.provide(dependencies)));
});

describe("ConnectionResolver", () => {
  it.effect("prepares a primary environment without remote capabilities", () =>
    Effect.gen(function* () {
      const brokerLayer = yield* makeDependencies();
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      expect(yield* broker.prepare(catalogEntry(target))).toEqual({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        socketUrl:
          "ws://127.0.0.1:3777/ws?clientSurface=web&clientDeviceType=desktop&connectionMethod=direct",
        httpAuthorization: null,
        target,
      });
    }),
  );

  it.effect("authorizes a desktop primary environment with its platform bearer token", () =>
    Effect.gen(function* () {
      const bearerInputs = yield* Ref.make<ReadonlyArray<{ token: string; method: string }>>([]);
      const brokerLayer = yield* makeDependencies({
        primaryBearerToken: "desktop-bearer",
        authorizeBearer: (input) =>
          Ref.update(bearerInputs, (values) => [
            ...values,
            { token: input.bearerToken, method: input.connectionMethod },
          ]).pipe(
            Effect.as({
              environmentId: input.expectedEnvironmentId,
              label: "Primary",
              httpBaseUrl: input.httpBaseUrl,
              socketUrl: "ws://127.0.0.1:3777/ws?wsTicket=desktop",
              httpAuthorization: {
                _tag: "Bearer" as const,
                token: input.bearerToken,
              },
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new PrimaryConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Primary",
        httpBaseUrl: "http://127.0.0.1:3777",
        wsBaseUrl: "ws://127.0.0.1:3777",
      });

      expect(yield* broker.prepare(catalogEntry(target))).toMatchObject({
        socketUrl: "ws://127.0.0.1:3777/ws?wsTicket=desktop",
        httpAuthorization: { _tag: "Bearer", token: "desktop-bearer" },
        target,
      });
      expect(yield* Ref.get(bearerInputs)).toEqual([{ token: "desktop-bearer", method: "direct" }]);
    }),
  );

  it.effect("uses the registered bearer profile without re-reading the profile store", () =>
    Effect.gen(function* () {
      const bearerInputs = yield* Ref.make<ReadonlyArray<{ token: string; method: string }>>([]);
      const target = new BearerConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Saved",
        connectionId: "saved-1",
      });
      const profile = new BearerConnectionProfile({
        connectionId: "saved-1",
        environmentId: ENVIRONMENT_ID,
        label: "Saved",
        httpBaseUrl: ENDPOINT.httpBaseUrl,
        wsBaseUrl: ENDPOINT.wsBaseUrl,
      });
      const brokerLayer = yield* makeDependencies({
        credentials: [["saved-1", new BearerConnectionCredential({ token: "secret-bearer" })]],
        authorizeBearer: (input) =>
          Ref.update(bearerInputs, (values) => [
            ...values,
            { token: input.bearerToken, method: input.connectionMethod },
          ]).pipe(
            Effect.as({
              environmentId: input.expectedEnvironmentId,
              label: "Saved",
              httpBaseUrl: input.httpBaseUrl,
              socketUrl: "wss://environment.example.test/ws?wsTicket=ticket",
              httpAuthorization: {
                _tag: "Bearer" as const,
                token: input.bearerToken,
              },
            }),
          ),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));

      expect(
        (yield* broker.prepare(catalogEntry(target, Option.some(profile)))).socketUrl,
      ).toContain("wsTicket=ticket");
      expect(yield* Ref.get(bearerInputs)).toEqual([{ token: "secret-bearer", method: "direct" }]);
    }),
  );
  it.effect("rejects legacy SSH connections without authorizing or launching a remote", () =>
    Effect.gen(function* () {
      const brokerLayer = yield* makeDependencies({
        authorizeBearer: () => Effect.die("Unexpected remote authorization"),
      });
      const broker = yield* ConnectionResolver.ConnectionResolver.pipe(Effect.provide(brokerLayer));
      const target = new SshConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Old SSH connection",
        connectionId: "ssh-1",
      });
      const error = yield* broker.prepare(catalogEntry(target)).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "unsupported" });
    }),
  );
});
