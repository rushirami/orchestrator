import {
  WorkflowError,
  type WorkflowSaveTemplateInput,
  type WorkflowRemoveInput,
  type WorkflowSnapshot,
  resolveWorkflowPrompt,
  workflowVariables,
} from "@t3tools/contracts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { WorkflowStore } from "./WorkflowStore.ts";

const makeWorkflowService = Effect.gen(function* () {
  const store = yield* WorkflowStore;
  const refreshToken = yield* SubscriptionRef.make(0);
  const changed = SubscriptionRef.update(refreshToken, (token) => token + 1);
  const snapshot = Effect.fn("WorkflowService.snapshot")(
    function* () {
      const values = yield* store.list(undefined);
      const templates: WorkflowSnapshot["templates"][number][] = [];
      const tasks: WorkflowSnapshot["tasks"][number][] = [];
      for (const value of values) {
        if ("nodes" in value) tasks.push(value);
        else templates.push(value);
      }
      return { templates, tasks };
    },
    Effect.mapError((error) => new WorkflowError({ message: error.message })),
  );

  const saveTemplate = Effect.fn("WorkflowService.saveTemplate")(
    function* (input: WorkflowSaveTemplateInput) {
      const issues = validateWorkflowGraph(input.definition);
      if (issues.length)
        return yield* new WorkflowError({
          message: issues.map((issue) => issue.message).join("\n"),
        });
      yield* Effect.try({
        try: () =>
          resolveWorkflowPrompt(
            input.definition.prompt,
            Object.fromEntries(
              workflowVariables(input.definition.prompt).map((key) => [key, "preview"]),
            ),
          ),
        catch: (error) => new WorkflowError({ message: String(error) }),
      });
      const previous = yield* store.get(input.id);
      if (previous && "nodes" in previous)
        return yield* new WorkflowError({ message: "A task already uses this identifier." });
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* store.save(
        {
          id: input.id,
          projectId: input.projectId,
          definition: input.definition,
          revision: input.expectedRevision + 1,
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        },
        input.expectedRevision,
        "template.saved",
      );
      yield* changed;
      return yield* snapshot();
    },
    Effect.mapError((error) => new WorkflowError({ message: error.message })),
  );

  const remove = Effect.fn("WorkflowService.remove")(
    function* (input: WorkflowRemoveInput) {
      yield* store.remove(input.id, input.projectId, input.expectedRevision);
      yield* changed;
      return yield* snapshot();
    },
    Effect.mapError((error) => new WorkflowError({ message: error.message })),
  );

  return {
    snapshot,
    saveTemplate,
    remove,
    changed,
    changes: SubscriptionRef.changes(refreshToken),
  };
});

export class WorkflowService extends Context.Service<
  WorkflowService,
  Effect.Success<typeof makeWorkflowService>
>()("t3/workflows/WorkflowService") {
  static readonly layer = Layer.effect(WorkflowService, makeWorkflowService).pipe(
    Layer.provide(WorkflowStore.layer),
  );
}
