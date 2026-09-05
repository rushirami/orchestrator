import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ThreadId,
  WorkflowId,
  WorkflowTaskId,
  type WorkflowTask,
  type WorkflowNode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeWorkflowRunner } from "./WorkflowRunner.ts";
import { WorkflowRuntime, type WorkflowRuntimeEvent } from "./WorkflowRuntime.ts";
import { WorkflowService } from "./WorkflowService.ts";
import { WorkflowStore } from "./WorkflowStore.ts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import { readWorkflowArtifact } from "./artifacts.ts";
import { templateFixture, taskFixture } from "./testFixtures.ts";

const layer = Layer.mergeAll(WorkflowService.layer, WorkflowStore.layer).pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
);

it.effect(
  "runs a complete local graph with durable approval, two reviews, and a waiting join",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
      const fs = yield* FileSystem.FileSystem;
      const worktree = yield* fs.makeTempDirectoryScoped();
      const service = yield* WorkflowService;
      const template = templateFixture();
      yield* service.saveTemplate({
        id: template.id,
        projectId: template.projectId,
        expectedRevision: 0,
        definition: template.definition,
      });
      const dispatches = yield* Queue.unbounded<{
        task: WorkflowTask;
        node: Extract<WorkflowNode, { kind: "agent" }>;
        operationId: string;
      }>();
      const events = yield* Queue.unbounded<WorkflowRuntimeEvent>();
      let preparations = 0;
      let reviewBasis = "review-basis";
      const runner = yield* makeWorkflowRunner.pipe(
        Effect.provideService(WorkflowRuntime, {
          watch: () => Effect.void,
          reviewRevision: () => Effect.succeed(reviewBasis),
          validate: () => Effect.void,
          plan: (task) => Effect.succeed({ ...task, worktreePath: worktree, baseCommit: "abc123" }),
          prepare: () =>
            Effect.sync(() => {
              preparations++;
            }),
          dispatch: (task, node, operationId) =>
            Queue.offer(dispatches, { task, node, operationId }).pipe(Effect.asVoid),
          interrupt: () => Effect.void,
          events: Stream.fromQueue(events),
        }),
      );
      const input = {
        taskId: WorkflowTaskId.make("local-pipeline"),
        templateId: template.id,
        projectId: template.projectId,
        templateRevision: 1,
        workspaceName: "Local pipeline",
        baseBranch: "main",
        branch: "feat/local-pipeline",
        variables: { TASK: "Build a local greeting" },
        threads: template.definition.threads,
      };
      const launched = yield* runner.launch(input);
      assert.equal(launched.nodes[0]?.status, "dispatching");
      const duplicate = yield* runner.launch(input);
      assert.equal(duplicate.id, launched.id);
      assert.equal(preparations, 1);
      const awaitTask = (predicate: (task: WorkflowTask) => boolean) =>
        service.changes.pipe(
          Stream.mapEffect(() => service.snapshot()),
          Stream.map((snapshot) => snapshot.tasks.find((task) => task.id === input.taskId)),
          Stream.filter((task): task is WorkflowTask => task !== undefined && predicate(task)),
          Stream.runHead,
          Effect.map((task) => Option.getOrThrow(task)),
        );
      const completeNext = Effect.fn(function* (expectedNode: string, paths: string[]) {
        const next = yield* Queue.take(dispatches);
        assert.equal(next.node.id, expectedNode);
        for (const artifact of paths)
          yield* fs.writeFileString(`${worktree}/${artifact}`, `Evidence for ${expectedNode}`);
        const threadId = next.task.threadIds[next.node.threadId]!;
        const turnId = next.operationId;
        yield* Queue.offer(events, {
          type: "started",
          threadId,
          turnId,
          operationId: next.operationId,
        });
        yield* Queue.offer(events, {
          type: "result",
          threadId,
          turnId,
          operationId: next.operationId,
          result: { outcome: "complete", summary: `${expectedNode} completed`, artifacts: paths },
        });
        return next;
      });
      yield* completeNext("plan", ["spec.md"]);
      const awaiting = yield* awaitTask((task) =>
        task.nodes.some(
          (node) => node.nodeId === "approval" && node.status === "awaiting-approval",
        ),
      );
      assert.equal(yield* Queue.size(dispatches), 0);
      const artifact = yield* runner.artifact({ taskId: input.taskId, nodeId: "approval" });
      const stale = yield* runner
        .control({
          taskId: input.taskId,
          expectedRevision: awaiting.revision,
          action: "approve",
          nodeId: "approval",
          artifactRevision: "stale",
        })
        .pipe(Effect.result);
      assert.equal(stale._tag, "Failure");
      yield* runner.control({
        taskId: input.taskId,
        expectedRevision: awaiting.revision,
        action: "approve",
        nodeId: "approval",
        artifactRevision: artifact.revision,
      });
      const build = yield* completeNext("build", ["result.txt"]);
      const validation = yield* completeNext("build", ["validation.md"]);
      assert.equal(build.task.threadIds.builder, validation.task.threadIds.builder);
      const reviewA = yield* Queue.take(dispatches);
      const reviewB = yield* Queue.take(dispatches);
      assert.deepEqual([reviewA.node.id, reviewB.node.id].sort(), ["review-a", "review-b"]);
      assert.notEqual(
        reviewA.task.threadIds[reviewA.node.threadId],
        reviewB.task.threadIds[reviewB.node.threadId],
      );
      yield* Queue.offer(events, {
        type: "result",
        threadId: reviewA.task.threadIds[reviewA.node.threadId]!,
        operationId: reviewA.operationId,
        turnId: reviewA.operationId,
        result: { outcome: "complete", summary: "First review", artifacts: [] },
      });
      yield* awaitTask((task) =>
        task.nodes.some((node) => node.nodeId === reviewA.node.id && node.status === "complete"),
      );
      assert.equal(yield* Queue.size(dispatches), 0);
      // An outside edit invalidates the in-flight review and the already completed sibling.
      reviewBasis = "changed-code";
      yield* Queue.offer(events, {
        type: "result",
        threadId: reviewB.task.threadIds[reviewB.node.threadId]!,
        operationId: reviewB.operationId,
        turnId: reviewB.operationId,
        result: { outcome: "complete", summary: "Second review", artifacts: [] },
      });
      const retryReview = Effect.fn(function* (nodeId: string) {
        const failed = yield* awaitTask(
          (task) =>
            task.status === "paused" &&
            task.nodes.some((node) => node.nodeId === nodeId && node.status === "failed"),
        );
        const prepared = yield* runner.control({
          taskId: input.taskId,
          expectedRevision: failed.revision,
          action: "retry",
          nodeId,
        });
        yield* runner.control({
          taskId: input.taskId,
          expectedRevision: prepared.revision,
          action: "resume",
        });
        yield* completeNext(nodeId, []);
      });
      yield* retryReview(reviewB.node.id);
      yield* retryReview(reviewA.node.id);
      yield* completeNext("combine", ["reviews.md"]);
      const done = yield* awaitTask((task) => task.status === "complete");
      assert.isTrue(done.nodes.every((node) => node.status === "complete"));
      assert.equal(preparations, 1);
      yield* service.remove({
        id: done.id,
        projectId: done.projectId,
        expectedRevision: done.revision,
      });
      assert.equal((yield* service.snapshot()).tasks.length, 0);
      assert.equal((yield* runner.launch(input).pipe(Effect.result))._tag, "Failure");
    }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("recovers uncertain dispatches without resending and reconciles cancellation", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
    const store = yield* WorkflowStore;
    const service = yield* WorkflowService;
    const fixture = taskFixture();
    const task = { ...fixture, threadIds: { builder: ThreadId.make("recovery-builder") } };
    const first = task.nodes[0]!;
    yield* store.save(
      {
        ...task,
        nodes: task.nodes.map((node) =>
          node === first
            ? { ...node, status: "dispatching", operationId: "uncertain-operation" }
            : node,
        ),
      },
      0,
      "task.dispatching",
    );
    const events = yield* Queue.unbounded<WorkflowRuntimeEvent>();
    let sent = 0;
    let interrupted = 0;
    const runner = yield* makeWorkflowRunner.pipe(
      Effect.provideService(WorkflowRuntime, {
        watch: () => Effect.void,
        reviewRevision: () => Effect.succeed("revision"),
        validate: () => Effect.void,
        plan: Effect.succeed,
        prepare: () => Effect.void,
        dispatch: () =>
          Effect.sync(() => {
            sent++;
          }),
        interrupt: () =>
          Effect.sync(() => {
            interrupted++;
          }),
        events: Stream.fromQueue(events),
      }),
    );
    const awaitTask = (predicate: (value: WorkflowTask) => boolean) =>
      service.changes.pipe(
        Stream.mapEffect(() => service.snapshot()),
        Stream.map((snapshot) => snapshot.tasks.find((value) => value.id === task.id)),
        Stream.filter((value): value is WorkflowTask => value !== undefined && predicate(value)),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
    const recovered = yield* awaitTask((value) => value.status === "paused");
    assert.equal(recovered.nodes[0]?.status, "failed");
    assert.equal(sent, 0);
    const prepared = yield* runner.control({
      taskId: task.id,
      expectedRevision: recovered.revision,
      action: "retry",
      nodeId: first.nodeId,
    });
    const running = yield* runner.control({
      taskId: task.id,
      expectedRevision: prepared.revision,
      action: "resume",
    });
    assert.equal(sent, 1);
    const cancelled = yield* runner.control({
      taskId: task.id,
      expectedRevision: running.revision,
      action: "cancel",
    });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(interrupted, 1);
    const threadId = Object.values(task.threadIds)[0]!;
    yield* Queue.offer(events, {
      type: "started",
      threadId,
      turnId: "old-turn",
      operationId: "uncertain-operation",
    });
    yield* Queue.offer(events, {
      type: "result",
      threadId,
      turnId: "old-turn",
      operationId: "uncertain-operation",
      result: { outcome: "complete", summary: "Late result from before restart", artifacts: [] },
    });
    yield* Queue.offer(events, {
      type: "started",
      threadId,
      turnId: "late-start",
      operationId: running.nodes[0]!.operationId!,
    });
    yield* awaitTask((value) => value.nodes[0]?.turnId === "late-start");
    yield* Queue.offer(events, {
      type: "failed",
      threadId,
      turnId: "late-start",
      operationId: running.nodes[0]!.operationId!,
      error: "Interrupted",
    });
    const settled = yield* awaitTask((value) => value.nodes[0]?.status === "failed");
    assert.equal(interrupted, 2);
    assert.equal(sent, 1);
    assert.equal(settled.status, "cancelled");
    yield* service.remove({
      id: task.id,
      projectId: task.projectId,
      expectedRevision: settled.revision,
    });
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

for (const scenario of [
  "approval",
  "join-approval",
  "terminal-approval",
  "approved-while-paused",
] as const) {
  it.effect(
    `revalidates reviewed code across ${scenario} and requires fresh approval after retry`,
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
        const fs = yield* FileSystem.FileSystem;
        const worktree = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(`${worktree}/spec.md`, "Unchanged approval artifact");
        const artifact = yield* readWorkflowArtifact(worktree, "spec.md");
        const store = yield* WorkflowStore;
        const service = yield* WorkflowService;
        const fixture = taskFixture();
        const terminal = scenario === "terminal-approval";
        const joined = scenario === "join-approval";
        const nodes: WorkflowNode[] = fixture.definition.nodes.filter((node) =>
          ["plan", "approval", "review-a", "review-b", ...(terminal ? [] : ["combine"])].includes(
            node.id,
          ),
        );
        if (joined)
          nodes.push({ id: "join", name: "Join", kind: "join", position: { x: 0, y: 0 } });
        const task: WorkflowTask = {
          ...fixture,
          status: "paused",
          worktreePath: worktree,
          threadIds: {
            builder: ThreadId.make("builder"),
            "review-a": ThreadId.make("a"),
            "review-b": ThreadId.make("b"),
          },
          definition: {
            ...fixture.definition,
            rework: null,
            nodes,
            edges: [
              { from: "plan", to: "review-a" },
              { from: "plan", to: "review-b" },
              { from: "review-a", to: joined ? "join" : "approval" },
              { from: "review-b", to: joined ? "join" : "approval" },
              ...(joined ? [{ from: "join", to: "approval" }] : []),
              ...(terminal ? [] : [{ from: "approval", to: "combine" }]),
            ],
          },
          nodes: nodes.map((node) => ({
            ...fixture.nodes[0]!,
            nodeId: node.id,
            status:
              node.id === "combine"
                ? "pending"
                : node.id === "approval" && scenario !== "approved-while-paused"
                  ? "awaiting-approval"
                  : "complete",
            artifactRevision: node.id === "approval" ? artifact.revision : null,
            reviewRevision: node.id.startsWith("review-") ? "reviewed-code" : undefined,
          })),
        };
        assert.deepEqual(validateWorkflowGraph(task.definition), []);
        yield* store.save(task, 0, "task.seeded");
        const events = yield* Queue.unbounded<WorkflowRuntimeEvent>();
        const dispatches = yield* Queue.unbounded<{
          task: WorkflowTask;
          node: Extract<WorkflowNode, { kind: "agent" }>;
          operationId: string;
        }>();
        let basis = "reviewed-code";
        const runner = yield* makeWorkflowRunner.pipe(
          Effect.provideService(WorkflowRuntime, {
            watch: () => Effect.void,
            reviewRevision: () => Effect.succeed(basis),
            validate: () => Effect.void,
            plan: Effect.succeed,
            prepare: () => Effect.void,
            interrupt: () => Effect.void,
            dispatch: (task, node, operationId) =>
              Queue.offer(dispatches, { task, node, operationId }).pipe(Effect.asVoid),
            events: Stream.fromQueue(events),
          }),
        );
        const awaitTask = (predicate: (value: WorkflowTask) => boolean) =>
          service.changes.pipe(
            Stream.mapEffect(() => service.snapshot()),
            Stream.map((snapshot) => snapshot.tasks.find((value) => value.id === task.id)),
            Stream.filter(
              (value): value is WorkflowTask => value !== undefined && predicate(value),
            ),
            Stream.runHead,
            Effect.map(Option.getOrThrow),
          );
        let current = task;
        if (scenario !== "approved-while-paused")
          current = yield* runner.control({
            taskId: task.id,
            expectedRevision: current.revision,
            action: "resume",
          });
        // The approval file is untouched, but an unrelated code edit changes the review basis.
        basis = "edited-code";
        current = yield* runner.control({
          taskId: task.id,
          expectedRevision: current.revision,
          ...(scenario === "approved-while-paused"
            ? { action: "resume" as const }
            : {
                action: "approve" as const,
                nodeId: "approval",
                artifactRevision: artifact.revision,
              }),
        });
        assert.equal(current.status, "paused");
        assert.equal(yield* Queue.size(dispatches), 0);
        assert.isTrue(
          current.nodes
            .filter((node) => node.nodeId.startsWith("review-"))
            .every((node) => node.status === "failed"),
        );
        assert.equal(current.nodes.find((node) => node.nodeId === "approval")?.status, "pending");
        assert.isNull(current.nodes.find((node) => node.nodeId === "approval")?.artifactRevision);
        if (joined)
          assert.equal(current.nodes.find((node) => node.nodeId === "join")?.status, "pending");
        for (const nodeId of ["review-a", "review-b"])
          current = yield* runner.control({
            taskId: task.id,
            expectedRevision: current.revision,
            action: "retry",
            nodeId,
          });
        yield* runner.control({
          taskId: task.id,
          expectedRevision: current.revision,
          action: "resume",
        });
        for (let i = 0; i < 2; i++) {
          const next = yield* Queue.take(dispatches);
          assert.isTrue(next.node.id.startsWith("review-"));
          yield* Queue.offer(events, {
            type: "result",
            threadId: next.task.threadIds[next.node.threadId]!,
            turnId: next.operationId,
            operationId: next.operationId,
            result: { outcome: "complete", summary: "Fresh review", artifacts: [] },
          });
        }
        current = yield* awaitTask((value) =>
          value.nodes.some(
            (node) => node.nodeId === "approval" && node.status === "awaiting-approval",
          ),
        );
        assert.equal(yield* Queue.size(dispatches), 0);
        current = yield* runner.control({
          taskId: task.id,
          expectedRevision: current.revision,
          action: "approve",
          nodeId: "approval",
          artifactRevision: artifact.revision,
        });
        if (terminal) assert.equal(current.status, "complete");
        else assert.equal((yield* Queue.take(dispatches)).node.id, "combine");
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );
}

it.effect("project deletion removes templates saved after its guard snapshot", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
    const service = yield* WorkflowService;
    const template = templateFixture();
    yield* service.saveTemplate({
      id: template.id,
      projectId: template.projectId,
      expectedRevision: 0,
      definition: template.definition,
    });
    const runner = yield* makeWorkflowRunner.pipe(
      Effect.provideService(WorkflowRuntime, {
        watch: () => Effect.void,
        reviewRevision: () => Effect.succeed("revision"),
        validate: () => Effect.void,
        plan: Effect.succeed,
        prepare: () => Effect.void,
        interrupt: () => Effect.void,
        dispatch: () => Effect.void,
        events: Stream.empty,
      }),
    );
    const command = {
      type: "project.delete" as const,
      commandId: CommandId.make("delete-project"),
      projectId: template.projectId,
    };
    const failed = yield* runner
      .runClientCommand(command, Effect.fail("Deletion failed"))
      .pipe(Effect.result);
    assert.equal(failed._tag, "Failure");
    assert.equal((yield* service.snapshot()).templates.length, 1);
    yield* runner.runClientCommand(
      command,
      Effect.gen(function* () {
        // Run concurrent-window saves precisely between the pre-delete guard and projection update.
        yield* service.saveTemplate({
          id: template.id,
          projectId: template.projectId,
          expectedRevision: 1,
          definition: { ...template.definition, name: "Updated during deletion" },
        });
        yield* service.saveTemplate({
          id: WorkflowId.make("saved-during-delete"),
          projectId: template.projectId,
          expectedRevision: 0,
          definition: template.definition,
        });
        yield* sql`UPDATE projection_projects SET deleted_at = '2026-09-05T00:00:00.000Z' WHERE project_id = ${template.projectId}`;
      }),
    );
    assert.equal((yield* service.snapshot()).templates.length, 0);
    const late = yield* service
      .saveTemplate({
        id: template.id,
        projectId: template.projectId,
        expectedRevision: 0,
        definition: template.definition,
      })
      .pipe(Effect.result);
    assert.equal(late._tag, "Failure");
  }).pipe(Effect.scoped, Effect.provide(layer)),
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

it.effect("pauses an affected stage on lookup failure without stopping other workflow events", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects(project_id, title, workspace_root, scripts_json, created_at, updated_at) VALUES ('project-a', 'Project', '/tmp/project', '[]', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')`;
    const fs = yield* FileSystem.FileSystem;
    const worktree = yield* fs.makeTempDirectoryScoped();
    const service = yield* WorkflowService;
    const template = templateFixture();
    yield* service.saveTemplate({
      id: template.id,
      projectId: template.projectId,
      expectedRevision: 0,
      definition: template.definition,
    });
    const events = yield* Queue.unbounded<WorkflowRuntimeEvent>();
    const runner = yield* makeWorkflowRunner.pipe(
      Effect.provideService(WorkflowRuntime, {
        ...idleRuntime,
        events: Stream.fromQueue(events),
        plan: (task) => Effect.succeed({ ...task, worktreePath: worktree, baseCommit: "abc123" }),
      }),
    );
    const launch = (id: string) =>
      runner.launch({
        taskId: WorkflowTaskId.make(id),
        templateId: template.id,
        projectId: template.projectId,
        templateRevision: 1,
        workspaceName: id,
        baseBranch: "main",
        branch: `feat/${id}`,
        variables: { TASK: id },
        threads: template.definition.threads,
      });
    const affected = yield* launch("affected");
    const other = yield* launch("other");
    yield* Queue.offer(events, {
      type: "lookup-failed",
      threadId: affected.threadIds.builder!,
      turnId: "affected-turn",
      error: "Could not read workflow turn state. Inspect the agent thread before retrying.",
    });
    yield* Queue.offer(events, {
      type: "started",
      threadId: other.threadIds.builder!,
      operationId: other.nodes[0]!.operationId!,
      turnId: "other-turn",
    });
    const snapshot = yield* service.changes.pipe(
      Stream.mapEffect(() => service.snapshot()),
      Stream.filter((snapshot) =>
        snapshot.tasks.some((task) => task.id === other.id && task.nodes[0]?.status === "running"),
      ),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
    const failed = snapshot.tasks.find((task) => task.id === affected.id)!;
    assert.equal(failed.status, "paused");
    assert.equal(failed.nodes[0]?.status, "failed");
    assert.include(failed.nodes[0]?.error, "Inspect the agent thread");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
