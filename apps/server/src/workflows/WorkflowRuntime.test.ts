import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
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

for (const [name, failedEvent] of [
  ["active session turn", sessionEvent("affected", "affected-turn")],
  ["pending failed session", sessionEvent("affected", null, "error")],
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
