import type { ModelSelection, WorkflowDefinition, WorkflowThread } from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";

export function createBlankWorkflow(): WorkflowDefinition {
  return {
    format: 1,
    name: "New workflow",
    prompt: "",
    defaults: { baseBranch: "main", branchPrefix: "feat/" },
    threads: [],
    nodes: [],
    edges: [],
    rework: null,
  };
}

export function createWorkflowThread(
  modelSelection: ModelSelection,
  index: number,
): WorkflowThread {
  return { id: randomUUID(), name: `Agent ${index + 1}`, modelSelection };
}
