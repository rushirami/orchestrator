// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-env-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
describe("loadRepoEnv", () => {
  it("uses process values ahead of local and root files", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_PORT=3000\nT3CODE_LOG_LEVEL=Info\n",
    );
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "T3CODE_PORT=4000\n");
    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_PORT).toBe("4000");
    expect(loadRepoEnv({ baseEnv: { T3CODE_PORT: "5000" }, repoRoot })).toMatchObject({
      T3CODE_PORT: "5000",
      T3CODE_LOG_LEVEL: "Info",
    });
  });
});
