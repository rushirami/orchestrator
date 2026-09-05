import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Folder, GitBranch, MessageSquare, Plus } from "lucide-react";
import { useProjects } from "../../state/entities";
import { workflowEnvironment } from "../../state/workflows";
import "./workflows.css";

interface WorkflowSidebarContentProps {
  collapsed: ReadonlySet<string>;
  onToggle: (key: string, open: boolean) => void;
  onContentReady: () => void;
}

export function WorkflowSidebar({ active }: { active: boolean }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const scrollTop = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const restoreScroll = useCallback(() => {
    if (scroller.current) scroller.current.scrollTop = scrollTop.current;
  }, []);
  const onToggle = useCallback((key: string, open: boolean) => {
    setCollapsed((previous) => {
      if (previous.has(key) === !open) return previous;
      const next = new Set(previous);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  useLayoutEffect(() => {
    if (active) restoreScroll();
  }, [active, restoreScroll]);

  // Keep only view state while hidden; subscriptions belong to the mounted content.
  if (!active) return null;
  return (
    <div
      className="workflow-sidebar"
      aria-label="Workflow tasks"
      ref={scroller}
      onScroll={(event) => {
        scrollTop.current = event.currentTarget.scrollTop;
      }}
    >
      <Link className="workflow-sidebar-action" to="/workflows">
        <Plus size={15} />
        Configure workflows
      </Link>
      <WorkflowSidebarProjects
        collapsed={collapsed}
        onToggle={onToggle}
        onContentReady={restoreScroll}
      />
    </div>
  );
}

function WorkflowSidebarProjects(props: WorkflowSidebarContentProps) {
  const projects = useProjects();
  const environments = [...new Set(projects.map((project) => project.environmentId))];
  return (
    <>
      {environments.map((environmentId) => (
        <EnvironmentWorkflows
          key={environmentId}
          projects={projects.filter((project) => project.environmentId === environmentId)}
          {...props}
        />
      ))}
      {projects.length === 0 && <p className="workflow-help">Add a project to create workflows.</p>}
    </>
  );
}

function EnvironmentWorkflows({
  projects,
  collapsed,
  onToggle,
  onContentReady,
}: WorkflowSidebarContentProps & { projects: readonly EnvironmentProject[] }) {
  const environmentId = projects[0]!.environmentId;
  const result = useAtomValue(workflowEnvironment.snapshot({ environmentId, input: {} }));
  useLayoutEffect(() => {
    if (result._tag === "Success") onContentReady();
  }, [result, onContentReady]);
  if (result._tag === "Failure")
    return <p className="workflow-help">Workflow tasks are unavailable for this environment.</p>;
  if (result._tag !== "Success") return <p className="workflow-help">Loading workflow tasks…</p>;
  return projects.map((project) => {
    const tasks = result.value.tasks.filter((task) => task.projectId === project.id);
    return (
      <section key={project.id} className="workflow-sidebar-project">
        <div className="workflow-sidebar-label">
          <Folder size={15} />
          <strong>{project.title}</strong>
        </div>
        {tasks.length === 0 && <p className="workflow-help">No active workflows</p>}
        {tasks.map((task) => (
          <details
            className="workflow-sidebar-task"
            key={task.id}
            open={!collapsed.has(`${environmentId}:${task.id}`)}
            onToggle={(event) => onToggle(`${environmentId}:${task.id}`, event.currentTarget.open)}
          >
            <summary>
              <ChevronDown size={13} />
              <GitBranch size={14} />
              <Link
                to="/workflows"
                search={{ task: task.id, project: project.id, environment: environmentId }}
              >
                {task.workspaceName}
              </Link>
              <small>{task.status}</small>
            </summary>
            {task.definition.threads.map((thread) => {
              const threadId = task.threadIds[thread.id];
              const stages = task.definition.nodes.filter(
                (node) => node.kind === "agent" && node.threadId === thread.id,
              );
              const state = task.nodes.find(
                (node) =>
                  stages.some((stage) => stage.id === node.nodeId) &&
                  (node.status === "running" || node.status === "failed"),
              );
              return threadId ? (
                <Link
                  key={thread.id}
                  className="workflow-sidebar-thread"
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId }}
                >
                  <MessageSquare size={13} />
                  <span>{thread.name}</span>
                  {state && <small>{state.status}</small>}
                </Link>
              ) : (
                <div key={thread.id} className="workflow-sidebar-thread">
                  <MessageSquare size={13} />
                  <span>{thread.name}</span>
                  <small>Waiting</small>
                </div>
              );
            })}
          </details>
        ))}
      </section>
    );
  });
}
