import * as NodeCrypto from "node:crypto";
import { WorkflowError, WorkflowStageResult } from "@t3tools/contracts";
import { isWorkflowArtifactPath } from "@t3tools/shared/workflowGraph";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkflowStageResult));

/** Accept an exact JSON result or one JSON fence, never a guessed outcome from prose. */
export const parseWorkflowResult = Effect.fn("parseWorkflowResult")(function* (text: string) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return yield* decodeResult(fenced?.[1] ?? trimmed).pipe(
    Effect.mapError(
      () =>
        new WorkflowError({
          message:
            "The agent did not return a valid stage result. Inspect its thread and retry the skill.",
        }),
    ),
  );
});

/** Resolve artifacts inside the worktree even when a path traverses a symlink. */
export const readWorkflowArtifact = Effect.fn("readWorkflowArtifact")(
  function* (worktreePath: string, artifactPath: string) {
    if (!isWorkflowArtifactPath(artifactPath))
      return yield* new WorkflowError({
        message: "Artifact paths must stay inside the task worktree.",
      });
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(worktreePath);
    const resolved = yield* fs.realPath(path.join(root, artifactPath));
    const relative = path.relative(root, resolved);
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    )
      return yield* new WorkflowError({
        message: "The artifact resolves outside the task worktree.",
      });
    const info = yield* fs.stat(resolved);
    if (info.type !== "File")
      return yield* new WorkflowError({ message: "The artifact must be a regular file." });
    if (info.size > 1_048_576n)
      return yield* new WorkflowError({
        message: "Workflow artifacts must be smaller than 1 MiB.",
      });
    const bytes = yield* fs.readFile(resolved);
    return {
      path: artifactPath,
      content: new TextDecoder().decode(bytes),
      revision: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    };
  },
  Effect.mapError((error) => new WorkflowError({ message: error.message })),
);

export const validateWorkflowArtifacts = Effect.fn("validateWorkflowArtifacts")(function* (
  worktreePath: string,
  requiredPaths: readonly string[],
  result: WorkflowStageResult,
) {
  for (const required of requiredPaths) {
    if (!result.artifacts.includes(required))
      return yield* new WorkflowError({
        message: `Missing required artifact in the stage result: ${required}`,
      });
  }
  for (const artifact of result.artifacts) yield* readWorkflowArtifact(worktreePath, artifact);
  return result;
});
