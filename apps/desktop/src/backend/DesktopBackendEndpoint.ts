import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class DesktopBackendEndpoint extends Context.Service<
  DesktopBackendEndpoint,
  {
    readonly configure: (input: { readonly port: number }) => Effect.Effect<void>;
    readonly backendConfig: Effect.Effect<{ readonly port: number; readonly httpBaseUrl: URL }>;
  }
>()("@t3tools/desktop/backend/DesktopBackendEndpoint") {}

export const layer = Layer.effect(
  DesktopBackendEndpoint,
  Effect.gen(function* () {
    const portRef = yield* Ref.make(3773);
    return DesktopBackendEndpoint.of({
      configure: ({ port }) => Ref.set(portRef, port),
      backendConfig: Ref.get(portRef).pipe(
        Effect.map((port) => ({ port, httpBaseUrl: new URL(`http://127.0.0.1:${port}`) })),
      ),
    });
  }),
);
