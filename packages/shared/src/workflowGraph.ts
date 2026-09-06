import type { WorkflowDefinition, WorkflowNodeState, WorkflowTask } from "@t3tools/contracts";

export type WorkflowIssue = { nodeId?: string; message: string };

/** Returns every descendant once, including when inspecting an invalid cyclic draft. */
export function workflowDescendants(definition: WorkflowDefinition, id: string): Set<string> {
  const visited = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    for (const edge of definition.edges) {
      if (edge.from !== current || visited.has(edge.to)) continue;
      visited.add(edge.to);
      pending.push(edge.to);
    }
  }
  return visited;
}

/** Validates dependencies, not canvas positions. Invalid drafts remain editable in the UI. */
export function validateWorkflowGraph(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const threads = new Set(definition.threads.map((thread) => thread.id));
  if (!nodes.size) issues.push({ message: "Add at least one stage." });
  if (nodes.size !== definition.nodes.length) issues.push({ message: "Stage IDs must be unique." });
  if (threads.size !== definition.threads.length)
    issues.push({ message: "Thread IDs must be unique." });
  const edgeKeys = new Set<string>();
  for (const edge of definition.edges) {
    const key = JSON.stringify([edge.from, edge.to]);
    if (edgeKeys.has(key))
      issues.push({ nodeId: edge.from, message: "Remove the duplicate connection." });
    edgeKeys.add(key);
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      issues.push({ message: "A connection references a missing stage." });
  }
  const roots = definition.nodes.filter(
    (node) => !definition.edges.some((edge) => edge.to === node.id),
  );
  if (roots.length !== 1)
    issues.push({ message: "Connect the workflow to exactly one starting stage." });
  const descendants = new Map(
    definition.nodes.map((node) => [node.id, workflowDescendants(definition, node.id)]),
  );
  const reachable = roots[0] ? descendants.get(roots[0].id)! : new Set<string>();
  for (const node of definition.nodes) {
    if (descendants.get(node.id)!.has(node.id))
      issues.push({
        nodeId: node.id,
        message: "Forward connections cannot form a cycle. Use a rework transition.",
      });
    if (roots[0] && node.id !== roots[0].id && !reachable.has(node.id))
      issues.push({ nodeId: node.id, message: "Connect this stage to the starting stage." });
    if (node.kind === "agent") {
      if (!threads.has(node.threadId))
        issues.push({ nodeId: node.id, message: "Choose an existing agent thread." });
      if (!node.skills.length)
        issues.push({ nodeId: node.id, message: "Add a skill to this agent stage." });
      if (new Set(node.skills.map((skill) => skill.id)).size !== node.skills.length)
        issues.push({ nodeId: node.id, message: "Skill IDs must be unique within a stage." });
      for (const skill of node.skills) {
        for (const path of skill.outputPaths) {
          if (!isWorkflowArtifactPath(path))
            issues.push({
              nodeId: node.id,
              message: "Artifact paths must stay inside the worktree.",
            });
        }
      }
    }
    if (node.kind === "join" && definition.edges.filter((edge) => edge.to === node.id).length < 2)
      issues.push({ nodeId: node.id, message: "A join needs at least two incoming branches." });
    if (node.kind === "approval") {
      if (!isWorkflowArtifactPath(node.artifactPath))
        issues.push({
          nodeId: node.id,
          message: "Approval artifacts must stay inside the worktree.",
        });
      if (
        nodes.get(node.revisionTarget)?.kind !== "agent" ||
        !descendants.get(node.revisionTarget)?.has(node.id)
      )
        issues.push({
          nodeId: node.id,
          message: "Choose an earlier agent stage for requested revisions.",
        });
    }
  }
  const agents = definition.nodes.filter((node) => node.kind === "agent");
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;
      if (descendants.get(a.id)!.has(b.id) || descendants.get(b.id)!.has(a.id)) continue;
      if (a.threadId === b.threadId)
        issues.push({ nodeId: b.id, message: "Parallel stages need separate agent threads." });
      if (a.access === "write" || b.access === "write")
        issues.push({
          nodeId: b.id,
          message: "Only read-only stages can run in parallel in one worktree.",
        });
    }
  }
  const rework = definition.rework;
  if (
    rework &&
    (nodes.get(rework.from)?.kind !== "agent" ||
      nodes.get(rework.to)?.kind !== "agent" ||
      !descendants.get(rework.to)?.has(rework.from))
  ) {
    issues.push({ message: "Rework must return from an agent result to an earlier agent stage." });
  }
  return issues;
}

export function isWorkflowArtifactPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== ".." && part !== "." && part.length > 0)
  );
}

/** Pending nodes are eligible only after all their parents complete in the current execution. */
export function readyWorkflowNodes(
  definition: WorkflowDefinition,
  states: readonly WorkflowNodeState[],
): string[] {
  const byId = new Map(states.map((state) => [state.nodeId, state]));
  return definition.nodes
    .filter(
      (node) =>
        byId.get(node.id)?.status === "pending" &&
        definition.edges
          .filter((edge) => edge.to === node.id)
          .every((edge) => byId.get(edge.from)?.status === "complete"),
    )
    .map((node) => node.id);
}

/** A ready approval remains reviewable when pausing prevents the scheduler from starting it. */
export function canReviewWorkflowApproval(
  task: Pick<WorkflowTask, "status" | "definition" | "nodes">,
  nodeId: string,
): boolean {
  if (task.status !== "running" && task.status !== "paused") return false;
  const node = task.definition.nodes.find((node) => node.id === nodeId);
  if (node?.kind !== "approval") return false;
  const state = task.nodes.find((state) => state.nodeId === nodeId);
  return (
    state?.status === "awaiting-approval" ||
    (state?.status === "pending" &&
      readyWorkflowNodes(task.definition, task.nodes).includes(nodeId))
  );
}
