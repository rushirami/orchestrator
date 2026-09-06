import { randomUUID } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MODEL,
  ProviderInstanceId,
  WorkflowId,
  resolveWorkflowPrompt,
  workflowVariables,
  type WorkflowDefinition,
  type WorkflowTemplate,
} from "@t3tools/contracts";
import { validateWorkflowGraph } from "@t3tools/shared/workflowGraph";
import { ArrowLeft, Check, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjects, useServerConfigs } from "../../state/entities";
import { workflowEnvironment } from "../../state/workflows";
import { useAtomCommand } from "../../state/use-atom-command";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowInspector } from "./WorkflowInspector";
import { WorkflowSettings } from "./WorkflowSettings";
import { WorkflowLaunch } from "./WorkflowLaunch";
import { WorkflowTaskDetail } from "./WorkflowTaskDetail";
import { WorkflowBreadcrumb } from "./WorkflowBreadcrumb";
import { WorkflowNew } from "./WorkflowNew";
import { createBlankWorkflow, createWorkflowThread } from "./draft";
import "./workflows.css";

export function WorkflowEditor() {
  const projects = useProjects();
  const search = useSearch({ from: "/_chat/workflows" });
  const project =
    projects.find(
      (item) => item.id === search.project && item.environmentId === search.environment,
    ) ?? (!search.project && !search.environment ? projects[0] : undefined);
  return (
    <div className="workflow-workspace">
      {project ? (
        <ProjectWorkflows key={`${project.environmentId}:${project.id}`} project={project} />
      ) : (
        <div className="workflow-empty">
          {projects.length
            ? "This project is unavailable. Choose a project in the sidebar."
            : "Add a project to configure its workflows."}
        </div>
      )}
    </div>
  );
}

function ProjectWorkflows({ project }: { project: EnvironmentProject }) {
  const search = useSearch({ from: "/_chat/workflows" });
  const snapshot = useAtomValue(
    workflowEnvironment.snapshot({ environmentId: project.environmentId, input: {} }),
  );
  const task =
    snapshot._tag === "Success"
      ? snapshot.value.tasks.find(
          (item) => item.id === search.task && item.projectId === project.id,
        )
      : undefined;
  return (
    <>
      <header className="workflow-header">
        <WorkflowBreadcrumb project={project} task={task} />
      </header>
      <ProjectWorkflowContent key={search.task ?? search.view ?? "templates"} project={project} />
    </>
  );
}

function ProjectWorkflowContent({ project }: { project: EnvironmentProject }) {
  const search = useSearch({ from: "/_chat/workflows" });
  const navigate = useNavigate();
  const snapshot = useAtomValue(
    workflowEnvironment.snapshot({ environmentId: project.environmentId, input: {} }),
  );
  const [selectedId, setSelectedId] = useState<string | null>();
  const [draftKey, setDraftKey] = useState(0);
  const [unsaved, setUnsaved] = useState(false);
  const canLeaveDraft = () => !unsaved || window.confirm("Discard unsaved workflow changes?");
  useBlocker({ shouldBlockFn: () => !canLeaveDraft(), enableBeforeUnload: unsaved });
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
  if (search.task) {
    const task = snapshot.value.tasks.find(
      (task) => task.id === search.task && task.projectId === project.id,
    );
    return task ? (
      <WorkflowTaskDetail
        key={task.id}
        task={task}
        environmentId={project.environmentId}
        onDismissed={() =>
          void navigate({
            to: "/workflows",
            search: { project: project.id, environment: project.environmentId },
          })
        }
      />
    ) : (
      <div className="workflow-empty">
        <p>This workflow task is no longer available.</p>
        <button
          className="workflow-button"
          onClick={() =>
            void navigate({
              to: "/workflows",
              search: { project: project.id, environment: project.environmentId },
            })
          }
        >
          Back to templates
        </button>
      </div>
    );
  }
  const templates = snapshot.value.templates.filter(
    (template) => template.projectId === project.id,
  );
  if (search.view === "new") return <WorkflowNew project={project} templates={templates} />;
  const template =
    selectedId === undefined ? templates[0] : templates.find((item) => item.id === selectedId);
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
            onChange={(event) => {
              if (!canLeaveDraft()) return;
              setSelectedId(event.target.value || null);
              setDraftKey((key) => key + 1);
            }}
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
              if (!canLeaveDraft()) return;
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
        key={draftKey}
        project={project}
        template={template}
        onUnsaved={setUnsaved}
        onSaved={(id) => {
          setSelectedId(id);
          if (id === null) setDraftKey((key) => key + 1);
        }}
      />
    </>
  );
}

function TemplateEditor({
  project,
  template,
  onSaved,
  onUnsaved,
}: {
  project: EnvironmentProject;
  template: WorkflowTemplate | undefined;
  onSaved: (id: string | null) => void;
  onUnsaved: (value: boolean) => void;
}) {
  const configs = useServerConfigs();
  const providers = configs.get(project.environmentId)?.providers ?? [];
  const provider = providers.find((item) => item.enabled && item.installed);
  const defaultModelSelection = project.defaultModelSelection ?? {
    instanceId: provider?.instanceId ?? ProviderInstanceId.make("codex"),
    model:
      provider?.models.find((model) => model.isDefault)?.slug ??
      provider?.models[0]?.slug ??
      DEFAULT_MODEL,
  };
  const [id] = useState(() => template?.id ?? WorkflowId.make(randomUUID()));
  const [revision, setRevision] = useState(template?.revision ?? 0);
  const [definition, setDefinition] = useState<WorkflowDefinition>(
    () => template?.definition ?? createBlankWorkflow(),
  );
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(!template);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    onUnsaved(dirty && touched);
  }, [dirty, touched, onUnsaved]);
  const [launchOpen, setLaunchOpen] = useState(false);
  const navigate = useNavigate();
  const save = useAtomCommand(workflowEnvironment.saveTemplate);
  const remove = useAtomCommand(workflowEnvironment.remove);
  const validateProviders = useAtomCommand(workflowEnvironment.validate);
  const update = (next: WorkflowDefinition) => {
    setDefinition(next);
    setTouched(true);
    setDirty(true);
    setNotice(null);
    setError(null);
  };
  const node = definition.nodes.find((item) => item.id === selectedNode);
  const validate = () => {
    try {
      resolveWorkflowPrompt(
        definition.prompt,
        Object.fromEntries(workflowVariables(definition.prompt).map((key) => [key, "example"])),
      );
    } catch (error) {
      setError(String(error));
      return false;
    }
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
      {launchOpen && template && (
        <WorkflowLaunch
          template={template}
          project={project}
          onClose={() => setLaunchOpen(false)}
          onLaunched={(task) => {
            setLaunchOpen(false);
            void navigate({
              to: "/workflows",
              search: { task: task.id, project: project.id, environment: project.environmentId },
            });
          }}
        />
      )}
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
                const thread =
                  definition.threads[0] ?? createWorkflowThread(defaultModelSelection, 0);
                update({
                  ...definition,
                  threads: definition.threads.length ? definition.threads : [thread],
                  nodes: [
                    ...definition.nodes,
                    {
                      id: nodeId,
                      name: "New stage",
                      kind: "agent",
                      threadId: thread.id,
                      access: "read-only",
                      position: {
                        x: 40,
                        y: definition.nodes.length
                          ? Math.max(...definition.nodes.map((item) => item.position.y)) + 134
                          : 40,
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
        {revision > 0 && (
          <button
            className="workflow-button"
            disabled={busy || dirty}
            onClick={() => setLaunchOpen(true)}
          >
            Start workflow
          </button>
        )}
        <button
          className="workflow-button"
          disabled={busy}
          onClick={async () => {
            if (!validate()) return;
            setBusy(true);
            const result = await validateProviders({
              environmentId: project.environmentId,
              input: definition,
            });
            setBusy(false);
            if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
            else
              setNotice(
                "The graph and agent capabilities are valid. No agents or worktrees were started.",
              );
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
              defaultModelSelection={defaultModelSelection}
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
