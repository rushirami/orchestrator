import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import {
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadShell,
  WorkflowStageResult,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PersistenceSqlError } from "../persistence/Errors.ts";
import {
  ProjectionTurnById,
  ProjectionTurnRepository,
} from "../persistence/Services/ProjectionTurns.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { WorkflowRuntime } from "./WorkflowRuntime.ts";
import { taskFixture } from "./testFixtures.ts";

const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeTurn = Schema.decodeUnknownSync(ProjectionTurnById);
const decodeThread = Schema.decodeUnknownEffect(OrchestrationThread);
const decodeShell = Schema.decodeUnknownEffect(OrchestrationThreadShell);
const encodeStageResult = Schema.encodeEffect(Schema.fromJsonString(WorkflowStageResult));
const now = "2026-09-05T00:00:00.000Z";
const event = (type: string, payload: unknown) =>
  decodeEvent({
    type,
    payload,
    sequence: 1,
    eventId: "event",
    aggregateKind: "thread",
    aggregateId: "affected",
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  });
const sessionEvent = (threadId: string, activeTurnId: string | null, status = "running") =>
  event("thread.session-set", {
    threadId,
    session: {
      threadId,
      activeTurnId,
      status,
      providerName: "codex",
      runtimeMode: "full-access",
      lastError: null,
      updatedAt: now,
    },
  });
const checkpointFailureEvent = (
  turnId: string | null = "affected-turn",
  checkpointCaptured = false,
) =>
  event("thread.activity-appended", {
    threadId: "affected",
    activity: {
      id: "capture-failure",
      kind: "checkpoint.capture.failed",
      tone: "error",
      summary: "Checkpoint capture failed",
      payload: { detail: "Git could not write the checkpoint.", checkpointCaptured },
      turnId,
      createdAt: now,
    },
  });

for (const [name, failedEvent] of [
  ["active session turn", sessionEvent("affected", "affected-turn")],
  ["pending failed session", sessionEvent("affected", null, "error")],
  ["checkpoint capture failure", checkpointFailureEvent()],
  [
    "completed turn",
    event("thread.turn-diff-completed", {
      threadId: "affected",
      turnId: "affected-turn",
      checkpointTurnCount: 1,
      checkpointRef: "refs/checkpoints/test",
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: now,
    }),
  ],
] as const) {
  it.effect(`surfaces a failed ${name} lookup and still delivers the next workflow event`, () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime;
      yield* runtime.watch({
        ...taskFixture(),
        threadIds: { builder: ThreadId.make("affected"), reviewer: ThreadId.make("other") },
      });
      const received = yield* Stream.runCollect(runtime.events);
      assert.equal(received.length, 2);
      assert.equal(received[0]?.type, "lookup-failed");
      assert.equal(received[0]?.threadId, "affected");
      assert.equal(received[0]?.turnId, name === "pending failed session" ? null : "affected-turn");
      assert.deepEqual(received[1], {
        type: "started",
        threadId: ThreadId.make("other"),
        turnId: "other-turn",
        operationId: "other-operation",
      });
    }).pipe(
      Effect.provide(
        WorkflowRuntime.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              ServerConfig.layerTest(process.cwd(), { prefix: "workflow-runtime-" }),
              Layer.mock(OrchestrationEngineService)({
                subscribeDomainEvents: Effect.succeed(
                  Stream.fromIterable([failedEvent, sessionEvent("other", "other-turn")]),
                ),
              }),
              Layer.mock(ProjectionSnapshotQuery)({}),
              Layer.mock(ProviderService)({}),
              Layer.mock(GitVcsDriver)({}),
              Layer.mock(ProjectionTurnRepository)({
                getByTurnId: ({ threadId }) =>
                  threadId === "affected"
                    ? Effect.fail(new PersistenceSqlError({ operation: "read workflow turn" }))
                    : Effect.succeed(
                        Option.some(
                          decodeTurn({
                            threadId: "other",
                            turnId: "other-turn",
                            pendingMessageId: "other-operation",
                            state: "running",
                            sourceProposedPlanThreadId: null,
                            sourceProposedPlanId: null,
                            assistantMessageId: null,
                            requestedAt: now,
                            startedAt: now,
                            completedAt: null,
                            checkpointTurnCount: null,
                            checkpointRef: null,
                            checkpointStatus: null,
                            checkpointFiles: [],
                          }),
                        ),
                      ),
                getPendingTurnStartByThreadId: () =>
                  Effect.fail(new PersistenceSqlError({ operation: "read pending workflow turn" })),
              }),
            ).pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );
}

const checkpointEvent = (status = "ready") =>
  event("thread.turn-diff-completed", {
    threadId: "affected",
    turnId: "affected-turn",
    checkpointTurnCount: 1,
    checkpointRef: "refs/checkpoints/test",
    status,
    files: [],
    assistantMessageId: "placeholder",
    completedAt: now,
  });
const result: WorkflowStageResult = {
  outcome: "complete",
  summary: "Created specification",
  artifacts: ["spec.md"],
};

it.effect(
  "starts the existing revision target with the user's feedback before its original skill",
  () =>
    Effect.gen(function* () {
      const commands: OrchestrationCommand[] = [];
      const task = {
        ...taskFixture(),
        threadIds: { builder: ThreadId.make("existing-builder") },
        reworkTargetNodeId: "plan",
        reworkContext: {
          outcome: "changes-requested" as const,
          summary: "spec.md lines 3-4: Use blue and keep this desktop-only.",
          artifacts: ["spec.md"],
        },
      };
      const shell = yield* decodeShell({
        id: "existing-builder",
        projectId: task.projectId,
        title: "Builder",
        modelSelection: { instanceId: "codex", model: "default" },
        runtimeMode: "full-access",
        branch: task.branch,
        worktreePath: task.worktreePath,
        latestTurn: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        session: null,
      });
      const runtime = yield* WorkflowRuntime.pipe(
        Effect.provide(
          WorkflowRuntime.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                ServerConfig.layerTest(process.cwd(), { prefix: "workflow-revision-prompt-" }),
                Layer.mock(OrchestrationEngineService)({
                  subscribeDomainEvents: Effect.succeed(Stream.empty),
                  dispatch: (command) =>
                    Effect.sync(() => {
                      commands.push(command);
                      return { sequence: commands.length };
                    }),
                }),
                Layer.mock(ProjectionSnapshotQuery)({
                  getThreadShellById: () => Effect.succeed(Option.some(shell)),
                }),
                Layer.mock(ProviderService)({}),
                Layer.mock(GitVcsDriver)({}),
                Layer.mock(ProjectionTurnRepository)({}),
              ).pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
            ),
          ),
        ),
      );
      const plan = task.definition.nodes.find((node) => node.id === "plan")!;
      const build = task.definition.nodes.find((node) => node.id === "build")!;
      assert.equal(plan.kind, "agent");
      assert.equal(build.kind, "agent");
      if (plan.kind !== "agent" || build.kind !== "agent") return;
      yield* runtime.dispatch(task, plan, "revision-operation");
      yield* runtime.dispatch(task, build, "unrelated-operation");
      const revision = commands[0]!;
      const unrelated = commands[1]!;
      assert.equal(revision.type, "thread.turn.start");
      assert.equal(unrelated.type, "thread.turn.start");
      if (revision.type !== "thread.turn.start" || unrelated.type !== "thread.turn.start") return;
      assert.equal(revision.threadId, task.threadIds.builder);
      assert.include(revision.message.text, task.reworkContext.summary);
      assert.isBelow(
        revision.message.text.indexOf(task.reworkContext.summary),
        revision.message.text.indexOf(plan.skills[0]!.prompt),
      );
      assert.notInclude(unrelated.message.text, task.reworkContext.summary);
    }).pipe(Effect.scoped),
);

const baseTurn = decodeTurn({
  threadId: "affected",
  turnId: "affected-turn",
  pendingMessageId: "operation",
  state: "running",
  sourceProposedPlanThreadId: null,
  sourceProposedPlanId: null,
  assistantMessageId: "placeholder",
  requestedAt: now,
  startedAt: now,
  completedAt: null,
  checkpointTurnCount: 1,
  checkpointRef: "refs/checkpoints/test",
  checkpointStatus: "missing",
  checkpointFiles: [],
});

type Step = {
  event: OrchestrationEvent;
  state: ProjectionTurnById["state"];
  checkpoint: ProjectionTurnById["checkpointStatus"];
};
for (const [name, steps, expected] of [
  [
    "fails a completed turn when its placeholder checkpoint capture fails",
    [
      { event: sessionEvent("affected", null, "ready"), state: "completed", checkpoint: "missing" },
      { event: checkpointFailureEvent(), state: "completed", checkpoint: "missing" },
    ],
    "failed",
  ],
  [
    "fails a completed turn when checkpoint capture fails without a placeholder",
    [{ event: checkpointFailureEvent(), state: "completed", checkpoint: null }],
    "failed",
  ],
  [
    "surfaces capture failure even before the terminal session is projected",
    [{ event: checkpointFailureEvent(), state: "running", checkpoint: "missing" }],
    "failed",
  ],
  [
    "ignores diff summary failure when the checkpoint was captured",
    [
      {
        event: checkpointFailureEvent("affected-turn", true),
        state: "completed",
        checkpoint: "missing",
      },
      { event: checkpointEvent(), state: "completed", checkpoint: "ready" },
    ],
    "result",
  ],
  [
    "ignores a late capture failure after a ready checkpoint",
    [
      { event: checkpointFailureEvent(), state: "completed", checkpoint: "ready" },
      { event: sessionEvent("affected", null, "ready"), state: "completed", checkpoint: "ready" },
    ],
    "result",
  ],
  [
    "does not assign an uncorrelated capture failure to the latest turn",
    [
      { event: checkpointFailureEvent(null), state: "completed", checkpoint: null },
      { event: checkpointEvent(), state: "completed", checkpoint: "ready" },
    ],
    "result",
  ],
  [
    "waits through an intermediate diff and checkpoint for provider completion",
    [
      { event: checkpointEvent("missing"), state: "running", checkpoint: "missing" },
      { event: checkpointEvent(), state: "running", checkpoint: "ready" },
      { event: sessionEvent("affected", null, "ready"), state: "completed", checkpoint: "ready" },
    ],
    "result",
  ],
  [
    "waits for the checkpoint when the provider completes first",
    [
      { event: sessionEvent("affected", null, "ready"), state: "completed", checkpoint: "missing" },
      { event: checkpointEvent(), state: "completed", checkpoint: "ready" },
    ],
    "result",
  ],
  [
    "settles an interrupted session that retains its active turn ID",
    [
      {
        event: sessionEvent("affected", "affected-turn", "interrupted"),
        state: "interrupted",
        checkpoint: "ready",
      },
    ],
    "failed",
  ],
  [
    "rejects an interrupted turn even with a complete result and ready checkpoint",
    [
      {
        event: sessionEvent("affected", null, "interrupted"),
        state: "interrupted",
        checkpoint: "ready",
      },
    ],
    "failed",
  ],
  [
    "rejects a failed turn even with a complete result and ready checkpoint",
    [{ event: checkpointEvent(), state: "error", checkpoint: "ready" }],
    "failed",
  ],
  [
    "reports checkpoint failure after the provider completes",
    [{ event: checkpointEvent("error"), state: "completed", checkpoint: "error" }],
    "failed",
  ],
] satisfies [string, Step[], string][]) {
  it.effect(name, () =>
    Effect.gen(function* () {
      let current = baseTurn;
      const detail = yield* decodeThread({
        id: "affected",
        projectId: "project-a",
        title: "Builder",
        modelSelection: { instanceId: "codex", model: "default" },
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        activities: [],
        checkpoints: [],
        session: null,
        messages: [
          {
            id: "final",
            turnId: "affected-turn",
            role: "assistant",
            streaming: false,
            text: yield* encodeStageResult(result),
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "placeholder",
            turnId: "affected-turn",
            role: "assistant",
            streaming: true,
            text: "Partial output",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "user",
            turnId: "affected-turn",
            role: "user",
            streaming: false,
            text: "Not a result",
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "other",
            turnId: "other-turn",
            role: "assistant",
            streaming: false,
            text: "Unrelated turn",
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const shell = yield* decodeShell({
        ...detail,
        latestTurn: { ...baseTurn, state: "completed" },
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      });
      const runtime = yield* WorkflowRuntime.pipe(
        Effect.provide(
          WorkflowRuntime.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                ServerConfig.layerTest(process.cwd(), { prefix: "workflow-completion-" }),
                Layer.mock(OrchestrationEngineService)({
                  subscribeDomainEvents: Effect.succeed(
                    Stream.fromIterable<Step>(steps).pipe(
                      Stream.flatMap((step) =>
                        Stream.fromEffect(
                          Effect.sync(() => {
                            current = {
                              ...baseTurn,
                              state: step.state,
                              checkpointStatus: step.checkpoint,
                            };
                            return step.event;
                          }),
                        ),
                      ),
                    ),
                  ),
                }),
                Layer.mock(ProjectionTurnRepository)({
                  getByTurnId: () => Effect.sync(() => Option.some(current)),
                }),
                Layer.mock(ProjectionSnapshotQuery)({
                  getThreadDetailById: () => Effect.succeed(Option.some(detail)),
                  getThreadShellById: () => Effect.succeed(Option.some(shell)),
                }),
                Layer.mock(ProviderService)({}),
                Layer.mock(GitVcsDriver)({}),
              ).pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
            ),
          ),
        ),
      );
      yield* runtime.watch({ ...taskFixture(), threadIds: { builder: ThreadId.make("affected") } });
      const received = yield* Stream.runCollect(runtime.events);
      assert.equal(received.length, 1);
      assert.equal(received[0]?.type, expected);
      if (
        expected === "failed" &&
        steps.some((step) => step.event.type === "thread.activity-appended")
      )
        assert.deepEqual(received[0], {
          type: "failed",
          threadId: ThreadId.make("affected"),
          turnId: "affected-turn",
          operationId: "operation",
          error: "Checkpoint capture failed: Git could not write the checkpoint.",
        });
      if (expected === "result")
        assert.deepEqual(received[0], {
          type: "result",
          threadId: ThreadId.make("affected"),
          turnId: "affected-turn",
          operationId: "operation",
          result,
        });
    }).pipe(Effect.scoped),
  );
}
