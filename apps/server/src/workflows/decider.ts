import type { WorkflowNodeState, WorkflowStageResult, WorkflowTask } from "@t3tools/contracts";
import { readyWorkflowNodes, workflowDescendants } from "@t3tools/shared/workflowGraph";

export type WorkflowAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" }
  | { type: "start"; nodeId: string; operationId: string; artifactRevision?: string }
  | { type: "started"; nodeId: string; operationId: string; turnId: string }
  | { type: "result"; nodeId: string; operationId: string; result: WorkflowStageResult }
  | { type: "failed"; nodeId: string; operationId: string; error: string }
  | { type: "approve" | "revise"; nodeId: string; artifactRevision: string }
  | { type: "retry"; nodeId: string }
  | { type: "recovered" };

function pendingNode(state: WorkflowNodeState, iteration = state.iteration): WorkflowNodeState {
  return {
    ...state,
    iteration,
    attempt: state.attempt + 1,
    skillIndex: 0,
    status: "pending",
    operationId: null,
    turnId: null,
    result: null,
    error: null,
    artifactRevision: null,
  };
}

/** Pure task transitions. IO must persist their result before dispatching any new effect. */
export function decideWorkflow(task: WorkflowTask, action: WorkflowAction): WorkflowTask {
  if (action.type === "pause")
    return task.status === "running" ? { ...task, status: "paused" } : task;
  if (action.type === "resume") {
    if (task.status !== "paused") throw new Error("Only paused tasks can resume.");
    if (task.nodes.some((node) => node.status === "failed"))
      throw new Error("Retry the failed stage before resuming.");
    return {
      ...task,
      status: task.nodes.every((node) => node.status === "complete") ? "complete" : "running",
      error: null,
    };
  }
  if (action.type === "cancel") {
    if (task.status === "complete") return task;
    return {
      ...task,
      status: "cancelled",
      nodes: task.nodes.map((node) =>
        node.status === "pending" || node.status === "awaiting-approval"
          ? { ...node, status: "cancelled" }
          : node,
      ),
    };
  }
  if (action.type === "recovered") {
    const uncertain = task.nodes.some(
      (node) => node.status === "running" || node.status === "dispatching",
    );
    if (!uncertain) return task;
    return {
      ...task,
      status: task.status === "cancelled" ? "cancelled" : "paused",
      error: "Execution was interrupted. Inspect the affected stages before retrying.",
      nodes: task.nodes.map((node) =>
        node.status === "running" || node.status === "dispatching"
          ? {
              ...node,
              status: "failed",
              error: "The previous operation's outcome needs reconciliation.",
            }
          : node,
      ),
    };
  }
  const index = task.nodes.findIndex((node) => node.nodeId === action.nodeId);
  const state = task.nodes[index];
  const node = task.definition.nodes.find((item) => item.id === action.nodeId);
  if (!state || !node) throw new Error("Workflow stage not found.");
  let next = state;
  let status = task.status;
  let error = task.error;
  if (action.type === "start") {
    if (
      task.status !== "running" ||
      !readyWorkflowNodes(task.definition, task.nodes).includes(node.id)
    )
      throw new Error("Stage dependencies are not ready.");
    if (node.kind === "agent") {
      const activeNodes = task.definition.nodes.filter((item) =>
        task.nodes.some(
          (entry) =>
            entry.nodeId === item.id &&
            (entry.status === "running" || entry.status === "dispatching"),
        ),
      );
      if (
        activeNodes.some(
          (item) =>
            item.kind === "agent" &&
            (item.threadId === node.threadId || item.access === "write" || node.access === "write"),
        )
      )
        throw new Error("Another stage owns this worktree or agent thread.");
      next = { ...state, status: "dispatching", operationId: action.operationId, error: null };
    } else if (node.kind === "approval") {
      if (!action.artifactRevision)
        throw new Error("Capture the approval artifact before requesting a decision.");
      next = { ...state, status: "awaiting-approval", artifactRevision: action.artifactRevision };
    } else next = { ...state, status: "complete" };
  } else if (action.type === "started" || action.type === "result" || action.type === "failed") {
    if (
      action.operationId !== state.operationId ||
      (state.status !== "dispatching" && state.status !== "running")
    )
      return task;
    if (action.type === "started") next = { ...state, status: "running", turnId: action.turnId };
    if (action.type === "failed") {
      next = { ...state, status: "failed", error: action.error };
      if (status !== "cancelled") status = "paused";
      error = action.error;
    }
    if (action.type === "result") {
      if (node.kind !== "agent") throw new Error("Only agent stages accept skill results.");
      const skill = node.skills[state.skillIndex];
      if (!skill || skill.outputPaths.some((path) => !action.result.artifacts.includes(path))) {
        throw new Error("The skill result is missing required artifacts.");
      }
      const lastSkill = state.skillIndex + 1 >= node.skills.length;
      if (action.result.outcome === "changes-requested" && !lastSkill)
        throw new Error("A rework outcome must come from the last skill.");
      next = {
        ...state,
        status: status === "cancelled" ? "cancelled" : lastSkill ? "complete" : "pending",
        skillIndex: lastSkill ? state.skillIndex : state.skillIndex + 1,
        turnId: null,
        operationId: null,
        result: {
          ...action.result,
          artifacts: [...new Set([...(state.result?.artifacts ?? []), ...action.result.artifacts])],
        },
      };
      if (action.result.outcome === "changes-requested" && status !== "cancelled") {
        const rework = task.definition.rework;
        if (!rework || rework.from !== node.id)
          throw new Error("Configure a rework destination for this stage.");
        if (task.iteration + 1 >= rework.maxIterations) {
          next = {
            ...next,
            status: "failed",
            error: "The configured review iteration limit was reached.",
          };
          status = "paused";
          error = next.error;
        } else
          return restartFrom(
            { ...task, nodes: task.nodes.map((entry, i) => (i === index ? next : entry)) },
            rework.to,
            action.result,
          );
      }
    }
  } else if (action.type === "approve" || action.type === "revise") {
    if (
      task.status === "cancelled" ||
      task.status === "complete" ||
      node.kind !== "approval" ||
      state.status !== "awaiting-approval"
    )
      throw new Error("This stage is not awaiting approval.");
    if (state.artifactRevision !== action.artifactRevision)
      throw new Error("The artifact changed. Review the current revision before approving.");
    if (action.type === "revise") return restartFrom(task, node.revisionTarget);
    next = { ...state, status: "complete" };
  } else if (action.type === "retry") {
    if (task.status !== "paused" || state.status !== "failed")
      throw new Error("Only failed stages in a paused task can be retried.");
    next = {
      ...state,
      attempt: state.attempt + 1,
      status: "pending",
      operationId: null,
      turnId: null,
      error: null,
    };
    error = null;
  }
  const nodes = task.nodes.map((entry, i) => (i === index ? next : entry));
  if (status === "running" && nodes.every((entry) => entry.status === "complete"))
    status = "complete";
  return { ...task, nodes, status, error };
}

function restartFrom(
  task: WorkflowTask,
  nodeId: string,
  context?: WorkflowStageResult,
): WorkflowTask {
  if (task.nodes.some((node) => node.status === "running" || node.status === "dispatching"))
    throw new Error("Wait for active branches before requesting rework.");
  const reset = workflowDescendants(task.definition, nodeId);
  reset.add(nodeId);
  const iteration = task.iteration + 1;
  return {
    ...task,
    ...(context ? { reworkContext: context } : {}),
    iteration,
    nodes: task.nodes.map((node) => (reset.has(node.nodeId) ? pendingNode(node, iteration) : node)),
    error: null,
  };
}
