import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkflowEditor } from "../components/workflows/WorkflowEditor";

export const Route = createFileRoute("/_chat/workflows")({
  component: () => (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkflowEditor />
    </SidebarInset>
  ),
});
