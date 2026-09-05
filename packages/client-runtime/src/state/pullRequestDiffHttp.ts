import { type PullRequestDiffInput, type PullRequestDiffResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  makeEnvironmentHttpApiUrlBuilder,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { withoutEnvironmentCredentials } from "./environmentHttp.ts";

const DEFAULT_PULL_REQUEST_DIFF_TIMEOUT_MS = 60_000;

export type PullRequestDiffLoadError = RemoteEnvironmentRequestError;

export const fetchEnvironmentPullRequestDiff = Effect.fn(
  "clientRuntime.state.fetchEnvironmentPullRequestDiff",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly diff: PullRequestDiffInput;
  readonly timeoutMs?: number;
}) {
  const requestUrl = makeEnvironmentHttpApiUrlBuilder(
    input.prepared.httpBaseUrl,
  ).pullRequests.diff();
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? DEFAULT_PULL_REQUEST_DIFF_TIMEOUT_MS,
    withoutEnvironmentCredentials(client.pullRequests.diff({ payload: input.diff })),
  );
});

export class PullRequestDiffLoader extends Context.Service<
  PullRequestDiffLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      input: PullRequestDiffInput,
    ) => Effect.Effect<PullRequestDiffResult, PullRequestDiffLoadError>;
  }
>()("@t3tools/client-runtime/state/pullRequestDiffHttp/PullRequestDiffLoader") {}

export const pullRequestDiffLoaderLayer: Layer.Layer<
  PullRequestDiffLoader,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  PullRequestDiffLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    return PullRequestDiffLoader.of({
      load: (prepared, input) =>
        fetchEnvironmentPullRequestDiff({ prepared, diff: input }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
        ),
    });
  }),
);
