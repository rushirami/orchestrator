import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class NonLoopbackListenHostError extends Schema.TaggedErrorClass<NonLoopbackListenHostError>()(
  "NonLoopbackListenHostError",
  { host: Schema.String },
) {
  override get message(): string {
    return `T3 Code only accepts local connections. Cannot bind to ${this.host}.`;
  }
}

/** Resolve localhost without DNS, and reject every externally reachable interface. */
export const resolveListenHost = (host: string | undefined) => {
  const normalized = host?.trim().toLowerCase() ?? "127.0.0.1";
  switch (normalized) {
    case "localhost":
    case "127.0.0.1":
      return Effect.succeed("127.0.0.1");
    case "::1":
      return Effect.succeed("::1");
    default:
      return Effect.fail(new NonLoopbackListenHostError({ host: normalized }));
  }
};
