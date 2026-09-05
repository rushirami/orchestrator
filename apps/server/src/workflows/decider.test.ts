import { describe, expect, it } from "vite-plus/test";
import { decideWorkflow } from "./decider.ts";
import { taskFixture } from "./testFixtures.ts";
import type { WorkflowTask } from "@t3tools/contracts";

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
