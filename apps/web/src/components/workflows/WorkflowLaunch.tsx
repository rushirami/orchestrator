import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  WorkflowTaskId,
  resolveWorkflowPrompt,
  workflowVariables,
  type WorkflowTemplate,
  type WorkflowTask,
} from "@t3tools/contracts";
import { ArrowUp, GitBranch } from "lucide-react";
import { useState } from "react";
import { randomUUID } from "../../lib/utils";
import { useServerConfigs } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { workflowEnvironment } from "../../state/workflows";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { WorkflowField } from "./WorkflowInspector";

export function WorkflowLaunch({
  template,
  project,
  onClose,
  onLaunched,
}: {
  template: WorkflowTemplate;
  project: EnvironmentProject;
  onClose: () => void;
  onLaunched: (task: WorkflowTask) => void;
}) {
  const [taskId] = useState(() => WorkflowTaskId.make(randomUUID()));
  const [workspaceName, setWorkspaceName] = useState("");
  const [branch, setBranch] = useState(
    `${template.definition.defaults.branchPrefix}task-${taskId.slice(0, 6)}`,
  );
  const [baseBranch, setBaseBranch] = useState(template.definition.defaults.baseBranch);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState(template.definition.threads);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const launch = useAtomCommand(workflowEnvironment.launch);
  const configs = useServerConfigs();
  const providers = configs.get(project.environmentId)?.providers ?? [];
  let preview = "";
  let promptError: string | null = null;
  try {
    preview = resolveWorkflowPrompt(template.definition.prompt, variables);
  } catch (cause) {
    promptError = String(cause);
  }
  const submit = async () => {
    if (busy || promptError || !branch.trim() || !baseBranch.trim()) return;
    setBusy(true);
    setError(null);
    const result = await launch({
      environmentId: project.environmentId,
      input: {
        taskId,
        templateId: template.id,
        projectId: project.id,
        templateRevision: template.revision,
        workspaceName: workspaceName.trim() || template.definition.name,
        branch,
        baseBranch,
        variables,
        threads,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    onLaunched(result.value);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="workflow-launch-popup" showCloseButton={!busy}>
        <div
          className="workflow-workspace workflow-launch"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        >
          <DialogTitle>Start a workflow</DialogTitle>
          <DialogDescription>
            {template.definition.name} · {project.title}
          </DialogDescription>
          <div className="workflow-columns">
            <WorkflowField label="Workspace name">
              <input
                autoFocus
                placeholder="Workspace name (optional)"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </WorkflowField>
            <WorkflowField label="New branch">
              <input value={branch} onChange={(event) => setBranch(event.target.value)} />
            </WorkflowField>
          </div>
          {workflowVariables(template.definition.prompt).map((key) => (
            <WorkflowField key={key} label={key}>
              <input
                placeholder={`Paste ${key}`}
                value={variables[key] ?? ""}
                onChange={(event) => setVariables({ ...variables, [key]: event.target.value })}
              />
            </WorkflowField>
          ))}
          <div className="workflow-preview">
            <strong>Starting prompt</strong>
            <p>
              {preview || "Fill the variables above to see the prompt your first agent receives."}
            </p>
          </div>
          <div className="workflow-divider">
            <strong>Agent threads</strong>
            <p className="workflow-help">
              Stages reuse these conversations. Parallel reviews use separate threads in the same
              worktree.
            </p>
            {threads.map((thread) => (
              <div className="workflow-launch-thread" key={thread.id}>
                <strong>{thread.name}</strong>
                <select
                  aria-label={`${thread.name} agent`}
                  value={thread.modelSelection.instanceId}
                  onChange={(event) => {
                    const provider = providers.find(
                      (provider) => provider.instanceId === event.target.value,
                    );
                    const model =
                      provider?.models.find((model) => model.isDefault) ?? provider?.models[0];
                    if (provider && model)
                      setThreads(
                        threads.map((item) =>
                          item.id === thread.id
                            ? {
                                ...item,
                                modelSelection: {
                                  instanceId: provider.instanceId,
                                  model: model.slug,
                                },
                              }
                            : item,
                        ),
                      );
                  }}
                >
                  {!providers.some(
                    (provider) => provider.instanceId === thread.modelSelection.instanceId,
                  ) && (
                    <option value={thread.modelSelection.instanceId}>
                      {thread.modelSelection.instanceId} · Unavailable
                    </option>
                  )}
                  {providers.map((provider) => (
                    <option key={provider.instanceId} value={provider.instanceId}>
                      {provider.displayName ?? provider.driver}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`${thread.name} model`}
                  list={`launch-models-${thread.id}`}
                  value={thread.modelSelection.model}
                  onChange={(event) =>
                    setThreads(
                      threads.map((item) =>
                        item.id === thread.id
                          ? {
                              ...item,
                              modelSelection: { ...item.modelSelection, model: event.target.value },
                            }
                          : item,
                      ),
                    )
                  }
                />
                <datalist id={`launch-models-${thread.id}`}>
                  {providers
                    .find((provider) => provider.instanceId === thread.modelSelection.instanceId)
                    ?.models.map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.name}
                      </option>
                    ))}
                </datalist>
              </div>
            ))}
          </div>
          {error && (
            <div className="workflow-error" role="alert">
              {error}
            </div>
          )}
          <footer className="workflow-launch-footer">
            <GitBranch size={16} />
            <label>
              Base branch{" "}
              <input
                aria-label="Base branch"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
              />
            </label>
            <span className="workflow-spacer" />
            <button
              className="workflow-button is-primary"
              disabled={busy || promptError !== null || !branch.trim() || !baseBranch.trim()}
              onClick={() => void submit()}
            >
              <ArrowUp size={16} />
              {busy ? "Creating worktree…" : "Start workflow"}
            </button>
          </footer>
          <p className="workflow-help">
            The first agent uses its own configured tools and sign-in. ⌘ Enter to start.
          </p>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
