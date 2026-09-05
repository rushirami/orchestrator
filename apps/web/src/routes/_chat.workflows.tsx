import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkflowEditor } from "../components/workflows/WorkflowEditor";

export const Route = createFileRoute("/_chat/workflows")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { project?: string; environment?: string; task?: string } => ({
    ...(typeof search.project === "string" ? { project: search.project } : {}),
    ...(typeof search.environment === "string" ? { environment: search.environment } : {}),
    ...(typeof search.task === "string" ? { task: search.task } : {}),
  }),
  component: () => (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkflowEditor />
    </SidebarInset>
  ),
});
