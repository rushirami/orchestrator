import { randomUUID } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MODEL,
  ProviderInstanceId,
  WorkflowId,
  type WorkflowDefinition,
  type WorkflowTemplate,
} from "@t3tools/contracts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import { ArrowLeft, Check, Folder, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useProjects, useServerConfigs } from "../../state/entities";
import { workflowEnvironment } from "../../state/workflows";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowInspector } from "./WorkflowInspector";
import { WorkflowSettings } from "./WorkflowSettings";
import { createLocalWorkflow } from "./presets";
import "./workflows.css";

export function WorkflowEditor() {
  const projects = useProjects();
  const [projectKey, setProjectKey] = useState("");
  const project =
    projects.find((item) => `${item.environmentId}:${item.id}` === projectKey) ?? projects[0];
  return (
    <div className="workflow-workspace">
      <header className="workflow-header">
        <Folder size={17} />
        <select
          aria-label="Workflow project"
          value={project ? `${project.environmentId}:${project.id}` : ""}
          onChange={(event) => setProjectKey(event.target.value)}
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
        <span className="workflow-help">/</span>
        <strong>Workflows</strong>
      </header>
      {project ? (
        <ProjectWorkflows key={`${project.environmentId}:${project.id}`} project={project} />
      ) : (
        <div className="workflow-empty">Add a project to configure its workflows.</div>
      )}
    </div>
  );
}

function ProjectWorkflows({ project }: { project: EnvironmentProject }) {
  const snapshot = useAtomValue(
    workflowEnvironment.snapshot({ environmentId: project.environmentId, input: {} }),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  if (snapshot._tag === "Failure")
    return (
      <div className="workflow-error" role="alert">
        Could not load workflows. Reconnect to this project's environment and try again.
      </div>
    );
  if (snapshot._tag !== "Success")
    return (
      <div className="workflow-empty" role="status">
        Loading workflows…
      </div>
    );
  const templates = snapshot.value.templates.filter(
    (template) => template.projectId === project.id,
  );
  const template = templates.find((item) => item.id === selectedId);
  return (
    <>
      <div className="workflow-heading">
        <div>
          <h1>Project workflows</h1>
          <p>Design how your agents work together.</p>
        </div>
        <div className="workflow-row">
          <select
            className="workflow-button"
            aria-label="Saved workflow"
            value={template?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value || null)}
          >
            <option value="">New workflow</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.definition.name}
              </option>
            ))}
          </select>
          <button
            className="workflow-button"
            onClick={() => {
              setSelectedId(null);
              setDraftKey((key) => key + 1);
            }}
          >
            <Plus size={15} />
            New template
          </button>
        </div>
      </div>
      <TemplateEditor
        key={template?.id ?? `new-${draftKey}`}
        project={project}
        template={template}
        onSaved={setSelectedId}
      />
    </>
  );
}

function TemplateEditor({
  project,
  template,
  onSaved,
}: {
  project: EnvironmentProject;
  template: WorkflowTemplate | undefined;
  onSaved: (id: string | null) => void;
}) {
  const configs = useServerConfigs();
  const providers = configs.get(project.environmentId)?.providers ?? [];
  const [id] = useState(() => template?.id ?? WorkflowId.make(randomUUID()));
  const [revision, setRevision] = useState(template?.revision ?? 0);
  const [definition, setDefinition] = useState<WorkflowDefinition>(() => {
    if (template) return template.definition;
    const provider = providers.find((item) => item.enabled && item.installed);
    return createLocalWorkflow(
      project.defaultModelSelection ?? {
        instanceId: provider?.instanceId ?? ProviderInstanceId.make("codex"),
        model:
          provider?.models.find((model) => model.isDefault)?.slug ??
          provider?.models[0]?.slug ??
          DEFAULT_MODEL,
      },
    );
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(!template);
  const save = useAtomCommand(workflowEnvironment.saveTemplate);
  const remove = useAtomCommand(workflowEnvironment.remove);
  const update = (next: WorkflowDefinition) => {
    setDefinition(next);
    setDirty(true);
    setNotice(null);
    setError(null);
  };
  const node = definition.nodes.find((item) => item.id === selectedNode);
  const validate = () => {
    const issues = validateWorkflowGraph(definition);
    if (issues.length) {
      setError(issues.map((issue) => issue.message).join("\n"));
      return false;
    }
    setError(null);
    return true;
  };
  return (
    <>
      <div className="workflow-header">
        {settings ? (
          <button className="workflow-button" onClick={() => setSettings(false)}>
            <ArrowLeft size={14} />
            Back to workflow
          </button>
        ) : (
          <>
            <strong>{definition.name}</strong>
            <button
              className="workflow-button"
              onClick={() => {
                const nodeId = randomUUID();
                update({
                  ...definition,
                  nodes: [
                    ...definition.nodes,
                    {
                      id: nodeId,
                      name: "New stage",
                      kind: "agent",
                      threadId: definition.threads[0]?.id ?? "",
                      access: "read-only",
                      position: {
                        x: 40,
                        y: Math.max(0, ...definition.nodes.map((item) => item.position.y)) + 134,
                      },
                      skills: [
                        {
                          id: randomUUID(),
                          prompt: "Describe what this stage should do.",
                          outputPaths: [],
                        },
                      ],
                    },
                  ],
                });
                setSelectedNode(nodeId);
              }}
            >
              <Plus size={14} />
              Add stage
            </button>
          </>
        )}
        <div className="workflow-spacer" />
        <button
          className="workflow-button"
          onClick={() => {
            if (validate()) setNotice("The graph is valid. No agents or worktrees were started.");
          }}
        >
          <Check size={14} />
          Validate
        </button>
        {!settings && (
          <button className="workflow-button" onClick={() => setSettings(true)}>
            <Settings2 size={14} />
            Workflow settings
          </button>
        )}
        <button
          className="workflow-button is-primary"
          disabled={busy || !dirty}
          onClick={async () => {
            if (!validate()) return;
            setBusy(true);
            const result = await save({
              environmentId: project.environmentId,
              input: { id, projectId: project.id, expectedRevision: revision, definition },
            });
            setBusy(false);
            if (result._tag === "Failure") {
              setError(String(squashAtomCommandFailure(result)));
              return;
            }
            setRevision(
              result.value.templates.find((item) => item.id === id)?.revision ?? revision + 1,
            );
            setDirty(false);
            setNotice("Template saved.");
            onSaved(id);
          }}
        >
          {busy ? "Saving…" : dirty ? "Save template" : "Saved"}
        </button>
        {revision > 0 && (
          <button
            className="workflow-button"
            aria-label="Delete template"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Delete ${definition.name}? Existing tasks keep their own settings.`,
                )
              )
                return;
              setBusy(true);
              const result = await remove({
                environmentId: project.environmentId,
                input: { id, projectId: project.id, expectedRevision: revision },
              });
              setBusy(false);
              if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
              else onSaved(null);
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {error && (
        <div className="workflow-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="workflow-notice" role="status">
          {notice}
        </div>
      )}
      {settings ? (
        <WorkflowSettings definition={definition} providers={providers} onChange={update} />
      ) : (
        <div className="workflow-body">
          <WorkflowGraph
            definition={definition}
            selectedId={selectedNode}
            onSelect={setSelectedNode}
            onChange={update}
          />
          {node && (
            <WorkflowInspector
              definition={definition}
              node={node}
              onChange={update}
              onSelect={setSelectedNode}
            />
          )}
        </div>
      )}
    </>
  );
}
