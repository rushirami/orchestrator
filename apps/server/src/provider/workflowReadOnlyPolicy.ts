/** Review threads inspect files without executing tools that can change the shared worktree. */
export const WORKFLOW_REVIEW_TOOLS = ["Read", "Glob", "Grep"];

export function workflowReviewToolAllowed(name: string): boolean {
  return WORKFLOW_REVIEW_TOOLS.includes(name);
}
