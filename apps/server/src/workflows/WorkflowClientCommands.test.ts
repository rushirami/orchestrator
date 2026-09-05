import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { CommandId, OrchestrationCommand, ThreadId, type WorkflowTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeWorkflowRunner } from "./WorkflowRunner.ts";
import { WorkflowRuntime } from "./WorkflowRuntime.ts";
import { WorkflowService } from "./WorkflowService.ts";
import { WorkflowStore, WorkflowStoreError } from "./WorkflowStore.ts";
import { taskFixture, templateFixture } from "./testFixtures.ts";

const decodeCommand = Schema.decodeUnknownSync(OrchestrationCommand);

const layer = Layer.mergeAll(WorkflowService.layer, WorkflowStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
);

const idleRuntime = WorkflowRuntime.of({
  watch: () => Effect.void,
  reviewRevision: () => Effect.succeed("revision"),
  validate: () => Effect.void,
  plan: Effect.succeed,
  prepare: () => Effect.void,
  interrupt: () => Effect.void,
  dispatch: () => Effect.void,
  events: Stream.empty,
});

it.effect("guards workflow-owned client commands and permits only idle paused manual turns", () =>
  Effect.gen(function* () {
    const store = yield* WorkflowStore;
    let tasks: WorkflowTask[] = [];
    const runner = yield* makeWorkflowRunner.pipe(
      Effect.provideService(WorkflowRuntime, idleRuntime),
      Effect.provideService(WorkflowStore, { ...store, list: () => Effect.succeed(tasks) }),
    );
    const threadId = ThreadId.make("owned-builder");
    const command = (fields: Record<string, unknown>) =>
      decodeCommand({
        commandId: "guard-command",
        threadId,
        createdAt: "2026-09-05T00:00:00.000Z",
        ...fields,
      });
    // Await startup before installing live states so recovery does not rewrite the test matrix.
    yield* runner.runClientCommand(command({ type: "thread.delete" }), Effect.void);
    const blocked = [
      command({ type: "project.delete", projectId: "project-a" }),
      command({ type: "thread.delete" }),
      command({ type: "thread.archive" }),
      command({ type: "thread.checkpoint.revert", turnCount: 0 }),
      command({ type: "thread.runtime-mode.set", runtimeMode: "approval-required" }),
      command({ type: "thread.session.stop" }),
      command({ type: "thread.meta.update", branch: "other" }),
      command({ type: "thread.meta.update", worktreePath: null }),
      command({
        type: "thread.meta.update",
        modelSelection: { instanceId: "codex", model: "other" },
      }),
      command({
        type: "thread.turn.start",
        message: { messageId: "manual", role: "user", text: "Follow up", attachments: [] },
        modelSelection: { instanceId: "codex", model: "default" },
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    ];
    const allowed = [
      command({ type: "thread.meta.update", title: "Rename conversation" }),
      command({ type: "thread.delete", threadId: "unrelated" }),
      command({ type: "project.delete", projectId: "unrelated" }),
    ];
    for (const status of ["starting", "running", "paused", "complete", "cancelled"] as const) {
      for (const executing of [false, true]) {
        const fixture = taskFixture();
        tasks = [
          {
            ...fixture,
            status,
            threadIds: { builder: threadId },
            nodes: fixture.nodes.map((node, index) =>
              index === 0 && executing
                ? { ...node, status: "running", operationId: "operation", turnId: "turn" }
                : node,
            ),
          },
        ];
        for (const candidate of [...blocked, ...allowed]) {
          let executions = 0;
          const result = yield* runner
            .runClientCommand(
              candidate,
              Effect.sync(() => {
                executions++;
                return "receipt";
              }),
            )
            .pipe(Effect.result);
          const permitted =
            allowed.includes(candidate) ||
            (!executing &&
              (status === "complete" ||
                status === "cancelled" ||
                (status === "paused" && candidate.type === "thread.turn.start")));
          assert.equal(
            result._tag,
            permitted ? "Success" : "Failure",
            `${status}/${executing}/${candidate.type}`,
          );
          assert.equal(executions, permitted ? 1 : 0);
        }
      }
    }
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

for (const failure of ["list", "remove"] as const) {
  it.effect(
    `returns the successful project deletion receipt when workflow cleanup ${failure} fails`,
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
        const store = yield* WorkflowStore;
        const first = templateFixture("project-a", "first");
        const second = templateFixture("project-a", "second");
        yield* store.save(first, 0, "template.saved");
        yield* store.save(second, 0, "template.saved");
        let deleted = false;
        const removed: string[] = [];
        const runner = yield* makeWorkflowRunner.pipe(
          Effect.provideService(WorkflowRuntime, idleRuntime),
          Effect.provideService(WorkflowStore, {
            ...store,
            list: (projectId) =>
              deleted && failure === "list"
                ? Effect.fail(new WorkflowStoreError({ message: "cleanup lookup failed" }))
                : store.list(projectId),
            remove: (id, projectId, revision) =>
              Effect.gen(function* () {
                removed.push(id);
                if (id === first.id)
                  return yield* new WorkflowStoreError({ message: "cleanup remove failed" });
                yield* store.remove(id, projectId, revision);
              }),
          }),
        );
        const receipt = yield* runner.runClientCommand(
          {
            type: "project.delete",
            commandId: CommandId.make("delete"),
            projectId: first.projectId,
          },
          Effect.gen(function* () {
            yield* sql`UPDATE projection_projects SET deleted_at = '2026-09-05T00:00:00.000Z' WHERE project_id = ${first.projectId}`;
            deleted = true;
            return { sequence: 42 };
          }),
        );
        assert.deepEqual(receipt, { sequence: 42 });
        assert.isTrue(deleted);
        assert.deepEqual(removed, failure === "remove" ? [first.id, second.id] : []);
        if (failure === "remove") assert.isNull(yield* store.get(second.id));
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}
