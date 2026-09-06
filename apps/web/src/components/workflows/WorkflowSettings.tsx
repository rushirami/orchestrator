import {
  resolveWorkflowPrompt,
  workflowVariables,
  type ServerProvider,
  type WorkflowDefinition,
} from "@t3tools/contracts";
import { useState } from "react";
import { WorkflowField } from "./WorkflowInspector";

export function WorkflowSettings({
  definition,
  providers,
  onChange,
}: {
  definition: WorkflowDefinition;
  providers: readonly ServerProvider[];
  onChange: (definition: WorkflowDefinition) => void;
}) {
  const [examples, setExamples] = useState<Record<string, string>>({});
  let preview: string;
  try {
    preview = resolveWorkflowPrompt(definition.prompt, examples);
  } catch {
    preview = "Fill the example values to preview the starting prompt.";
  }
  return (
    <div className="workflow-settings">
      <WorkflowField label="Workflow name">
        <input
          value={definition.name}
          onChange={(event) => onChange({ ...definition, name: event.target.value })}
        />
      </WorkflowField>
      <WorkflowField label="Starting prompt">
        <textarea
          style={{ minHeight: 160 }}
          value={definition.prompt}
          onChange={(event) => onChange({ ...definition, prompt: event.target.value })}
        />
        <small>
          {"Use {{ TASK_ID }} or your own variables. Values are supplied when starting a task."}
        </small>
      </WorkflowField>
      {workflowVariables(definition.prompt).map((key) => (
        <WorkflowField key={key} label={`Example · ${key}`}>
          <input
            value={examples[key] ?? ""}
            placeholder={`Enter ${key}`}
            onChange={(event) => setExamples({ ...examples, [key]: event.target.value })}
          />
        </WorkflowField>
      ))}
      <div className="workflow-preview">
        <strong>Prompt preview</strong>
        <p>{preview}</p>
      </div>
      <section className="workflow-divider">
        <h2>Worktree defaults</h2>
        <p className="workflow-help">
          Each task creates one worktree shared by its agent threads. These defaults can be changed
          at launch.
        </p>
        <div className="workflow-columns">
          <WorkflowField label="Base branch">
            <input
              value={definition.defaults.baseBranch}
              onChange={(event) =>
                onChange({
                  ...definition,
                  defaults: { ...definition.defaults, baseBranch: event.target.value },
                })
              }
            />
          </WorkflowField>
          <WorkflowField label="New branch prefix">
            <input
              value={definition.defaults.branchPrefix}
              onChange={(event) =>
                onChange({
                  ...definition,
                  defaults: { ...definition.defaults, branchPrefix: event.target.value },
                })
              }
            />
          </WorkflowField>
        </div>
      </section>
      <section className="workflow-divider">
        <h2>Agent threads</h2>
        <p className="workflow-help">
          Stages assigned to the same thread share their conversation. Each agent uses its own
          tools, MCP servers, and authentication.
        </p>
        {definition.threads.map((thread) => (
          <div className="workflow-thread-settings" key={thread.id}>
            <WorkflowField label="Thread name">
              <input
                value={thread.name}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    threads: definition.threads.map((item) =>
                      item.id === thread.id ? { ...item, name: event.target.value } : item,
                    ),
                  })
                }
              />
            </WorkflowField>
            <WorkflowField label="Agent">
              <select
                value={thread.modelSelection.instanceId}
                onChange={(event) => {
                  const provider = providers.find((item) => item.instanceId === event.target.value);
                  const model =
                    provider?.models.find((item) => item.isDefault) ?? provider?.models[0];
                  if (!provider || !model) return;
                  onChange({
                    ...definition,
                    threads: definition.threads.map((item) =>
                      item.id === thread.id
                        ? {
                            ...item,
                            modelSelection: { instanceId: provider.instanceId, model: model.slug },
                          }
                        : item,
                    ),
                  });
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
                    {!provider.enabled || !provider.installed ? " · Unavailable" : ""}
                  </option>
                ))}
              </select>
            </WorkflowField>
            <WorkflowField label="Model">
              <input
                list={`models-${thread.id}`}
                value={thread.modelSelection.model}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    threads: definition.threads.map((item) =>
                      item.id === thread.id
                        ? {
                            ...item,
                            modelSelection: { ...item.modelSelection, model: event.target.value },
                          }
                        : item,
                    ),
                  })
                }
              />
              <datalist id={`models-${thread.id}`}>
                {providers
                  .find((provider) => provider.instanceId === thread.modelSelection.instanceId)
                  ?.models.map((model) => (
                    <option key={model.slug} value={model.slug}>
                      {model.name}
                    </option>
                  ))}
              </datalist>
            </WorkflowField>
            <button
              className="workflow-button"
              disabled={definition.nodes.some(
                (node) => node.kind === "agent" && node.threadId === thread.id,
              )}
              onClick={() =>
                onChange({
                  ...definition,
                  threads: definition.threads.filter((item) => item.id !== thread.id),
                })
              }
            >
              Remove unused thread
            </button>
          </div>
        ))}
      </section>
      <section className="workflow-divider">
        <h2>Review revisions</h2>
        <label className="workflow-row">
          <input
            type="checkbox"
            checked={definition.rework !== null}
            onChange={(event) =>
              onChange({
                ...definition,
                rework: event.target.checked
                  ? {
                      from: definition.nodes.findLast((node) => node.kind === "agent")?.id ?? "",
                      to: definition.nodes.find((node) => node.kind === "agent")?.id ?? "",
                      maxIterations: 3,
                    }
                  : null,
              })
            }
          />
          Allow a review stage to request another iteration
        </label>
        {definition.rework && (
          <div className="workflow-columns">
            {(["from", "to"] as const).map((key) => (
              <WorkflowField
                key={key}
                label={key === "from" ? "Review result stage" : "Return to stage"}
              >
                <select
                  value={definition.rework?.[key]}
                  onChange={(event) =>
                    definition.rework &&
                    onChange({
                      ...definition,
                      rework: { ...definition.rework, [key]: event.target.value },
                    })
                  }
                >
                  {definition.nodes
                    .filter((node) => node.kind === "agent")
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                </select>
              </WorkflowField>
            ))}
            <WorkflowField label="Maximum iterations">
              <input
                type="number"
                min={1}
                max={20}
                value={definition.rework.maxIterations}
                onChange={(event) =>
                  definition.rework &&
                  onChange({
                    ...definition,
                    rework: {
                      ...definition.rework,
                      maxIterations: Math.max(1, Number(event.target.value)),
                    },
                  })
                }
              />
            </WorkflowField>
          </div>
        )}
      </section>
      <section className="workflow-divider">
        <h2>On stage failure</h2>
        <p className="workflow-help">
          Pause for input. Completed work is preserved. Resume or retry a failed skill from the task
          view; automatic retries are off.
        </p>
      </section>
    </div>
  );
}
