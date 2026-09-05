import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { captureWorkflowReviewRevision } from "./reviewRevision.ts";

const layer = Git.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "workflow-revision-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.effect("binds reviews to committed, edited, untracked, and symlink contents", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const git = yield* Git.GitVcsDriver;
    const cwd = yield* fs.makeTempDirectoryScoped();
    const command = (args: string[]) => git.execute({ operation: "workflow.fixture", cwd, args });
    yield* command(["init", "-b", "main"]);
    yield* fs.writeFileString(`${cwd}/code.txt`, "first");
    yield* command(["add", "."]);
    yield* command([
      "-c",
      "user.name=Workflow Test",
      "-c",
      "user.email=workflow@localhost",
      "commit",
      "-m",
      "fixture",
    ]);
    const original = yield* captureWorkflowReviewRevision(cwd);
    assert.equal(yield* captureWorkflowReviewRevision(cwd), original);
    yield* fs.writeFileString(`${cwd}/code.txt`, "edited");
    assert.notEqual(yield* captureWorkflowReviewRevision(cwd), original);
    yield* fs.writeFileString(`${cwd}/code.txt`, "first");
    assert.equal(yield* captureWorkflowReviewRevision(cwd), original);
    yield* fs.writeFileString(`${cwd}/new.txt`, "new file");
    const untracked = yield* captureWorkflowReviewRevision(cwd);
    assert.notEqual(untracked, original);
    yield* fs.symlink("code.txt", `${cwd}/link.txt`);
    assert.notEqual(yield* captureWorkflowReviewRevision(cwd), untracked);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
