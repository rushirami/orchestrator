import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

/** Local renderer requests never send browser cookies. */
export const withoutEnvironmentCredentials = <A, E, R>(
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "omit" }));
