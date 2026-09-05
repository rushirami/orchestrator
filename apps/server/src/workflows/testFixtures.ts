import { WorkflowTask, WorkflowTemplate } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeTemplate = Schema.decodeUnknownSync(WorkflowTemplate);
const decodeTask = Schema.decodeUnknownSync(WorkflowTask);

export function templateFixture(projectId = "project-a", id = "workflow-a") {
  return decodeTemplate({
    id,
    projectId,
    revision: 1,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    definition: {
      format: 1,
      name: "Local delivery",
      prompt: "Build {{TASK}}",
      defaults: { baseBranch: "main", branchPrefix: "feat/" },
      rework: { from: "combine", to: "build", maxIterations: 3 },
      threads: ["builder", "review-a", "review-b"].map((id) => ({
        id,
        name: id,
        modelSelection: { instanceId: "codex", model: "default" },
      })),
      nodes: [
        {
          id: "plan",
          name: "Plan",
          kind: "agent",
          threadId: "builder",
          access: "write",
          position: { x: 0, y: 0 },
          skills: [{ id: "spec", prompt: "Write a spec", outputPaths: ["spec.md"] }],
        },
        {
          id: "approval",
          name: "Approve spec",
          kind: "approval",
          artifactPath: "spec.md",
          revisionTarget: "plan",
          position: { x: 0, y: 100 },
        },
        {
          id: "build",
          name: "Build",
          kind: "agent",
          threadId: "builder",
          access: "write",
          position: { x: 0, y: 200 },
          skills: [
            { id: "implement", prompt: "Implement the spec", outputPaths: ["result.txt"] },
            { id: "validate", prompt: "Validate the result", outputPaths: ["validation.md"] },
          ],
        },
        ...["review-a", "review-b"].map((id, i) => ({
          id,
          name: id,
          kind: "agent",
          threadId: id,
          access: "read-only",
          position: { x: i * 300, y: 300 },
          skills: [
            { id: "review", prompt: "Review the result without modifying files", outputPaths: [] },
          ],
        })),
        {
          id: "combine",
          name: "Combine findings",
          kind: "agent",
          threadId: "builder",
          access: "write",
          position: { x: 0, y: 400 },
          skills: [{ id: "combine", prompt: "Combine both reviews", outputPaths: ["reviews.md"] }],
        },
      ],
      edges: [
        { from: "plan", to: "approval" },
        { from: "approval", to: "build" },
        { from: "build", to: "review-a" },
        { from: "build", to: "review-b" },
        { from: "review-a", to: "combine" },
        { from: "review-b", to: "combine" },
      ],
    },
  });
}

export function taskFixture() {
  const template = templateFixture();
  return decodeTask({
    id: "task-a",
    projectId: template.projectId,
    templateId: template.id,
    definition: template.definition,
    variables: { TASK: "a local feature" },
    resolvedPrompt: "Build a local feature",
    workspaceName: "Local feature",
    branch: "feat/local",
    baseBranch: "main",
    baseCommit: "abc123",
    worktreePath: "/tmp/local-feature",
    threadIds: {},
    status: "running",
    iteration: 0,
    revision: 1,
    error: null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    nodes: template.definition.nodes.map((node) => ({
      nodeId: node.id,
      iteration: 0,
      attempt: 0,
      skillIndex: 0,
      status: "pending",
      operationId: null,
      turnId: null,
      result: null,
      error: null,
      artifactRevision: null,
    })),
  });
}
