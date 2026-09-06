import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import {
  ThreadId,
  WorkflowControlInput,
  type WorkflowArtifactComment,
  type WorkflowTask,
} from "@t3tools/contracts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { readWorkflowArtifact } from "./artifacts.ts";
import { makeWorkflowRunner } from "./WorkflowRunner.ts";
import { WorkflowRuntime, type WorkflowRuntimeEvent } from "./WorkflowRuntime.ts";
import { WorkflowService } from "./WorkflowService.ts";
import { WorkflowStore } from "./WorkflowStore.ts";
import { taskFixture } from "./testFixtures.ts";

const layer = Layer.mergeAll(WorkflowService.layer, WorkflowStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
);

const comments: WorkflowArtifactComment[] = [
  { startLine: 3, endLine: 4, text: "Use blue and keep this desktop-only." },
  { startLine: 1, endLine: 1, text: "Name the feature in the heading." },
];

it("validates revision comments at the wire boundary", () => {
  const input = {
    taskId: "task",
    expectedRevision: 1,
    action: "revise",
    nodeId: "approval",
    artifactRevision: "revision",
  };
  const decode = Schema.decodeUnknownSync(WorkflowControlInput);
  for (const revisionComments of [
    undefined,
    [],
    [{ startLine: 0, endLine: 1, text: "Change this." }],
    [{ startLine: 1.5, endLine: 2, text: "Change this." }],
    [{ startLine: 2, endLine: 1, text: "Change this." }],
    [{ startLine: 1, endLine: 1, text: "  " }],
  ])
    assert.throws(() => decode({ ...input, revisionComments }));
  assert.deepEqual(decode({ ...input, revisionComments: comments }).revisionComments, comments);
  assert.equal(decode({ ...input, action: "approve" }).action, "approve");
});

for (const [status, approvalStatus] of [
  ["running", "awaiting-approval"],
  ["paused", "awaiting-approval"],
  ["paused", "pending"],
] as const) {
  it.effect(`revises ${status}/${approvalStatus} with comments and returns for approval`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
      const store = yield* WorkflowStore;
      const service = yield* WorkflowService;
      const fs = yield* FileSystem.FileSystem;
      const worktree = yield* fs.makeTempDirectoryScoped();
      const content = "# Spec\r\n\r\nUse red.\r\nShip a mobile app.\r\n";
      yield* fs.writeFileString(`${worktree}/spec.md`, content);
      const artifact = yield* readWorkflowArtifact(worktree, "spec.md");
      const fixture = taskFixture();
      const task: WorkflowTask = {
        ...fixture,
        status,
        worktreePath: worktree,
        threadIds: { builder: ThreadId.make("existing-builder") },
        nodes: fixture.nodes.map((node) =>
          node.nodeId === "plan"
            ? {
                ...node,
                status: "complete",
                result: { outcome: "complete", summary: "Wrote spec", artifacts: ["spec.md"] },
              }
            : node.nodeId === "approval"
              ? {
                  ...node,
                  status: approvalStatus,
                  artifactRevision: approvalStatus === "pending" ? null : artifact.revision,
                }
              : node,
        ),
      };
      yield* store.save(task, 0, "task.awaiting-approval");
      const events = yield* Queue.unbounded<WorkflowRuntimeEvent>();
      const dispatches = yield* Queue.unbounded<WorkflowTask>();
      let preparations = 0;
      const runner = yield* makeWorkflowRunner.pipe(
        Effect.provideService(WorkflowRuntime, {
          watch: () => Effect.void,
          readResult: () => Effect.succeed(null),
          reviewRevision: () => Effect.succeed("revision"),
          validate: () => Effect.void,
          plan: Effect.succeed,
          prepare: () =>
            Effect.sync(() => {
              preparations++;
            }),
          interrupt: () => Effect.void,
          dispatch: (dispatched, node) =>
            Effect.gen(function* () {
              assert.equal(node.id, "plan");
              assert.deepEqual(yield* store.get(dispatched.id), dispatched);
              yield* Queue.offer(dispatches, dispatched);
            }).pipe(Effect.orDie),
          events: Stream.fromQueue(events),
        }),
      );
      const input = {
        taskId: task.id,
        expectedRevision: task.revision,
        nodeId: "approval",
        action: "revise" as const,
        artifactRevision: artifact.revision,
        revisionComments: comments,
      };
      for (const revisionComments of [
        undefined,
        [],
        [{ startLine: 0, endLine: 1, text: "Change this." }],
        [{ startLine: 4, endLine: 3, text: "Change this." }],
        [{ startLine: 1, endLine: 1, text: "  " }],
        [{ startLine: 3, endLine: 6, text: "Change missing lines." }],
      ]) {
        const rejected = yield* runner.control({ ...input, revisionComments }).pipe(Effect.result);
        assert.equal(rejected._tag, "Failure");
      }
      yield* fs.writeFileString(`${worktree}/spec.md`, "# Changed after opening\n");
      const stale = yield* runner.control(input).pipe(Effect.result);
      assert.equal(stale._tag, "Failure");
      if (stale._tag === "Failure") assert.include(stale.failure.message, "artifact changed");
      assert.deepEqual(yield* store.get(task.id), task);
      assert.equal(yield* Queue.size(dispatches), 0);
      yield* fs.writeFileString(`${worktree}/spec.md`, content);

      const revised = yield* runner.control(input);
      assert.equal(revised.status, "running");
      assert.equal(revised.iteration, 1);
      assert.equal(preparations, 0);
      assert.equal(revised.reworkTargetNodeId, "plan");
      assert.equal(revised.reworkContext?.outcome, "changes-requested");
      assert.deepEqual(revised.reworkContext?.artifacts, ["spec.md"]);
      assert.include(revised.reworkContext!.summary, `spec.md (revision ${artifact.revision})`);
      assert.include(revised.reworkContext!.summary, "Comment 1, lines 3-4:");
      assert.include(revised.reworkContext!.summary, "> 3: Use red.\n> 4: Ship a mobile app.");
      assert.include(revised.reworkContext!.summary, comments[0]!.text);
      assert.include(revised.reworkContext!.summary, comments[1]!.text);
      assert.isTrue(
        revised.nodes.every((node) => node.nodeId === "plan" || node.status === "pending"),
      );
      const dispatched = yield* Queue.take(dispatches);
      assert.equal(dispatched.threadIds.builder, task.threadIds.builder);
      const state = dispatched.nodes.find((node) => node.nodeId === "plan")!;
      assert.equal(state.status, "dispatching");
      assert.equal(state.attempt, 1);
      const duplicate = yield* runner.control(input).pipe(Effect.result);
      assert.equal(duplicate._tag, "Failure");
      assert.equal(yield* Queue.size(dispatches), 0);

      yield* fs.writeFileString(`${worktree}/spec.md`, "# Desktop feature\n\nUse blue.\n");
      yield* Queue.offer(events, {
        type: "result",
        threadId: task.threadIds.builder!,
        turnId: "revision-turn",
        operationId: state.operationId!,
        result: {
          outcome: "complete",
          summary: "Addressed both comments",
          artifacts: ["spec.md"],
        },
      });
      const awaiting = yield* service.changes.pipe(
        Stream.mapEffect(() => service.snapshot()),
        Stream.map((snapshot) => snapshot.tasks.find((value) => value.id === task.id)),
        Stream.filter(
          (value): value is WorkflowTask =>
            value?.nodes.some(
              (node) => node.nodeId === "approval" && node.status === "awaiting-approval",
            ) ?? false,
        ),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      assert.isUndefined(awaiting.reworkContext);
      assert.isUndefined(awaiting.reworkTargetNodeId);
      const current = yield* runner.artifact({ taskId: task.id, nodeId: "approval" });
      assert.notEqual(current.revision, artifact.revision);
      assert.equal(
        awaiting.nodes.find((node) => node.nodeId === "approval")?.artifactRevision,
        current.revision,
      );
      assert.equal(awaiting.nodes.find((node) => node.nodeId === "build")?.status, "pending");
      assert.equal(yield* Queue.size(dispatches), 0);
      const oldApproval = yield* runner
        .control({ ...input, action: "approve", expectedRevision: awaiting.revision })
        .pipe(Effect.result);
      assert.equal(oldApproval._tag, "Failure");
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}

for (const predecessorStatus of ["pending", "complete"] as const) {
  it.effect(
    `reviews a paused pending approval only with a complete predecessor (${predecessorStatus})`,
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
        const store = yield* WorkflowStore;
        const fs = yield* FileSystem.FileSystem;
        const worktree = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(
          `${worktree}/spec.md`,
          "# Spec\n\nUse red.\nShip a desktop app.\n",
        );
        const artifact = yield* readWorkflowArtifact(worktree, "spec.md");
        const fixture = taskFixture();
        const task: WorkflowTask = {
          ...fixture,
          status: "paused",
          worktreePath: worktree,
          nodes: fixture.nodes.map((node) =>
            node.nodeId === "plan" ? { ...node, status: predecessorStatus } : node,
          ),
        };
        yield* store.save(task, 0, "task.paused");
        let dispatches = 0;
        let preparations = 0;
        const runner = yield* makeWorkflowRunner.pipe(
          Effect.provideService(WorkflowRuntime, {
            watch: () => Effect.void,
            readResult: () => Effect.succeed(null),
            reviewRevision: () => Effect.succeed("revision"),
            validate: () => Effect.void,
            plan: Effect.succeed,
            prepare: () =>
              Effect.sync(() => {
                preparations++;
              }),
            interrupt: () => Effect.void,
            dispatch: () =>
              Effect.sync(() => {
                dispatches++;
              }),
            events: Stream.empty,
          }),
        );
        const input = {
          taskId: task.id,
          expectedRevision: task.revision,
          nodeId: "approval",
          artifactRevision: artifact.revision,
        };
        if (predecessorStatus === "pending") {
          for (const action of ["approve", "revise"] as const) {
            const rejected = yield* runner
              .control({ ...input, action, revisionComments: comments })
              .pipe(Effect.result);
            assert.equal(rejected._tag, "Failure");
            if (rejected._tag === "Failure")
              assert.include(rejected.failure.message, "not ready for review");
          }
          assert.deepEqual(yield* store.get(task.id), task);
        } else {
          const approved = yield* runner.control({ ...input, action: "approve" });
          assert.equal(approved.status, "paused");
          assert.equal(
            approved.nodes.find((node) => node.nodeId === "approval")?.status,
            "complete",
          );
          assert.equal(
            approved.nodes.find((node) => node.nodeId === "approval")?.artifactRevision,
            artifact.revision,
          );
          assert.equal(approved.nodes.find((node) => node.nodeId === "build")?.status, "pending");
          assert.deepEqual(yield* store.get(task.id), approved);
        }
        assert.equal(preparations, 0);
        assert.equal(dispatches, 0);
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}

for (const [approvalStatus, revisionTarget] of [
  ["pending", "review-a"],
  ["awaiting-approval", "review-a"],
  ["pending", "plan"],
] as const) {
  it.effect(`handles failed branches when revising ${approvalStatus} to ${revisionTarget}`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
      const store = yield* WorkflowStore;
      const fs = yield* FileSystem.FileSystem;
      const worktree = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${worktree}/spec.md`, "# Spec\n\nUse red.\nShip a mobile app.\n");
      const artifact = yield* readWorkflowArtifact(worktree, "spec.md");
      const fixture = taskFixture();
      const nodeIds = new Set(["plan", "review-a", "approval", "review-b"]);
      const failure = "The second reviewer failed before producing a result.";
      const task: WorkflowTask = {
        ...fixture,
        status: "paused",
        error: failure,
        worktreePath: worktree,
        reworkTargetNodeId: "review-b",
        reworkContext: {
          outcome: "changes-requested",
          summary: "Previous feedback still awaiting recovery.",
          artifacts: ["spec.md"],
        },
        definition: {
          ...fixture.definition,
          rework: null,
          nodes: fixture.definition.nodes
            .filter((node) => nodeIds.has(node.id))
            .map((node) => (node.kind === "approval" ? { ...node, revisionTarget } : node)),
          edges: [
            { from: "plan", to: "review-a" },
            { from: "review-a", to: "approval" },
            { from: "plan", to: "review-b" },
          ],
        },
        nodes: fixture.nodes
          .filter((node) => nodeIds.has(node.nodeId))
          .map((node) => {
            if (node.nodeId === "approval")
              return {
                ...node,
                status: approvalStatus,
                artifactRevision: approvalStatus === "pending" ? null : "previous-artifact-hash",
              };
            if (node.nodeId === "review-b") return { ...node, status: "failed", error: failure };
            return {
              ...node,
              status: "complete",
              result: { outcome: "complete", summary: "Finished", artifacts: ["spec.md"] },
              reviewRevision: "code-revision",
            };
          }),
      };
      assert.deepEqual(validateWorkflowGraph(task.definition), []);
      yield* store.save(task, 0, "task.paused");
      const dispatches = yield* Queue.unbounded<{ task: WorkflowTask; nodeId: string }>();
      let preparations = 0;
      const runner = yield* makeWorkflowRunner.pipe(
        Effect.provideService(WorkflowRuntime, {
          watch: () => Effect.void,
          readResult: () => Effect.succeed(null),
          reviewRevision: () => Effect.succeed("code-revision"),
          validate: () => Effect.void,
          plan: Effect.succeed,
          prepare: () =>
            Effect.sync(() => {
              preparations++;
            }),
          interrupt: () => Effect.void,
          dispatch: (dispatched, node) =>
            Effect.gen(function* () {
              assert.deepEqual(yield* store.get(dispatched.id), dispatched);
              yield* Queue.offer(dispatches, { task: dispatched, nodeId: node.id });
            }).pipe(Effect.orDie),
          events: Stream.empty,
        }),
      );
      const input = {
        taskId: task.id,
        expectedRevision: task.revision,
        nodeId: "approval",
        action: "revise" as const,
        artifactRevision: artifact.revision,
        revisionComments: comments,
      };
      let current = task;
      if (revisionTarget === "review-a") {
        const rejected = yield* runner.control(input).pipe(Effect.result);
        assert.equal(rejected._tag, "Failure");
        if (rejected._tag === "Failure")
          assert.include(
            rejected.failure.message,
            "Retry the other failed stages before requesting revisions.",
          );
        assert.deepEqual(yield* store.get(task.id), task);
        assert.equal(yield* Queue.size(dispatches), 0);
        assert.equal(preparations, 0);
        current = yield* runner.control({
          taskId: task.id,
          expectedRevision: task.revision,
          nodeId: "review-b",
          action: "retry",
        });
        assert.equal(current.status, "paused");
        assert.equal(current.nodes.find((node) => node.nodeId === "review-b")?.status, "pending");
        assert.deepEqual(current.reworkContext, task.reworkContext);
        assert.equal(yield* Queue.size(dispatches), 0);
      }
      const revised = yield* runner.control({ ...input, expectedRevision: current.revision });
      assert.equal(revised.status, "running");
      assert.isNull(revised.error);
      assert.equal(revised.iteration, 1);
      assert.equal(revised.reworkTargetNodeId, revisionTarget);
      assert.equal(revised.reworkContext?.outcome, "changes-requested");
      assert.deepEqual(revised.reworkContext?.artifacts, ["spec.md"]);
      assert.include(revised.reworkContext!.summary, comments[0]!.text);
      assert.include(revised.reworkContext!.summary, comments[1]!.text);
      assert.include(revised.reworkContext!.summary, "> 3: Use red.\n> 4: Ship a mobile app.");
      assert.isFalse(revised.nodes.some((node) => node.status === "failed"));
      assert.isNull(revised.nodes.find((node) => node.nodeId === "approval")?.artifactRevision);
      assert.deepEqual(yield* store.get(task.id), revised);
      for (const nodeId of revisionTarget === "plan" ? ["plan"] : ["review-a", "review-b"]) {
        const dispatched = yield* Queue.take(dispatches);
        assert.equal(dispatched.nodeId, nodeId);
        assert.deepEqual(dispatched.task.reworkContext, revised.reworkContext);
      }
      assert.equal(yield* Queue.size(dispatches), 0);
      assert.equal(preparations, 0);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}
