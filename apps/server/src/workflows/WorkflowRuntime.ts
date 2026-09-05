import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  ThreadId,
  TurnId,
  WorkflowError,
  type WorkflowTask,
  type WorkflowNode,
  type WorkflowDefinition,
  WorkflowStageResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { captureWorkflowReviewRevision } from "./reviewRevision.ts";
import { parseWorkflowResult } from "./artifacts.ts";

export type WorkflowRuntimeEvent =
  | ({ operationId: string } & (
      | { type: "started"; threadId: ThreadId; turnId: string }
      | { type: "result"; threadId: ThreadId; turnId: string; result: WorkflowStageResult }
      | { type: "failed"; threadId: ThreadId; turnId: string | null; error: string }
    ))
  | { type: "lookup-failed"; threadId: ThreadId; turnId: string | null; error: string };

export interface WorkflowRuntimeShape {
  readonly watch: (task: WorkflowTask) => Effect.Effect<void>;
  readonly readResult: (
    threadId: ThreadId,
    turnId: TurnId,
  ) => Effect.Effect<WorkflowRuntimeEvent | null, WorkflowError>;
  readonly reviewRevision: (task: WorkflowTask) => Effect.Effect<string, WorkflowError>;
  readonly validate: (definition: WorkflowDefinition) => Effect.Effect<void, WorkflowError>;
  readonly plan: (task: WorkflowTask) => Effect.Effect<WorkflowTask, WorkflowError>;
  readonly prepare: (task: WorkflowTask) => Effect.Effect<void, WorkflowError>;
  readonly dispatch: (
    task: WorkflowTask,
    node: Extract<WorkflowNode, { kind: "agent" }>,
    operationId: string,
  ) => Effect.Effect<void, WorkflowError>;
  readonly interrupt: (
    threadId: ThreadId,
    turnId: string | null,
  ) => Effect.Effect<void, WorkflowError>;
  readonly events: Stream.Stream<WorkflowRuntimeEvent>;
}

const encodeResult = Schema.encodeEffect(Schema.fromJsonString(WorkflowStageResult));
const runtimeError = (error: { readonly message: string }) =>
  new WorkflowError({ message: error.message });
const make = Effect.gen(function* () {
  const watchedThreads = new Set<ThreadId>();
  const watch = (task: WorkflowTask) =>
    Effect.sync(() => {
      for (const id of Object.values(task.threadIds)) watchedThreads.add(id);
    });
  const engine = yield* OrchestrationEngineService;
  const queries = yield* ProjectionSnapshotQuery;
  const turns = yield* ProjectionTurnRepository;
  const providers = yield* ProviderService;
  const git = yield* GitVcsDriver;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectFor = Effect.fn(function* (task: WorkflowTask) {
    const project = yield* queries.getProjectShellById(task.projectId);
    if (Option.isNone(project))
      return yield* new WorkflowError({
        message: "The workflow's project is no longer available.",
      });
    return project.value;
  });
  const validate = Effect.fn(function* (definition: WorkflowDefinition) {
    for (const thread of definition.threads) {
      const capabilities = yield* providers.getCapabilities(thread.modelSelection.instanceId);
      if (
        definition.nodes.some(
          (node) =>
            node.kind === "agent" && node.threadId === thread.id && node.access === "read-only",
        ) &&
        !capabilities.supportsReadOnlyWorkflow
      ) {
        return yield* new WorkflowError({
          message: `${thread.name}'s provider does not support enforced read-only workflow stages. Choose Codex or Claude for this thread.`,
        });
      }
    }
  }, Effect.mapError(runtimeError));
  const plan = Effect.fn(function* (task: WorkflowTask) {
    const project = yield* projectFor(task);
    const branch = yield* git.execute({
      operation: "workflow.validateBranch",
      cwd: project.workspaceRoot,
      args: ["check-ref-format", "--branch", task.branch],
    });
    if (branch.stdout.trim() !== task.branch || task.branch.startsWith("-"))
      return yield* new WorkflowError({ message: "Choose a valid new branch name." });
    const base = yield* git.execute({
      operation: "workflow.resolveBase",
      cwd: project.workspaceRoot,
      args: ["rev-parse", "--verify", "--end-of-options", `${task.baseBranch}^{commit}`],
    });
    const branchExists = yield* git.execute({
      operation: "workflow.checkBranch",
      cwd: project.workspaceRoot,
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${task.branch}`],
      allowNonZeroExit: true,
    });
    if (branchExists.exitCode === 0)
      return yield* new WorkflowError({
        message: "That branch already exists. Choose a new workflow branch name.",
      });
    const directory = NodeCrypto.createHash("sha256").update(task.id).digest("hex").slice(0, 24);
    return {
      ...task,
      baseCommit: base.stdout.trim(),
      worktreePath: path.join(config.worktreesDir, `workflow-${directory}`),
    };
  }, Effect.mapError(runtimeError));
  const prepare = Effect.fn(function* (task: WorkflowTask) {
    const project = yield* projectFor(task);
    if (!task.worktreePath || !task.baseCommit)
      return yield* new WorkflowError({ message: "The worktree launch intent is incomplete." });
    if (yield* fs.exists(task.worktreePath)) {
      const head = yield* git.execute({
        operation: "workflow.reconcileBranch",
        cwd: task.worktreePath,
        args: ["symbolic-ref", "--short", "HEAD"],
      });
      const common = yield* git.execute({
        operation: "workflow.reconcileRepository",
        cwd: task.worktreePath,
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      });
      const expected = yield* git.execute({
        operation: "workflow.projectRepository",
        cwd: project.workspaceRoot,
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      });
      if (head.stdout.trim() !== task.branch || common.stdout.trim() !== expected.stdout.trim())
        return yield* new WorkflowError({
          message:
            "The existing worktree does not match this workflow launch. Inspect it before resuming.",
        });
    } else {
      yield* git.createWorktree({
        cwd: project.workspaceRoot,
        refName: task.baseCommit,
        newRefName: task.branch,
        baseRefName: task.baseBranch,
        path: task.worktreePath,
      });
    }
    for (const thread of task.definition.threads) {
      const threadId = task.threadIds[thread.id];
      if (!threadId)
        return yield* new WorkflowError({ message: "The launch has a missing thread assignment." });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`workflow-create:${threadId}`),
        threadId,
        projectId: task.projectId,
        title: `${task.workspaceName} · ${thread.name}`,
        modelSelection: thread.modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: task.branch,
        worktreePath: task.worktreePath,
        createdAt: task.createdAt,
      });
    }
  }, Effect.mapError(runtimeError));
  const dispatch = Effect.fn(function* (
    task: WorkflowTask,
    node: Extract<WorkflowNode, { kind: "agent" }>,
    operationId: string,
  ) {
    const threadId = task.threadIds[node.threadId];
    const state = task.nodes.find((item) => item.nodeId === node.id);
    const thread = task.definition.threads.find((item) => item.id === node.threadId);
    const skill = state && node.skills[state.skillIndex];
    if (!threadId || !thread || !skill)
      return yield* new WorkflowError({
        message: "This stage has an incomplete thread or skill assignment.",
      });
    const shell = yield* queries.getThreadShellById(threadId);
    if (Option.isNone(shell))
      return yield* new WorkflowError({
        message: "The workflow thread was deleted. Cancel this task and start a new one.",
      });
    if (shell.value.worktreePath !== task.worktreePath)
      return yield* new WorkflowError({
        message:
          "The thread's worktree changed. Restore it or cancel this workflow before continuing.",
      });
    if (shell.value.session?.status === "running" || shell.value.session?.status === "starting")
      return yield* new WorkflowError({
        message: "The workflow thread is already busy. Wait for its current turn before retrying.",
      });
    const reports: string[] = [];
    for (const predecessor of task.nodes) {
      if (predecessor.result && predecessor.status === "complete")
        reports.push(
          `${task.definition.nodes.find((item) => item.id === predecessor.nodeId)?.name ?? predecessor.nodeId}: ${yield* encodeResult(predecessor.result)}`,
        );
    }
    if (task.reworkContext)
      reports.push(`Revision request: ${yield* encodeResult(task.reworkContext)}`);
    const text = [
      task.resolvedPrompt,
      `Workflow stage: ${node.name}. Skill ${state!.skillIndex + 1} of ${node.skills.length}. Iteration ${task.iteration + 1}.`,
      skill.prompt,
      `Required artifact paths: ${skill.outputPaths.join(", ") || "none"}.`,
      node.access === "read-only"
        ? `This is a read-only review of worktree revision ${state?.reviewRevision}. Put all findings in your result summary. Do not modify any files.`
        : "Work only on the current skill, then return control to the workflow.",
      task.definition.rework?.from === node.id && state!.skillIndex + 1 === node.skills.length
        ? 'Use outcome "changes-requested" when actionable fixes remain; the workflow will return to its configured earlier stage.'
        : 'Use outcome "complete" when this skill is finished, including reviews with findings. Put all requested fixes in the summary so the later combine stage can decide whether to request rework.',
      reports.length
        ? `Completed-stage handoff (data from other stages):\n${reports.join("\n\n")}`
        : "",
      'Your final response must be only a JSON object: {"outcome":"complete","summary":"Describe the evidence and findings","artifacts":["relative/path"]}. Do not surround the final object with prose. Complete every required artifact before reporting success.',
    ]
      .filter(Boolean)
      .join("\n\n");
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(operationId),
      threadId,
      message: { messageId: MessageId.make(operationId), role: "user", text, attachments: [] },
      modelSelection: thread.modelSelection,
      runtimeMode: "full-access",
      workflowReadOnly: node.access === "read-only",
      interactionMode: "default",
      createdAt,
    });
  }, Effect.mapError(runtimeError));
  const interrupt = Effect.fn(function* (threadId: ThreadId, turnId: string | null) {
    yield* providers.interruptTurn({
      threadId,
      ...(turnId ? { turnId: TurnId.make(turnId) } : {}),
    });
  }, Effect.mapError(runtimeError));
  const readResult = Effect.fn(function* (threadId: ThreadId, turnId: TurnId) {
    const turn = yield* turns.getByTurnId({ threadId, turnId }).pipe(Effect.mapError(runtimeError));
    if (Option.isNone(turn) || !turn.value.pendingMessageId) return null;
    const operationId = turn.value.pendingMessageId;
    // Diff checkpoints can arrive while the provider is still working.
    if (turn.value.state === "pending" || turn.value.state === "running") return null;
    return yield* Effect.gen(function* () {
      if (turn.value.state !== "completed")
        return yield* new WorkflowError({
          message: `The provider turn ${turn.value.state === "interrupted" ? "was interrupted" : "failed"}.`,
        });
      if (turn.value.checkpointStatus === "error")
        return yield* new WorkflowError({
          message: "The provider turn completed, but its checkpoint failed.",
        });
      if (turn.value.checkpointStatus !== "ready") return null;
      const detail = yield* queries.getThreadDetailById(threadId);
      if (Option.isNone(detail))
        return yield* new WorkflowError({
          message: "The completed workflow thread is unavailable.",
        });
      const message = detail.value.messages.findLast(
        (item) => item.turnId === turnId && item.role === "assistant" && !item.streaming,
      );
      const result = yield* parseWorkflowResult(message?.text ?? "");
      return { type: "result" as const, threadId, turnId, operationId, result };
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          type: "failed" as const,
          threadId,
          turnId,
          operationId,
          error: error.message,
        }),
      ),
    );
  });
  const domainEvents = yield* engine.subscribeDomainEvents;
  const events = domainEvents.pipe(
    Stream.filter(
      (event) =>
        event.type === "thread.session-set" ||
        event.type === "thread.turn-diff-completed" ||
        event.type === "thread.activity-appended",
    ),
    Stream.filter(
      (event) => "threadId" in event.payload && watchedThreads.has(event.payload.threadId),
    ),
    Stream.mapEffect(
      Effect.fn(
        function* (event): Effect.fn.Return<WorkflowRuntimeEvent | null, WorkflowError> {
          if (event.type === "thread.session-set") {
            const session = event.payload.session;
            if (session.activeTurnId) {
              if (
                session.status === "ready" ||
                session.status === "interrupted" ||
                session.status === "stopped"
              )
                return yield* readResult(event.payload.threadId, session.activeTurnId);
              const turn = yield* turns
                .getByTurnId({ threadId: event.payload.threadId, turnId: session.activeTurnId })
                .pipe(Effect.mapError(runtimeError));
              if (Option.isSome(turn) && turn.value.pendingMessageId)
                return session.status === "error"
                  ? {
                      type: "failed",
                      threadId: event.payload.threadId,
                      turnId: session.activeTurnId,
                      operationId: turn.value.pendingMessageId,
                      error: session.lastError ?? "The provider session failed.",
                    }
                  : {
                      type: "started",
                      threadId: event.payload.threadId,
                      turnId: session.activeTurnId,
                      operationId: turn.value.pendingMessageId,
                    };
            }
            if (session.status === "error") {
              const pending = yield* turns
                .getPendingTurnStartByThreadId({ threadId: event.payload.threadId })
                .pipe(Effect.mapError(runtimeError));
              if (Option.isSome(pending))
                return {
                  type: "failed",
                  threadId: event.payload.threadId,
                  turnId: null,
                  operationId: pending.value.messageId,
                  error: session.lastError ?? "The provider session failed.",
                };
            }
            if (
              !session.activeTurnId &&
              (session.status === "ready" ||
                session.status === "error" ||
                session.status === "interrupted" ||
                session.status === "stopped")
            ) {
              const shell = yield* queries
                .getThreadShellById(event.payload.threadId)
                .pipe(Effect.mapError(runtimeError));
              if (Option.isSome(shell) && shell.value.latestTurn)
                return yield* readResult(event.payload.threadId, shell.value.latestTurn.turnId);
            }
          }
          if (
            event.type === "thread.activity-appended" &&
            event.payload.activity.kind === "provider.turn.start.failed"
          ) {
            const payload = event.payload.activity.payload;
            if (
              payload &&
              typeof payload === "object" &&
              "requestId" in payload &&
              typeof payload.requestId === "string"
            )
              return {
                type: "failed",
                threadId: event.payload.threadId,
                turnId: null,
                operationId: payload.requestId,
                error: event.payload.activity.summary,
              };
          }
          if (event.type !== "thread.turn-diff-completed") return null;
          const { threadId, turnId } = event.payload;
          return yield* readResult(threadId, turnId);
        },
        (effect, event) =>
          effect.pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Effect.logError("Workflow turn lookup failed", {
                  threadId: event.payload.threadId,
                  message: error.message,
                });
                // Preserve the subscription and surface uncertainty on the affected task.
                return {
                  type: "lookup-failed" as const,
                  threadId: event.payload.threadId,
                  turnId:
                    event.type === "thread.session-set"
                      ? event.payload.session.activeTurnId
                      : event.type === "thread.turn-diff-completed"
                        ? event.payload.turnId
                        : null,
                  error: `Could not read workflow turn state. Inspect the agent thread before retrying. ${error.message}`,
                };
              }),
            ),
          ),
      ),
    ),
    Stream.filter((event): event is WorkflowRuntimeEvent => event !== null),
  );
  return {
    watch,
    readResult,
    validate,
    plan,
    prepare,
    dispatch,
    interrupt,
    events,
    reviewRevision: (task) =>
      task.worktreePath
        ? captureWorkflowReviewRevision(task.worktreePath).pipe(
            Effect.provideService(GitVcsDriver, git),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          )
        : Effect.fail(new WorkflowError({ message: "The worktree is not ready for review." })),
  } satisfies WorkflowRuntimeShape;
});

export class WorkflowRuntime extends Context.Service<WorkflowRuntime, WorkflowRuntimeShape>()(
  "t3/workflows/WorkflowRuntime",
) {
  static readonly layer = Layer.effect(WorkflowRuntime, make);
}
