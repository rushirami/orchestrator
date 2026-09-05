import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { removeLegacyConnections } from "./DesktopLegacyConnectionCleanup.ts";

it.effect("removes obsolete connection files and preserves local work and provider settings", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-connection-cleanup-" });
    const obsolete = ["connection-catalog.json", "saved-environments.json"];
    const retained = ["state.sqlite", "settings.json", "provider-credentials.json"];
    for (const name of [...obsolete, ...retained]) {
      yield* fs.writeFileString(path.join(directory, name), `contents of ${name}`);
    }
    yield* removeLegacyConnections(directory);
    yield* removeLegacyConnections(directory);
    for (const name of obsolete) {
      expect(yield* fs.exists(path.join(directory, name))).toBe(false);
    }
    for (const name of retained) {
      expect(yield* fs.readFileString(path.join(directory, name))).toBe(`contents of ${name}`);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
