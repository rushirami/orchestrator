import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

// These documents held only remote endpoints and T3 connection credentials.
// Remove them without decoding credentials or contacting the former hosts.
export const removeLegacyConnections = Effect.fn("desktop.removeLegacyConnections")(function* (
  stateDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of ["connection-catalog.json", "saved-environments.json"]) {
    yield* fileSystem.remove(path.join(stateDirectory, name), { force: true });
  }
});
