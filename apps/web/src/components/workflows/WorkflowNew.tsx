import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { WorkflowTemplate } from "@t3tools/contracts";
import { GitBranch, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import { WorkflowLaunch } from "./WorkflowLaunch";

export function WorkflowNew({
  project,
  templates,
}: {
  project: EnvironmentProject;
  templates: readonly WorkflowTemplate[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const template = templates.find((item) => item.id === selectedId);
  const navigate = useNavigate();
  return (
    <>
      <div className="workflow-heading">
        <div>
          <h1>New workflow</h1>
          <p>Choose a template to start work in {project.title}.</p>
        </div>
        <Link
          className="workflow-button"
          to="/workflows"
          search={{ project: project.id, environment: project.environmentId }}
        >
          <Settings2 size={14} />
          Configure templates
        </Link>
      </div>
      <div className="workflow-template-list">
        {templates.map((item) => (
          <button
            className="workflow-template-choice"
            key={item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <GitBranch size={20} />
            <span>
              <strong>{item.definition.name}</strong>
              <small>
                {item.definition.nodes.length} stages · {item.definition.threads.length} agent
                threads
              </small>
            </span>
            <Play size={16} />
          </button>
        ))}
        {templates.length === 0 && (
          <p className="workflow-help">
            Create and save a template in Configure templates, then start your first workflow here.
          </p>
        )}
      </div>
      {template && (
        <WorkflowLaunch
          key={template.id}
          project={project}
          template={template}
          onClose={() => setSelectedId(null)}
          onLaunched={(task) =>
            void navigate({
              to: "/workflows",
              search: { project: project.id, environment: project.environmentId, task: task.id },
            })
          }
        />
      )}
    </>
  );
}
