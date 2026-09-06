import * as Schema from "effect/Schema";
import { WorkflowDefinition, WorkflowNodeState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  canReviewWorkflowApproval,
  readyWorkflowNodes,
  validateWorkflowGraph,
} from "./workflowGraph.ts";

const decodeState = Schema.decodeUnknownSync(WorkflowNodeState);
const decode = Schema.decodeUnknownSync(WorkflowDefinition);
function graph() {
  return decode({
    format: 1,
    name: "Build and review",
    prompt: "Build {{TASK}}",
    defaults: { baseBranch: "main", branchPrefix: "feat/" },
    rework: null,
    threads: ["builder", "claude", "codex"].map((id) => ({
      id,
      name: id,
      modelSelection: { instanceId: id === "builder" ? "codex" : id, model: "default" },
    })),
    nodes: [
      ...["build", "claude", "codex"].map((id) => ({
        id,
        name: id,
        position: { x: 0, y: 0 },
        kind: "agent",
        threadId: id === "build" ? "builder" : id,
        access: id === "build" ? "write" : "read-only",
        skills: [{ id: "work", prompt: "Do the work", outputPaths: ["report.md"] }],
      })),
      { id: "join", name: "Both reports", kind: "join", position: { x: 0, y: 1 } },
    ],
    edges: [
      { from: "build", to: "claude" },
      { from: "build", to: "codex" },
      { from: "claude", to: "join" },
      { from: "codex", to: "join" },
    ],
  });
}
function states(statuses: readonly string[]) {
  return ["build", "claude", "codex", "join"].map((nodeId, i) =>
    decodeState({
      nodeId,
      iteration: 0,
      attempt: 0,
      skillIndex: 0,
      status: statuses[i],
      operationId: null,
      turnId: null,
      result: null,
      error: null,
      artifactRevision: null,
    }),
  );
}
describe("workflow dependency graph", () => {
  it("accepts two read-only branches in different threads", () => {
    expect(validateWorkflowGraph(graph())).toEqual([]);
    expect(
      readyWorkflowNodes(graph(), states(["complete", "pending", "pending", "pending"])),
    ).toEqual(["claude", "codex"]);
  });
  it("does not release a join for failed, running, or cancelled branches", () => {
    for (const status of ["failed", "running", "cancelled"]) {
      expect(
        readyWorkflowNodes(graph(), states(["complete", "complete", status, "pending"])),
      ).toEqual([]);
    }
    expect(
      readyWorkflowNodes(graph(), states(["complete", "complete", "complete", "pending"])),
    ).toEqual(["join"]);
  });
  it("rejects parallel writers and sharing a conversation between concurrent nodes", () => {
    const base = graph();
    const changed = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.kind === "agent" && node.id === "codex"
          ? { ...node, threadId: "claude", access: "write" as const }
          : node,
      ),
    };
    expect(validateWorkflowGraph(changed).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Parallel stages need separate agent threads.",
        "Only read-only stages can run in parallel in one worktree.",
      ]),
    );
  });
  it("rejects cycles, duplicate connections, and dangling endpoints", () => {
    const base = graph();
    const issues = validateWorkflowGraph({
      ...base,
      edges: [
        ...base.edges,
        base.edges[0]!,
        { from: "join", to: "build" },
        { from: "missing", to: "join" },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("cycle"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("duplicate"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("missing"))).toBe(true);
  });
  it("rejects escaping output paths and invalid review rework", () => {
    const base = graph();
    const changed = {
      ...base,
      rework: { from: "build", to: "codex", maxIterations: 2 },
      nodes: base.nodes.map((node) =>
        node.kind === "agent"
          ? { ...node, skills: [{ id: "work", prompt: "Write", outputPaths: ["../outside.md"] }] }
          : node,
      ),
    };
    const issues = validateWorkflowGraph(changed);
    expect(issues.some((issue) => issue.message.includes("inside"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("earlier"))).toBe(true);
  });
});

describe("workflow approval availability", () => {
  const base = graph();
  const definition: WorkflowDefinition = {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "join"
        ? { ...node, kind: "approval", artifactPath: "report.md", revisionTarget: "build" }
        : node,
    ),
  };

  it.each(["running", "paused"] as const)(
    "allows ready pending and awaiting approvals in a %s task",
    (status) => {
      for (const nodeStatus of ["pending", "awaiting-approval"])
        expect(
          canReviewWorkflowApproval(
            { status, definition, nodes: states(["complete", "complete", "complete", nodeStatus]) },
            "join",
          ),
        ).toBe(true);
    },
  );

  it("requires every predecessor to complete before reviewing a pending approval", () => {
    for (const predecessor of ["pending", "running", "failed", "cancelled"])
      expect(
        canReviewWorkflowApproval(
          {
            status: "paused",
            definition,
            nodes: states(["complete", "complete", predecessor, "pending"]),
          },
          "join",
        ),
      ).toBe(false);
  });

  it("does not expose review for inactive tasks, finished approvals, or other stage kinds", () => {
    const nodes = states(["complete", "complete", "complete", "pending"]);
    for (const status of ["starting", "complete", "cancelled"] as const)
      expect(canReviewWorkflowApproval({ status, definition, nodes }, "join")).toBe(false);
    for (const status of ["dispatching", "running", "complete", "failed", "cancelled"])
      expect(
        canReviewWorkflowApproval(
          {
            status: "paused",
            definition,
            nodes: states(["complete", "complete", "complete", status]),
          },
          "join",
        ),
      ).toBe(false);
    expect(canReviewWorkflowApproval({ status: "paused", definition, nodes }, "build")).toBe(false);
    expect(canReviewWorkflowApproval({ status: "paused", definition, nodes }, "missing")).toBe(
      false,
    );
    expect(canReviewWorkflowApproval({ status: "paused", definition: base, nodes }, "join")).toBe(
      false,
    );
  });
});
