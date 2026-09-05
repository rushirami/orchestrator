import * as NodeCrypto from "node:crypto";
import { WorkflowError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

/** Bind reviews to HEAD, tracked changes, and nonignored new files without creating a commit. */
export const captureWorkflowReviewRevision = Effect.fn(
  function* (worktreePath: string) {
    const git = yield* GitVcsDriver;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const digest = NodeCrypto.createHash("sha256");
    for (const args of [
      ["rev-parse", "HEAD"],
      ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"],
    ]) {
      const result = yield* git.execute({
        operation: "workflow.reviewRevision",
        cwd: worktreePath,
        args,
      });
      if (result.stdoutTruncated)
        return yield* new WorkflowError({
          message: "The worktree diff is too large to capture a reliable review revision.",
        });
      digest.update(result.stdout).update("\0");
    }
    const files = yield* git.execute({
      operation: "workflow.reviewFiles",
      cwd: worktreePath,
      args: ["ls-files", "--others", "--exclude-standard", "-z"],
    });
    if (files.stdoutTruncated)
      return yield* new WorkflowError({
        message: "The worktree file list is too large to capture a reliable review revision.",
      });
    for (const file of files.stdout.split("\0").filter(Boolean).sort()) {
      const fullPath = path.join(worktreePath, file);
      const link = yield* fs.readLink(fullPath).pipe(Effect.result);
      const content = link._tag === "Success" ? link.success : yield* fs.readFile(fullPath);
      digest
        .update(file)
        .update("\0")
        .update(NodeCrypto.createHash("sha256").update(content).digest());
    }
    return digest.digest("hex");
  },
  Effect.mapError((error) => new WorkflowError({ message: error.message })),
);
