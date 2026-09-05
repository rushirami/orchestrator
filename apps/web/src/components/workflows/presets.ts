import type { ModelSelection, WorkflowDefinition, WorkflowNode } from "@t3tools/contracts";
import { arrangeWorkflow } from "./WorkflowGraph";

export function createLocalWorkflow(modelSelection: ModelSelection): WorkflowDefinition {
  const agent = (
    id: string,
    name: string,
    threadId: string,
    prompt: string,
    outputPaths: string[],
    access: "write" | "read-only" = "write",
  ): WorkflowNode => ({
    id,
    name,
    kind: "agent",
    threadId,
    access,
    position: { x: 0, y: 0 },
    skills: [{ id: `${id}-skill`, prompt, outputPaths }],
  });
  return arrangeWorkflow({
    format: 1,
    name: "Local feature delivery",
    prompt:
      "Plan and implement {{ TASK }}. Keep all artifacts and actions local to this worktree. Do not create tickets, pull requests, or push to a remote.",
    defaults: { baseBranch: "main", branchPrefix: "feat/" },
    threads: ["Builder", "Reviewer A", "Reviewer B"].map((name, index) => ({
      id: `thread-${index}`,
      name,
      modelSelection,
    })),
    nodes: [
      agent(
        "plan",
        "Plan specification",
        "thread-0",
        "Inspect the task and repository. Write spec.md with scope, acceptance criteria, and a validation plan. Do not implement yet.",
        ["spec.md"],
      ),
      {
        id: "approval",
        name: "Approve specification",
        kind: "approval",
        artifactPath: "spec.md",
        revisionTarget: "plan",
        position: { x: 0, y: 0 },
      },
      agent(
        "build",
        "Implement & validate",
        "thread-0",
        "Implement the approved spec. Run focused local tests. Write validation.md describing the checks and results. Keep changes local.",
        ["validation.md"],
      ),
      agent(
        "review-a",
        "Review correctness",
        "thread-1",
        "Review the changes against spec.md for correctness. Inspect files without modifying them. Return findings in the structured result summary.",
        [],
        "read-only",
      ),
      agent(
        "review-b",
        "Review edge cases",
        "thread-2",
        "Independently review the changes and validation evidence for edge cases. Inspect files without modifying them. Return findings in the structured result summary.",
        [],
        "read-only",
      ),
      agent(
        "combine",
        "Combine findings",
        "thread-0",
        "Read both review reports from the handoff. Write reviews.md. Return changes-requested if actionable fixes remain; otherwise return complete. Do not push or open a PR.",
        ["reviews.md"],
      ),
    ],
    edges: [
      { from: "plan", to: "approval" },
      { from: "approval", to: "build" },
      { from: "build", to: "review-a" },
      { from: "build", to: "review-b" },
      { from: "review-a", to: "combine" },
      { from: "review-b", to: "combine" },
    ],
    rework: { from: "combine", to: "build", maxIterations: 3 },
  });
}
