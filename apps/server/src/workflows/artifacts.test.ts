import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import {
  parseWorkflowResult,
  readWorkflowArtifact,
  validateWorkflowArtifacts,
} from "./artifacts.ts";

const layer = Layer.merge(NodeFileSystem.layer, NodePath.layer);
it.effect("requires an explicit result and existing contained artifacts", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/spec.md`, "The approved specification");
    const result = yield* parseWorkflowResult(
      '{"outcome":"complete","summary":"Spec ready","artifacts":["spec.md"]}',
    );
    yield* validateWorkflowArtifacts(root, ["spec.md"], result);
    const before = yield* readWorkflowArtifact(root, "spec.md");
    yield* fs.writeFileString(`${root}/spec.md`, "A revised specification");
    assert.notEqual(before.revision, (yield* readWorkflowArtifact(root, "spec.md")).revision);
    assert.isTrue(yield* parseWorkflowResult("All done, everything passes").pipe(Effect.isFailure));
    assert.isTrue(
      yield* validateWorkflowArtifacts(root, ["missing.md"], result).pipe(Effect.isFailure),
    );
    assert.isTrue(yield* readWorkflowArtifact(root, "../outside.md").pipe(Effect.isFailure));
    const other = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${other}/private.md`, "outside");
    yield* fs.symlink(`${other}/private.md`, `${root}/linked.md`);
    assert.isTrue(yield* readWorkflowArtifact(root, "linked.md").pipe(Effect.isFailure));
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
