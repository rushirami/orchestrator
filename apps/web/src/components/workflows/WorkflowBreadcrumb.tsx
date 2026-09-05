import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { WorkflowTask } from "@t3tools/contracts";
import { Folder } from "lucide-react";
import { useProjects } from "../../state/entities";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

export function WorkflowBreadcrumb({
  project,
  task,
}: {
  project: EnvironmentProject;
  task?: WorkflowTask | undefined;
}) {
  return (
    <WorkspaceBreadcrumb ariaLabel="Workflow breadcrumb" className="min-w-0 flex-1 overflow-hidden">
      <WorkflowBreadcrumbItems project={project} task={task} />
    </WorkspaceBreadcrumb>
  );
}

export function WorkflowBreadcrumbItems({
  project,
  task,
  hasThread = false,
}: {
  project: EnvironmentProject;
  task?: WorkflowTask | undefined;
  hasThread?: boolean;
}) {
  const projects = useProjects();
  const navigate = useNavigate();
  const search = { project: project.id, environment: project.environmentId };
  return (
    <>
      <WorkspaceBreadcrumbItem className="shrink gap-2">
        <Folder size={15} className="shrink-0" />
        <select
          aria-label="Workflow project"
          className="min-w-0 max-w-40 cursor-pointer truncate bg-transparent"
          value={`${project.environmentId}:${project.id}`}
          onChange={(event) => {
            const next = projects.find(
              (item) => `${item.environmentId}:${item.id}` === event.target.value,
            );
            if (next)
              void navigate({
                to: "/workflows",
                search: { project: next.id, environment: next.environmentId },
              });
          }}
        >
          {projects.map((item) => (
            <option
              key={`${item.environmentId}:${item.id}`}
              value={`${item.environmentId}:${item.id}`}
            >
              {item.title}
            </option>
          ))}
        </select>
      </WorkspaceBreadcrumbItem>
      <WorkspaceBreadcrumbSeparator />
      <WorkspaceBreadcrumbItem current={!task}>
        <Link to="/workflows" search={search} className="hover:text-foreground">
          Workflows
        </Link>
      </WorkspaceBreadcrumbItem>
      {task && (
        <>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current={!hasThread} className="shrink overflow-hidden">
            <Link
              to="/workflows"
              search={{ ...search, task: task.id }}
              className="truncate hover:text-foreground"
            >
              {task.workspaceName}
            </Link>
          </WorkspaceBreadcrumbItem>
          {hasThread && <WorkspaceBreadcrumbSeparator />}
        </>
      )}
    </>
  );
}
