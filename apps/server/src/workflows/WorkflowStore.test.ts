import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as FileSystem from "effect/FileSystem";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  SqlitePersistenceMemory,
  makeSqlitePersistenceLive,
} from "../persistence/Layers/Sqlite.ts";
import { WorkflowStore } from "./WorkflowStore.ts";
import { templateFixture, taskFixture } from "./testFixtures.ts";

const layer = WorkflowStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const id of ["project-a", "project-b"])
    yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES (${id}, ${id}, '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
});

it.effect("isolates same-named project templates and rejects stale writes", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* WorkflowStore;
    const first = templateFixture();
    yield* store.save(first, 0, "template.saved");
    yield* store.save(templateFixture("project-b", "workflow-b"), 0, "template.saved");
    assert.equal((yield* store.list("project-a")).length, 1);
    yield* store.save(
      { ...first, revision: 2, definition: { ...first.definition, name: "Changed" } },
      1,
      "template.saved",
    );
    const stale = yield* store
      .save({ ...first, revision: 2 }, 1, "template.saved")
      .pipe(Effect.flip);
    assert.include(stale.message, "another window");
    assert.equal((yield* store.get(first.id))?.revision, 2);
  }).pipe(Effect.provide(layer)),
);

it.effect("deduplicates launch commands and removes dismissed workflow payloads", () =>
  Effect.gen(function* () {
    yield* seed;
    const store = yield* WorkflowStore;
    const sql = yield* SqlClient.SqlClient;
    const task = taskFixture();
    const command = { id: "launch-one", fingerprint: "fingerprint-one" };
    yield* store.save(task, 0, "task.launched", command);
    yield* store.save(task, 0, "task.launched", command);
    assert.equal((yield* store.list(undefined)).length, 1);
    const conflict = yield* store
      .save(task, 0, "task.launched", { ...command, fingerprint: "different" })
      .pipe(Effect.flip);
    assert.include(conflict.message, "different request");
    yield* store.save({ ...task, status: "cancelled", revision: 2 }, 1, "task.cancelled");
    yield* store.remove(task.id, task.projectId, 2);
    assert.isNull(yield* store.get(task.id));
    assert.isNull(yield* store.save(task, 0, "task.launched", command));
    assert.equal((yield* sql`SELECT * FROM workflow_records`).length, 0);
    assert.equal((yield* sql`SELECT * FROM workflow_command_keys`).length, 1);
  }).pipe(Effect.provide(layer)),
);

it.effect("restores isolated templates and frozen tasks from a reopened disk database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const diskLayer = () =>
      WorkflowStore.layer.pipe(
        Layer.provideMerge(makeSqlitePersistenceLive(`${directory}/state.sqlite`)),
      );
    const first = templateFixture();
    const task = taskFixture();
    yield* Effect.gen(function* () {
      yield* seed;
      const store = yield* WorkflowStore;
      yield* store.save(first, 0, "template.saved");
      yield* store.save(templateFixture("project-b", "workflow-b"), 0, "template.saved");
      yield* store.save(task, 0, "task.launched");
    }).pipe(Effect.provide(diskLayer()), Effect.scoped);
    yield* Effect.gen(function* () {
      const store = yield* WorkflowStore;
      assert.deepEqual(yield* store.get(task.id), task);
      assert.equal((yield* store.list("project-b")).length, 1);
      yield* store.remove(first.id, first.projectId, first.revision);
      assert.deepEqual(yield* store.get(task.id), task);
    }).pipe(Effect.provide(diskLayer()), Effect.scoped);
    yield* Effect.gen(function* () {
      const store = yield* WorkflowStore;
      assert.isNull(yield* store.get(first.id));
      assert.deepEqual(yield* store.get(task.id), task);
    }).pipe(Effect.provide(diskLayer()), Effect.scoped);
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
