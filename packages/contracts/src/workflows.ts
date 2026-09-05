import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const WorkflowId = TrimmedNonEmptyString.pipe(Schema.brand("WorkflowId"));
export type WorkflowId = typeof WorkflowId.Type;
export const WorkflowTaskId = TrimmedNonEmptyString.pipe(Schema.brand("WorkflowTaskId"));
export type WorkflowTaskId = typeof WorkflowTaskId.Type;

export const WorkflowSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  outputPaths: Schema.Array(TrimmedNonEmptyString),
});
export type WorkflowSkill = typeof WorkflowSkill.Type;

export const WorkflowThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
});
export type WorkflowThread = typeof WorkflowThread.Type;

const nodeFields = {
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  position: Schema.Struct({ x: Schema.Number, y: Schema.Number }),
};
export const WorkflowNode = Schema.Union([
  Schema.Struct({
    ...nodeFields,
    kind: Schema.Literal("agent"),
    threadId: TrimmedNonEmptyString,
    access: Schema.Literals(["read-only", "write"]),
    skills: Schema.Array(WorkflowSkill),
  }),
  Schema.Struct({
    ...nodeFields,
    kind: Schema.Literal("approval"),
    artifactPath: TrimmedNonEmptyString,
    revisionTarget: TrimmedNonEmptyString,
  }),
  Schema.Struct({ ...nodeFields, kind: Schema.Literal("join") }),
]);
export type WorkflowNode = typeof WorkflowNode.Type;

export const WorkflowDefinition = Schema.Struct({
  format: Schema.Literal(1),
  name: TrimmedNonEmptyString,
  prompt: Schema.String,
  nodes: Schema.Array(WorkflowNode),
  edges: Schema.Array(Schema.Struct({ from: TrimmedNonEmptyString, to: TrimmedNonEmptyString })),
  threads: Schema.Array(WorkflowThread),
  defaults: Schema.Struct({ baseBranch: TrimmedNonEmptyString, branchPrefix: Schema.String }),
  rework: Schema.NullOr(
    Schema.Struct({
      from: TrimmedNonEmptyString,
      to: TrimmedNonEmptyString,
      maxIterations: PositiveInt,
    }),
  ),
});
export type WorkflowDefinition = typeof WorkflowDefinition.Type;

export const WorkflowTemplate = Schema.Struct({
  id: WorkflowId,
  projectId: ProjectId,
  definition: WorkflowDefinition,
  revision: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTemplate = typeof WorkflowTemplate.Type;

/** A result is scoped to one skill attempt; a finished provider turn alone is not success. */
export const WorkflowStageResult = Schema.Struct({
  outcome: Schema.Literals(["complete", "changes-requested"]),
  summary: TrimmedNonEmptyString,
  artifacts: Schema.Array(TrimmedNonEmptyString),
});
export type WorkflowStageResult = typeof WorkflowStageResult.Type;

export const WorkflowNodeState = Schema.Struct({
  nodeId: TrimmedNonEmptyString,
  iteration: NonNegativeInt,
  attempt: NonNegativeInt,
  skillIndex: NonNegativeInt,
  status: Schema.Literals([
    "pending",
    "dispatching",
    "running",
    "awaiting-approval",
    "complete",
    "failed",
    "cancelled",
  ]),
  operationId: Schema.NullOr(TrimmedNonEmptyString),
  turnId: Schema.NullOr(TrimmedNonEmptyString),
  result: Schema.NullOr(WorkflowStageResult),
  error: Schema.NullOr(Schema.String),
  artifactRevision: Schema.NullOr(TrimmedNonEmptyString),
});
export type WorkflowNodeState = typeof WorkflowNodeState.Type;

export const WorkflowTask = Schema.Struct({
  id: WorkflowTaskId,
  projectId: ProjectId,
  templateId: WorkflowId,
  definition: WorkflowDefinition,
  variables: Schema.Record(Schema.String, Schema.String),
  resolvedPrompt: Schema.String,
  reworkContext: Schema.optional(WorkflowStageResult),
  workspaceName: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  baseCommit: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  threadIds: Schema.Record(Schema.String, ThreadId),
  status: Schema.Literals(["starting", "running", "paused", "cancelled", "complete"]),
  nodes: Schema.Array(WorkflowNodeState),
  iteration: NonNegativeInt,
  revision: PositiveInt,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTask = typeof WorkflowTask.Type;

/** Variables are replaced literally in a single pass, never evaluated as expressions. */
export function workflowVariables(prompt: string): string[] {
  return [
    ...new Set(
      Array.from(prompt.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g), (match) => match[1]!),
    ),
  ];
}

export function resolveWorkflowPrompt(
  prompt: string,
  values: Readonly<Record<string, string>>,
): string {
  const missing = workflowVariables(prompt).filter(
    (key) => !Object.hasOwn(values, key) || !values[key]?.trim(),
  );
  if (missing.length) throw new Error(`Provide values for: ${missing.join(", ")}`);
  const remainder = prompt.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, "");
  if (remainder.includes("{{") || remainder.includes("}}"))
    throw new Error("Use {{ VARIABLE_NAME }} for prompt variables.");
  return prompt.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_, key: string) => values[key]!,
  );
}
