import { describe, expect, it } from "vite-plus/test";
import { decideWorkflow } from "./decider.ts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import { taskFixture } from "./testFixtures.ts";
import type { WorkflowTask } from "@t3tools/contracts";

const revisionContext = {
  outcome: "changes-requested" as const,
  summary: "spec.md lines 3-4: Keep this desktop-only.",
  artifacts: ["spec.md"],
};

function finish(task: WorkflowTask, nodeId: string, operationId = nodeId) {
  const started = decideWorkflow(task, { type: "start", nodeId, operationId });
  const node = task.definition.nodes.find((node) => node.id === nodeId);
  const index = task.nodes.find((state) => state.nodeId === nodeId)!.skillIndex;
  const artifacts = node?.kind === "agent" ? node.skills[index]!.outputPaths : [];
  return decideWorkflow(started, {
    type: "result",
    nodeId,
    operationId,
    result: { outcome: "complete", summary: "Finished", artifacts },
  });
}
function throughBuild() {
  let task = finish(taskFixture(), "plan");
  task = decideWorkflow(task, {
    type: "start",
    nodeId: "approval",
    operationId: "approve",
    artifactRevision: "spec-hash",
  });
  task = decideWorkflow(task, {
    type: "approve",
    nodeId: "approval",
    artifactRevision: "spec-hash",
  });
  task = finish(task, "build", "implement");
  return finish(task, "build", "validate");
}
describe("workflow transitions", () => {
  it("persists skill progress and requires revision-bound human approval", () => {
    const planned = finish(taskFixture(), "plan");
    expect(() =>
      decideWorkflow(planned, { type: "start", nodeId: "build", operationId: "build" }),
    ).toThrow("dependencies");
    const pending = decideWorkflow(planned, {
      type: "start",
      nodeId: "approval",
      operationId: "approval",
      artifactRevision: "spec-v1",
    });
    expect(() =>
      decideWorkflow(pending, { type: "approve", nodeId: "approval", artifactRevision: "spec-v2" }),
    ).toThrow("changed");
    const approved = decideWorkflow(pending, {
      type: "approve",
      nodeId: "approval",
      artifactRevision: "spec-v1",
    });
    const implemented = finish(approved, "build");
    expect(implemented.nodes.find((node) => node.nodeId === "build")).toMatchObject({
      status: "pending",
      skillIndex: 1,
    });
  });
  it("resumes a paused approval revision, resets downstream work, and clears addressed feedback", () => {
    let task = decideWorkflow(finish(taskFixture(), "plan"), {
      type: "start",
      nodeId: "approval",
      operationId: "approval",
      artifactRevision: "spec-v1",
    });
    task = decideWorkflow(task, { type: "pause" });
    expect(() =>
      decideWorkflow(task, {
        type: "revise",
        nodeId: "approval",
        artifactRevision: "spec-old",
        context: revisionContext,
      }),
    ).toThrow("changed");
    const revised = decideWorkflow(task, {
      type: "revise",
      nodeId: "approval",
      artifactRevision: "spec-v1",
      context: revisionContext,
    });
    expect(revised).toMatchObject({
      status: "running",
      iteration: 1,
      reworkContext: revisionContext,
      reworkTargetNodeId: "plan",
    });
    expect(revised.nodes.every((node) => node.status === "pending" && node.result === null)).toBe(
      true,
    );
    expect(revised.nodes.every((node) => node.artifactRevision === null)).toBe(true);
    const updated = finish(revised, "plan", "revision");
    expect(updated.reworkContext).toBeUndefined();
    expect(updated.reworkTargetNodeId).toBeUndefined();
    expect(updated.nodes.find((node) => node.nodeId === "approval")?.status).toBe("pending");
  });
  it("accepts a revision-bound decision on a paused pending approval without resuming other work", () => {
    const planned = finish(taskFixture(), "plan");
    const task: WorkflowTask = {
      ...planned,
      status: "paused",
      nodes: planned.nodes.map((node) =>
        node.nodeId === "approval" ? { ...node, artifactRevision: "spec-v1" } : node,
      ),
    };
    for (const type of ["approve", "revise"] as const)
      expect(() =>
        decideWorkflow(task, {
          type,
          nodeId: "approval",
          artifactRevision: "spec-old",
          context: revisionContext,
        }),
      ).toThrow("changed");
    const approved = decideWorkflow(task, {
      type: "approve",
      nodeId: "approval",
      artifactRevision: "spec-v1",
    });
    expect(approved.status).toBe("paused");
    expect(approved.nodes.find((node) => node.nodeId === "approval")?.status).toBe("complete");
    expect(approved.nodes.find((node) => node.nodeId === "build")?.status).toBe("pending");
    const revised = decideWorkflow(task, {
      type: "revise",
      nodeId: "approval",
      artifactRevision: "spec-v1",
      context: revisionContext,
    });
    expect(revised).toMatchObject({
      status: "running",
      iteration: 1,
      reworkTargetNodeId: "plan",
      reworkContext: revisionContext,
    });
    expect(revised.nodes.every((node) => node.status === "pending")).toBe(true);
  });
  it("rejects pending approval decisions before all stage dependencies complete", () => {
    const fixture = taskFixture();
    const task: WorkflowTask = {
      ...fixture,
      status: "paused",
      nodes: fixture.nodes.map((node) =>
        node.nodeId === "approval" ? { ...node, artifactRevision: "spec-v1" } : node,
      ),
    };
    for (const type of ["approve", "revise"] as const)
      expect(() =>
        decideWorkflow(task, {
          type,
          nodeId: "approval",
          artifactRevision: "spec-v1",
          context: revisionContext,
        }),
      ).toThrow("not ready for review");
  });
  it("retains feedback through all skills of the revision target and preserves upstream results", () => {
    let task = finish(finish(throughBuild(), "review-a"), "review-b");
    task = decideWorkflow(task, { type: "start", nodeId: "combine", operationId: "combine" });
    task = decideWorkflow(task, {
      type: "result",
      nodeId: "combine",
      operationId: "combine",
      result: { ...revisionContext, artifacts: ["reviews.md"] },
    });
    expect(task.nodes.find((node) => node.nodeId === "approval")?.status).toBe("complete");
    task = finish(task, "build", "implementation-revision");
    expect(task.reworkTargetNodeId).toBe("build");
    expect(task.reworkContext?.summary).toBe(revisionContext.summary);
    task = finish(task, "build", "validation-revision");
    expect(task.reworkContext).toBeUndefined();
  });
  it("runs reviews together, waits for both, and completes after combining", () => {
    let task = throughBuild();
    task = decideWorkflow(task, { type: "start", nodeId: "review-a", operationId: "a" });
    task = decideWorkflow(task, { type: "start", nodeId: "review-b", operationId: "b" });
    task = decideWorkflow(task, {
      type: "result",
      nodeId: "review-a",
      operationId: "a",
      result: { outcome: "complete", summary: "A", artifacts: [] },
    });
    expect(() =>
      decideWorkflow(task, { type: "start", nodeId: "combine", operationId: "c" }),
    ).toThrow("dependencies");
    task = decideWorkflow(task, {
      type: "result",
      nodeId: "review-b",
      operationId: "b",
      result: { outcome: "complete", summary: "B", artifacts: [] },
    });
    expect(finish(task, "combine").status).toBe("complete");
  });
  it("rework resets downstream results and ignores late old-attempt completions", () => {
    let task = finish(finish(throughBuild(), "review-a"), "review-b");
    task = decideWorkflow(task, { type: "start", nodeId: "combine", operationId: "combine-old" });
    task = decideWorkflow(task, {
      type: "started",
      nodeId: "combine",
      operationId: "combine-old",
      turnId: "turn-old",
    });
    task = decideWorkflow(task, {
      type: "result",
      nodeId: "combine",
      operationId: "combine-old",
      result: { outcome: "changes-requested", summary: "Fix findings", artifacts: ["reviews.md"] },
    });
    expect(task.iteration).toBe(1);
    expect(task.reworkContext?.summary).toBe("Fix findings");
    expect(task.nodes.find((node) => node.nodeId === "review-a")).toMatchObject({
      status: "pending",
      result: null,
      iteration: 1,
    });
    expect(
      decideWorkflow(task, {
        type: "result",
        nodeId: "combine",
        operationId: "combine-old",
        result: { outcome: "complete", summary: "Late", artifacts: [] },
      }),
    ).toBe(task);
  });
  it("preserves uncertain operations on restart and requires explicit retry", () => {
    const started = decideWorkflow(taskFixture(), {
      type: "start",
      nodeId: "plan",
      operationId: "op",
    });
    const recovered = decideWorkflow(started, { type: "recovered" });
    expect(recovered.status).toBe("paused");
    expect(() => decideWorkflow(recovered, { type: "resume" })).toThrow("Retry");
    const retried = decideWorkflow(recovered, { type: "retry", nodeId: "plan" });
    expect(retried.nodes[0]).toMatchObject({ attempt: 1, operationId: null });
    expect(decideWorkflow(retried, { type: "resume" }).status).toBe("running");
  });
  it("cancellation never schedules the next skill after an in-flight result", () => {
    const active = decideWorkflow(taskFixture(), {
      type: "start",
      nodeId: "plan",
      operationId: "plan",
    });
    const cancelled = decideWorkflow(active, { type: "cancel" });
    const result = decideWorkflow(cancelled, {
      type: "result",
      nodeId: "plan",
      operationId: "plan",
      result: { outcome: "complete", summary: "Finished", artifacts: ["spec.md"] },
    });
    expect(result.status).toBe("cancelled");
    expect(result.nodes.every((node) => node.status === "cancelled")).toBe(true);
  });
});

it.each(["dispatching", "running"] as const)(
  "rejects approval revision while the rework source is %s",
  (activeStatus) => {
    const fixture = taskFixture();
    const task: WorkflowTask = {
      ...fixture,
      definition: {
        ...fixture.definition,
        nodes: fixture.definition.nodes.filter((node) =>
          ["plan", "approval", "combine"].includes(node.id),
        ),
        edges: [
          { from: "plan", to: "approval" },
          { from: "plan", to: "combine" },
        ],
        rework: { from: "combine", to: "plan", maxIterations: 3 },
      },
      nodes: fixture.nodes.filter((node) => ["plan", "approval", "combine"].includes(node.nodeId)),
    };
    expect(validateWorkflowGraph(task.definition)).toEqual([]);
    let active = finish(task, "plan");
    active = decideWorkflow(active, {
      type: "start",
      nodeId: "approval",
      operationId: "approval",
      artifactRevision: "spec",
    });
    active = decideWorkflow(active, { type: "start", nodeId: "combine", operationId: "active" });
    if (activeStatus === "running")
      active = decideWorkflow(active, {
        type: "started",
        nodeId: "combine",
        operationId: "active",
        turnId: "live-turn",
      });
    expect(() =>
      decideWorkflow(active, {
        type: "revise",
        nodeId: "approval",
        artifactRevision: "spec",
        context: revisionContext,
      }),
    ).toThrow("Wait for active branches");
    expect(active.nodes.find((node) => node.nodeId === "combine")).toMatchObject({
      status: activeStatus,
      operationId: "active",
    });
    const settled = decideWorkflow(active, {
      type: "result",
      nodeId: "combine",
      operationId: "active",
      result: { outcome: "complete", summary: "Done", artifacts: ["reviews.md"] },
    });
    const revised = decideWorkflow(settled, {
      type: "revise",
      nodeId: "approval",
      artifactRevision: "spec",
      context: revisionContext,
    });
    expect(revised.iteration).toBe(1);
    expect(revised.nodes.every((node) => node.status === "pending")).toBe(true);
  },
);
