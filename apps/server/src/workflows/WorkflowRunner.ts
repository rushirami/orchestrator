import * as NodeCrypto from "node:crypto";
import {
  ThreadId,
  WorkflowError,
  WorkflowLaunchInput,
  resolveWorkflowPrompt,
  type WorkflowControlInput,
  type WorkflowTask,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import {
  readyWorkflowNodes,
  validateWorkflowGraph,
  workflowDescendants,
} from "@t3tools/shared/workflowGraph";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { forkParked } from "../serverActivation.ts";
import { readWorkflowArtifact, validateWorkflowArtifacts } from "./artifacts.ts";
import { decideWorkflow, type WorkflowAction } from "./decider.ts";
import { WorkflowRuntime, type WorkflowRuntimeEvent } from "./WorkflowRuntime.ts";
import { WorkflowService } from "./WorkflowService.ts";
import { WorkflowStore } from "./WorkflowStore.ts";

const encodeLaunch = Schema.encodeEffect(Schema.fromJsonString(WorkflowLaunchInput));
const fail = (error: { readonly message: string }) => new WorkflowError({ message: error.message });
export const makeWorkflowRunner = Effect.gen(function* () {
  const store = yield* WorkflowStore;
  const service = yield* WorkflowService;
  const runtime = yield* WorkflowRuntime;
  const mutex = yield* Semaphore.make(1);
  const ready = yield* Deferred.make<void>();
  const whenReady = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Deferred.await(ready).pipe(Effect.andThen(mutex.withPermit(effect)));
  const taskById = Effect.fn(function* (id: string) {
    const task = yield* store.get(id);
    if (!task || !("nodes" in task))
      return yield* new WorkflowError({ message: "This workflow task is no longer available." });
    return task;
  });
  const persist = Effect.fn(function* (task: WorkflowTask, event: string) {
    const updated = {
      ...task,
      revision: task.revision + 1,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* store.save(updated, task.revision, event);
    yield* service.changed;
    return updated;
  });
  const transition = Effect.fn(function* (task: WorkflowTask, action: WorkflowAction) {
    const next = yield* Effect.try({
      try: () => decideWorkflow(task, action),
      catch: (error) => new WorkflowError({ message: String(error) }),
    });
    return next === task ? task : yield* persist(next, `task.${action.type}`);
  });

  const schedule = Effect.fn(function* (initial: WorkflowTask) {
    let task = initial;
    while (task.status === "running") {
      const ready = readyWorkflowNodes(task.definition, task.nodes);
      const id = ready[0];
      if (!id) break;
      const node = task.definition.nodes.find((item) => item.id === id)!;
      const state = task.nodes.find((item) => item.nodeId === id)!;
      const incomingReviews = new Set<string>();
      const visitInputs = (nodeId: string) => {
        for (const edge of task.definition.edges.filter((edge) => edge.to === nodeId)) {
          const parent = task.definition.nodes.find((item) => item.id === edge.from);
          if (parent?.kind === "join") visitInputs(parent.id);
          else if (parent?.kind === "agent" && parent.access === "read-only")
            incomingReviews.add(parent.id);
        }
      };
      visitInputs(node.id);
      if (incomingReviews.size) {
        const captured = yield* runtime.reviewRevision(task).pipe(Effect.result);
        if (captured._tag === "Failure") {
          task = yield* persist(
            { ...task, status: "paused", error: captured.failure.message },
            "task.review-capture-failed",
          );
          break;
        }
        const currentRevision = captured.success;
        const stale = task.nodes.filter(
          (state) => incomingReviews.has(state.nodeId) && state.reviewRevision !== currentRevision,
        );
        if (stale.length) {
          const error =
            "The code changed after review. Retry the affected reviews before continuing.";
          const downstream = new Set(
            stale.flatMap((state) => [...workflowDescendants(task.definition, state.nodeId)]),
          );
          task = yield* persist(
            {
              ...task,
              status: "paused",
              error,
              nodes: task.nodes.map((state) =>
                stale.some((item) => item.nodeId === state.nodeId)
                  ? { ...state, status: "failed", error }
                  : downstream.has(state.nodeId) &&
                      task.definition.nodes.some(
                        (node) => node.id === state.nodeId && node.kind === "join",
                      )
                    ? { ...state, status: "pending" }
                    : state,
              ),
            },
            "task.reviews-invalidated",
          );
          break;
        }
      }
      const operationId = `workflow:${task.id}:${node.id}:${task.iteration}:${state.attempt}:${state.skillIndex}`;
      const started = yield* Effect.gen(function* () {
        const artifact =
          node.kind === "approval" && task.worktreePath
            ? yield* readWorkflowArtifact(task.worktreePath, node.artifactPath)
            : undefined;
        const reviewRevision =
          node.kind === "agent" && node.access === "read-only"
            ? yield* runtime.reviewRevision(task)
            : undefined;
        return yield* transition(
          {
            ...task,
            nodes: task.nodes.map((state) =>
              state.nodeId === node.id && reviewRevision ? { ...state, reviewRevision } : state,
            ),
          },
          {
            type: "start",
            nodeId: node.id,
            operationId,
            ...(artifact ? { artifactRevision: artifact.revision } : {}),
          },
        );
      }).pipe(Effect.result);
      if (started._tag === "Failure") {
        task = yield* persist(
          { ...task, status: "paused", error: started.failure.message },
          "task.scheduling-failed",
        );
        break;
      }
      task = started.success;
      if (node.kind === "agent") {
        const sent = yield* runtime.dispatch(task, node, operationId).pipe(Effect.result);
        if (sent._tag === "Failure")
          task = yield* transition(task, {
            type: "failed",
            nodeId: node.id,
            operationId,
            error: sent.failure.message,
          });
      }
    }
    return task;
  });

  const prepare = Effect.fn(function* (task: WorkflowTask) {
    yield* runtime.watch(task);
    const prepared = yield* runtime.prepare(task).pipe(Effect.result);
    if (prepared._tag === "Failure")
      return yield* persist(
        { ...task, status: "paused", error: prepared.failure.message },
        "task.preparation-failed",
      );
    return yield* schedule(
      yield* persist({ ...task, status: "running", error: null }, "task.prepared"),
    );
  });

  const launch = Effect.fn(
    function* (input: WorkflowLaunchInput) {
      const fingerprint = NodeCrypto.createHash("sha256")
        .update(yield* encodeLaunch(input))
        .digest("hex");
      const command = { id: `launch:${input.taskId}`, fingerprint };
      const prior = yield* store.replay(command);
      if (prior.matched) {
        if (!prior.value || !("nodes" in prior.value))
          return yield* new WorkflowError({
            message: "This launch was already completed and dismissed. Start a new task.",
          });
        return prior.value;
      }
      const template = yield* store.get(input.templateId);
      if (!template || "nodes" in template || template.projectId !== input.projectId)
        return yield* new WorkflowError({
          message: "The selected workflow template is unavailable in this project.",
        });
      if (template.revision !== input.templateRevision)
        return yield* new WorkflowError({
          message:
            "The template changed while this launch form was open. Reopen it to use the saved settings.",
        });
      const definition = { ...template.definition, threads: input.threads };
      const issues = validateWorkflowGraph(definition);
      if (issues.length)
        return yield* new WorkflowError({
          message: issues.map((issue) => issue.message).join("\n"),
        });
      yield* runtime.validate(definition);
      const prompt = yield* Effect.try({
        try: () => resolveWorkflowPrompt(definition.prompt, input.variables),
        catch: (error) => new WorkflowError({ message: String(error) }),
      });
      const now = DateTime.formatIso(yield* DateTime.now);
      const task = yield* runtime.plan({
        id: input.taskId,
        projectId: input.projectId,
        templateId: input.templateId,
        definition,
        variables: input.variables,
        resolvedPrompt: prompt,
        workspaceName: input.workspaceName,
        branch: input.branch,
        baseBranch: input.baseBranch,
        baseCommit: null,
        worktreePath: null,
        threadIds: Object.fromEntries(
          definition.threads.map((thread) => [
            thread.id,
            ThreadId.make(`workflow:${input.taskId}:${thread.id}`),
          ]),
        ),
        status: "starting",
        nodes: definition.nodes.map((node) => ({
          nodeId: node.id,
          iteration: 0,
          attempt: 0,
          skillIndex: 0,
          status: "pending",
          operationId: null,
          turnId: null,
          result: null,
          error: null,
          artifactRevision: null,
        })),
        iteration: 0,
        revision: 1,
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      yield* store.save(task, 0, "task.launch-requested", command);
      yield* service.changed;
      return yield* prepare(task);
    },
    whenReady,
    Effect.mapError(fail),
  );

  const control = Effect.fn(
    function* (input: WorkflowControlInput) {
      let task = yield* taskById(input.taskId);
      if (task.revision !== input.expectedRevision)
        return yield* new WorkflowError({
          message: "The task changed. Review its current state before applying this action.",
        });
      const node = task.definition.nodes.find((item) => item.id === input.nodeId);
      if (input.action === "approve" || input.action === "revise") {
        if (!node || node.kind !== "approval" || !task.worktreePath || !input.artifactRevision)
          return yield* new WorkflowError({
            message: "Open the approval artifact before making a decision.",
          });
        const artifact = yield* readWorkflowArtifact(task.worktreePath, node.artifactPath);
        if (artifact.revision !== input.artifactRevision)
          return yield* new WorkflowError({
            message:
              "The artifact changed after you opened it. Review the current contents before approving.",
          });
        task = yield* transition(
          {
            ...task,
            nodes: task.nodes.map((state) =>
              state.nodeId === node.id ? { ...state, artifactRevision: artifact.revision } : state,
            ),
          },
          { type: input.action, nodeId: node.id, artifactRevision: input.artifactRevision },
        );
      } else if (input.action === "retry") {
        if (!node)
          return yield* new WorkflowError({ message: "Select the failed stage to retry." });
        task = yield* transition(task, { type: "retry", nodeId: node.id });
      } else {
        task = yield* transition(task, { type: input.action });
      }
      if (input.action === "cancel") {
        for (const state of task.nodes) {
          const activeNode = task.definition.nodes.find((item) => item.id === state.nodeId);
          if (
            (state.status === "running" || state.status === "dispatching") &&
            activeNode?.kind === "agent"
          ) {
            const threadId = task.threadIds[activeNode.threadId];
            if (threadId) {
              const stopped = yield* runtime.interrupt(threadId, state.turnId).pipe(Effect.result);
              if (stopped._tag === "Failure")
                task = yield* persist(
                  {
                    ...task,
                    error: `Cancellation requested, but ${activeNode.name} has not stopped: ${stopped.failure.message}`,
                  },
                  "task.interrupt-failed",
                );
            }
          }
        }
        return task;
      }
      if (task.status === "running" && task.nodes.every((state) => state.status === "pending"))
        return yield* prepare(task);
      return yield* schedule(task);
    },
    whenReady,
    Effect.mapError(fail),
  );

  const handleEvent = Effect.fn(function* (event: WorkflowRuntimeEvent) {
    const values = yield* store.list(undefined);
    for (const value of values) {
      if (!("nodes" in value)) continue;
      const assignment = Object.entries(value.threadIds).find(
        ([, id]) => id === event.threadId,
      )?.[0];
      if (!assignment) continue;
      const node = value.definition.nodes.find(
        (node) =>
          node.kind === "agent" &&
          node.threadId === assignment &&
          value.nodes.some(
            (state) =>
              state.nodeId === node.id &&
              (state.status === "dispatching" || state.status === "running"),
          ),
      );
      if (!node || node.kind !== "agent") continue;
      const state = value.nodes.find((state) => state.nodeId === node.id)!;
      if (
        !state.operationId ||
        (state.turnId !== null && event.turnId !== null && state.turnId !== event.turnId)
      )
        continue;
      let task: WorkflowTask;
      if (event.type === "started")
        task = yield* transition(value, {
          type: "started",
          nodeId: node.id,
          operationId: state.operationId,
          turnId: event.turnId,
        });
      else if (event.type === "failed")
        task = yield* transition(value, {
          type: "failed",
          nodeId: node.id,
          operationId: state.operationId,
          error: event.error,
        });
      else {
        const validated = yield* Effect.gen(function* () {
          if (
            node.access === "read-only" &&
            state.reviewRevision !== (yield* runtime.reviewRevision(value))
          )
            return yield* new WorkflowError({
              message:
                "The worktree changed during review. Inspect the changes and retry this review against the current code.",
            });
          return yield* validateWorkflowArtifacts(
            value.worktreePath!,
            node.skills[state.skillIndex]!.outputPaths,
            event.result,
          );
        }).pipe(Effect.result);
        task =
          validated._tag === "Failure"
            ? yield* transition(value, {
                type: "failed",
                nodeId: node.id,
                operationId: state.operationId,
                error: validated.failure.message,
              })
            : yield* transition(value, {
                type: "result",
                nodeId: node.id,
                operationId: state.operationId,
                result: validated.success,
              }).pipe(
                Effect.catch((error) =>
                  transition(value, {
                    type: "failed",
                    nodeId: node.id,
                    operationId: state.operationId!,
                    error: error.message,
                  }),
                ),
              );
      }
      if (event.type === "started" && task.status === "cancelled")
        yield* runtime
          .interrupt(event.threadId, event.turnId)
          .pipe(
            Effect.catch((error) =>
              persist({ ...task, error: error.message }, "task.interrupt-failed"),
            ),
          );
      yield* schedule(task);
    }
  }, whenReady);

  const recover = Effect.gen(function* () {
    for (const task of yield* store.list(undefined)) {
      if (!("nodes" in task) || task.status === "complete") continue;
      yield* runtime.watch(task);
      const recovered = yield* transition(task, { type: "recovered" });
      if (recovered.status === "starting") yield* prepare(recovered);
      else yield* schedule(recovered);
    }
  }).pipe(mutex.withPermit);
  yield* forkParked(
    recover.pipe(
      Effect.ensuring(Deferred.succeed(ready, undefined)),
      Effect.catch((error) =>
        Effect.logError("Workflow recovery failed", { message: error.message }),
      ),
    ),
  );
  yield* forkParked(
    Stream.runForEach(runtime.events, (event) =>
      handleEvent(event).pipe(
        Effect.catch((error) =>
          Effect.logError("Workflow event handling failed", { message: error.message }),
        ),
      ),
    ),
  );

  const artifact = Effect.fn(function* (input: {
    taskId: string;
    nodeId: string;
    path?: string | undefined;
  }) {
    const task = yield* taskById(input.taskId);
    const node = task.definition.nodes.find((item) => item.id === input.nodeId);
    const state = task.nodes.find((item) => item.nodeId === input.nodeId);
    const artifactPath = node?.kind === "approval" ? node.artifactPath : input.path;
    if (
      !node ||
      !task.worktreePath ||
      !artifactPath ||
      (node.kind !== "approval" && !state?.result?.artifacts.includes(artifactPath))
    )
      return yield* new WorkflowError({ message: "This stage has no matching result artifact." });
    return yield* readWorkflowArtifact(task.worktreePath, artifactPath);
  }, Effect.mapError(fail));
  const runClientCommand = <A, E, R>(
    command: OrchestrationCommand,
    effect: Effect.Effect<A, E, R>,
  ) => {
    if (
      command.type !== "project.delete" &&
      command.type !== "thread.turn.start" &&
      command.type !== "thread.delete" &&
      command.type !== "thread.archive" &&
      command.type !== "thread.checkpoint.revert" &&
      command.type !== "thread.runtime-mode.set" &&
      command.type !== "thread.session.stop" &&
      !(
        command.type === "thread.meta.update" &&
        (command.branch !== undefined ||
          command.worktreePath !== undefined ||
          command.modelSelection !== undefined)
      )
    )
      return effect;
    return Effect.gen(function* () {
      const values = yield* store.list(undefined);
      for (const task of values) {
        if (!("nodes" in task)) continue;
        const unsettled = task.status !== "complete" && task.status !== "cancelled";
        const executing = task.nodes.some(
          (node) => node.status === "dispatching" || node.status === "running",
        );
        if (!unsettled && !executing) continue;
        if (command.type === "project.delete") {
          if (command.projectId === task.projectId)
            return yield* new WorkflowError({
              message: "Cancel active workflow tasks before removing their project.",
            });
        } else if (Object.values(task.threadIds).includes(command.threadId)) {
          if (command.type === "thread.turn.start" && task.status === "paused" && !executing)
            continue;
          return yield* new WorkflowError({
            message:
              "This thread belongs to an active workflow. Use the workflow controls to pause or cancel it first.",
          });
        }
      }
      const result = yield* effect;
      if (command.type === "project.delete") {
        for (const value of values)
          if (value.projectId === command.projectId)
            yield* store.remove(value.id, value.projectId, value.revision);
        yield* service.changed;
      }
      return result;
    }).pipe(whenReady);
  };
  return { launch, control, artifact, validate: runtime.validate, runClientCommand };
});

export class WorkflowRunner extends Context.Service<
  WorkflowRunner,
  Effect.Success<typeof makeWorkflowRunner>
>()("t3/workflows/WorkflowRunner") {
  static readonly layer = Layer.effect(WorkflowRunner, makeWorkflowRunner).pipe(
    Layer.provide(WorkflowStore.layer),
    Layer.provide(WorkflowRuntime.layer),
  );
}
