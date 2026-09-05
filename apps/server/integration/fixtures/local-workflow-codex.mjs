#!/usr/bin/env node
// Deterministic, offline Codex-protocol fixture for the desktop workflow journey.
// It is never selected by the application unless explicitly configured as a provider binary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeReadline from "node:readline";
import * as NodeChildProcess from "node:child_process";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.129.0-local-fixture\n");
  process.exit(0);
}
const root = process.env.ORCHESTRATOR_FIXTURE_ROOT;
if (!root || !NodeFS.existsSync(NodePath.join(root, ".fixture-owner")))
  throw new Error("Set ORCHESTRATOR_FIXTURE_ROOT to an explicitly prepared local test directory.");
const stateDir = NodePath.join(root, "provider-state");
NodeFS.mkdirSync(stateDir, { recursive: true });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
const log = (method, params) =>
  NodeFS.appendFileSync(
    NodePath.join(root, "provider-wire.ndjson"),
    JSON.stringify({ method, params }) + "\n",
  );
const threads = new Map();
const gates = new Map();
const threadPath = (id) =>
  NodePath.join(stateDir, NodeCrypto.createHash("sha256").update(id).digest("hex") + ".json");
const load = (id) => threads.get(id) ?? JSON.parse(NodeFS.readFileSync(threadPath(id), "utf8"));
const save = (thread) => {
  threads.set(thread.id, thread);
  NodeFS.writeFileSync(threadPath(thread.id), JSON.stringify(thread));
};
const inside = (cwd) => {
  const actual = NodeFS.realpathSync(cwd),
    base = NodeFS.realpathSync(root);
  if (
    !actual.startsWith(base + NodePath.sep) ||
    !NodeFS.existsSync(NodePath.join(actual, ".orchestrator-local-fixture"))
  )
    throw new Error("The local workflow fixture only operates in its marked test worktrees.");
  return actual;
};
const openResponse = (thread, params) => ({
  thread,
  cwd: thread.cwd,
  model: params.model ?? "local-workflow",
  modelProvider: "local-fixture",
  approvalPolicy: params.approvalPolicy ?? "never",
  approvalsReviewer: "user",
  sandbox: { type: params.sandbox === "read-only" ? "readOnly" : "dangerFullAccess" },
});
const complete = (thread, turn, text, failed = false) => {
  if (turn.status !== "inProgress") return;
  const item = { type: "agentMessage", id: NodeCrypto.randomUUID(), text, phase: "final_answer" };
  notify("item/started", {
    threadId: thread.id,
    turnId: turn.id,
    item: { ...item, text: "" },
    startedAtMs: Date.now(),
  });
  notify("item/completed", {
    threadId: thread.id,
    turnId: turn.id,
    item,
    completedAtMs: Date.now(),
  });
  turn.items = [item];
  turn.status = failed ? "failed" : "completed";
  turn.completedAt = Math.floor(Date.now() / 1000);
  thread.status = { type: "idle" };
  save(thread);
  notify("turn/completed", { threadId: thread.id, turn });
};
const runSkill = (thread, turn, params) => {
  try {
    const cwd = inside(thread.cwd);
    const prompt = params.input
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const stage = /Workflow stage: (.+?)\. Skill/.exec(prompt)?.[1] ?? "unknown";
    const resultPaths = /Required artifact paths: ([^\n]+)\./.exec(prompt)?.[1];
    const artifacts = resultPaths === "none" ? [] : (resultPaths ?? "").split(", ").filter(Boolean);
    const review = /review correctness|review edge cases/i.test(stage);
    if (review && params.sandboxPolicy?.type !== "readOnly")
      throw new Error("Reviewer was dispatched without the required read-only sandbox policy.");
    let summary = "";
    if (/plan/i.test(stage)) {
      summary = "Specified a local greeting function and Node test coverage.";
    } else if (/implement|validate/i.test(stage)) {
      NodeFS.writeFileSync(
        NodePath.join(cwd, "greeting.mjs"),
        'export const greet = (name = "world") => `Hello, ${name}!`;\n',
      );
      NodeFS.writeFileSync(
        NodePath.join(cwd, "greeting.test.mjs"),
        'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {greet} from "./greeting.mjs";\ntest("greets a name",()=>assert.equal(greet("Ada"),"Hello, Ada!"));\ntest("uses a default",()=>assert.equal(greet(),"Hello, world!"));\n',
      );
      const tests = NodeChildProcess.spawnSync(process.execPath, ["--test", "greeting.test.mjs"], {
        cwd,
        encoding: "utf8",
      });
      if (tests.status !== 0) throw new Error(tests.stdout + tests.stderr);
      summary = "Implemented greeting.mjs. Both local Node tests pass.\n" + tests.stdout;
    } else if (review) {
      const code = NodeFS.readFileSync(NodePath.join(cwd, "greeting.mjs"), "utf8");
      if (!code.includes("Hello,")) throw new Error("Missing greeting implementation.");
      summary = `${stage}: inspected the implementation and tests without changing files. No blocking findings.`;
    } else {
      summary =
        "Combined both independent local review reports. No blocking findings; the local workflow is complete.";
    }
    if (!review)
      for (const artifact of artifacts) {
        if (!artifact || artifact.includes("..") || NodePath.isAbsolute(artifact))
          throw new Error("Invalid fixture artifact path");
        NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, artifact)), { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(cwd, artifact),
          `# ${stage}\n\n${summary}\n\nTask: Create a local greeting utility.\nAcceptance: named and default greetings pass local tests.\n`,
        );
      }
    const wantsRework =
      /combine/i.test(stage) &&
      /Iteration 1\./.test(prompt) &&
      NodeFS.existsSync(NodePath.join(root, "request-rework"));
    const output = JSON.stringify({
      outcome: wantsRework ? "changes-requested" : "complete",
      summary: wantsRework
        ? "Recheck the default greeting and rerun local tests before another review."
        : summary,
      artifacts,
    });
    if (review && process.env.ORCHESTRATOR_FIXTURE_REVIEW_GATES === "1") {
      const key = /edge cases/i.test(stage) ? "review-b" : "review-a";
      const release = NodePath.join(root, key + ".release");
      NodeFS.writeFileSync(
        NodePath.join(root, key + ".waiting"),
        JSON.stringify({ threadId: thread.id, turnId: turn.id }),
      );
      if (NodeFS.existsSync(release)) {
        complete(thread, turn, output);
        return;
      }
      const watcher = NodeFS.watch(root, () => {
        if (NodeFS.existsSync(release)) {
          watcher.close();
          gates.delete(turn.id);
          complete(thread, turn, output);
        }
      });
      gates.set(turn.id, watcher);
      return;
    }
    complete(thread, turn, output);
  } catch (error) {
    complete(
      thread,
      turn,
      JSON.stringify({ outcome: "complete", summary: String(error), artifacts: [] }),
      true,
    );
  }
};
const handle = (request) => {
  const { id, method, params = {} } = request;
  if (id === undefined) return;
  log(method, params);
  let result;
  if (method === "initialize")
    result = {
      userAgent: "local-fixture/0.129.0",
      codexHome: stateDir,
      platformFamily: "unix",
      platformOs: "macos",
    };
  else if (method === "account/read") result = { account: null, requiresOpenaiAuth: false };
  else if (method === "model/list")
    result = {
      data: [
        {
          id: "local-workflow",
          model: "local-workflow",
          displayName: "Local workflow fixture",
          description: "Offline deterministic workflow verification",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [],
        },
      ],
      nextCursor: null,
    };
  else if (method === "skills/list") result = { data: [] };
  else if (method === "thread/start" || method === "thread/resume") {
    const cwd = inside(params.cwd);
    const thread =
      method === "thread/resume"
        ? load(params.threadId)
        : {
            id: NodeCrypto.randomUUID(),
            sessionId: NodeCrypto.randomUUID(),
            cliVersion: "0.129.0",
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            cwd,
            ephemeral: false,
            modelProvider: "local-fixture",
            preview: "Local workflow",
            source: "appServer",
            status: { type: "idle" },
            turns: [],
          };
    save(thread);
    result = openResponse(thread, params);
  } else if (method === "thread/read") result = { thread: load(params.threadId) };
  else if (method === "turn/start") {
    const thread = load(params.threadId),
      turn = {
        id: NodeCrypto.randomUUID(),
        items: [],
        status: "inProgress",
        startedAt: Math.floor(Date.now() / 1000),
      };
    thread.turns.push(turn);
    thread.status = { type: "active", activeFlags: [] };
    save(thread);
    send({ id, result: { turn } });
    notify("turn/started", { threadId: thread.id, turn });
    setImmediate(() => runSkill(thread, turn, params));
    return;
  } else if (method === "turn/interrupt") {
    const thread = load(params.threadId),
      turn = thread.turns.find((item) => item.id === params.turnId) ?? thread.turns.at(-1);
    if (turn) {
      gates.get(turn.id)?.close();
      gates.delete(turn.id);
      turn.status = "interrupted";
      save(thread);
      notify("turn/completed", { threadId: thread.id, turn });
    }
    result = {};
  } else if (method === "thread/name/set" || method === "thread/unsubscribe") result = {};
  else {
    send({ id, error: { code: -32601, message: `Local fixture does not implement ${method}` } });
    return;
  }
  send({ id, result });
};
NodeReadline.createInterface({ input: process.stdin })
  .on("line", (line) => {
    try {
      const request = JSON.parse(line);
      try {
        handle(request);
      } catch (error) {
        send({ id: request.id, error: { code: -32603, message: String(error) } });
      }
    } catch (error) {
      process.stderr.write(String(error) + "\n");
    }
  })
  .on("close", () => {
    for (const watcher of gates.values()) watcher.close();
  });
