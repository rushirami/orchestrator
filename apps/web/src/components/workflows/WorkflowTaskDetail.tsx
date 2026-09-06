import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  EnvironmentId,
  WorkflowTask,
  WorkflowControlInput,
  WorkflowArtifact,
} from "@t3tools/contracts";
import {
  ArrowLeft,
  Check,
  Pause,
  Play,
  Square,
  RotateCcw,
  FileText,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useAtomCommand } from "../../state/use-atom-command";
import { workflowEnvironment } from "../../state/workflows";
import ChatMarkdown from "../ChatMarkdown";
import { WorkflowGraph } from "./WorkflowGraph";
import { WorkflowArtifactReview } from "./WorkflowArtifactReview";

export function WorkflowTaskDetail({
  task,
  environmentId,
  onDismissed,
}: {
  task: WorkflowTask;
  environmentId: EnvironmentId;
  onDismissed: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const [artifact, setArtifact] = useState<
    (typeof WorkflowArtifact.Type & { nodeId: string }) | null
  >(null);
  const [activeTab, setActiveTab] = useState<string>("workflow");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const control = useAtomCommand(workflowEnvironment.control);
  const readArtifact = useAtomCommand(workflowEnvironment.artifact);
  const remove = useAtomCommand(workflowEnvironment.remove);
  const selected = task.definition.nodes.find((node) => node.id === selectedId);
  const state = task.nodes.find((node) => node.nodeId === selectedId);
  const act = async (
    action: WorkflowControlInput["action"],
    nodeId?: string,
    revisionComments?: WorkflowControlInput["revisionComments"],
  ) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await control({
      environmentId,
      input: {
        taskId: task.id,
        expectedRevision: task.revision,
        action,
        ...(nodeId ? { nodeId } : {}),
        ...(revisionComments ? { revisionComments } : {}),
        ...(artifact && artifact.nodeId === nodeId ? { artifactRevision: artifact.revision } : {}),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (action === "approve" || action === "revise") {
      setArtifact(null);
      setActiveTab("workflow");
    }
    return result._tag !== "Failure";
  };
  const waiting = task.nodes.filter((node) => node.status === "awaiting-approval");
  return (
    <>
      <div className="workflow-heading">
        <div>
          <h1>{task.workspaceName}</h1>
          <p>
            {task.definition.name} · {task.branch} · Iteration {task.iteration + 1}
          </p>
        </div>
        <span className="workflow-task-status" role="status">
          {task.status}
        </span>
      </div>
      <header className="workflow-header">
        <Link
          className="workflow-button"
          to="/workflows"
          search={{ project: task.projectId, environment: environmentId }}
        >
          <ArrowLeft size={14} />
          Templates
        </Link>
        <select
          className="workflow-button workflow-stage-picker"
          aria-label="Stage details"
          value={selectedId ?? ""}
          onChange={(event) => {
            setSelectedId(event.target.value || null);
            setArtifact(null);
          }}
        >
          <option value="">Stage details</option>
          {task.definition.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name} ·{" "}
              {task.nodes.find((state) => state.nodeId === node.id)?.status ?? "pending"}
            </option>
          ))}
        </select>
        <div className="workflow-spacer" />
        {task.status === "running" && (
          <button className="workflow-button" disabled={busy} onClick={() => void act("pause")}>
            <Pause size={14} />
            Pause after current stages
          </button>
        )}
        {task.status === "paused" && (
          <button
            className="workflow-button"
            disabled={busy || task.nodes.some((node) => node.status === "failed")}
            onClick={() => void act("resume")}
          >
            <Play size={14} />
            Resume
          </button>
        )}
        {(task.status === "running" || task.status === "paused" || task.status === "starting") && (
          <button className="workflow-button" disabled={busy} onClick={() => void act("cancel")}>
            <Square size={14} />
            Cancel task
          </button>
        )}
        {(task.status === "complete" || task.status === "cancelled") && (
          <button
            className="workflow-button is-primary"
            disabled={
              busy ||
              task.nodes.some((node) => node.status === "running" || node.status === "dispatching")
            }
            onClick={async () => {
              setBusy(true);
              const result = await remove({
                environmentId,
                input: { id: task.id, projectId: task.projectId, expectedRevision: task.revision },
              });
              setBusy(false);
              if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
              else onDismissed();
            }}
          >
            <Check size={14} />
            Dismiss task
          </button>
        )}
      </header>
      <div className="workflow-run-summary" aria-label="Workflow progress">
        <span>
          {task.nodes.filter((node) => node.status === "complete").length} /{" "}
          {task.definition.nodes.length} stages complete
        </span>
        {task.nodes
          .filter((node) =>
            ["running", "dispatching", "awaiting-approval", "failed"].includes(node.status),
          )
          .map((node) => (
            <button
              key={node.nodeId}
              data-status={node.status}
              onClick={() => {
                setSelectedId(node.nodeId);
                setArtifact(null);
              }}
            >
              {task.definition.nodes.find((item) => item.id === node.nodeId)?.name} ·{" "}
              {node.status.replaceAll("-", " ")}
            </button>
          ))}
      </div>
      {(error || task.error) && (
        <div className="workflow-error" role="alert">
          {error ?? task.error}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="workflow-notice">
          {waiting.map((node) => (
            <button
              key={node.nodeId}
              onClick={() => {
                setSelectedId(node.nodeId);
                setArtifact(null);
              }}
            >
              Review {task.definition.nodes.find((item) => item.id === node.nodeId)?.name} →
            </button>
          ))}
        </div>
      )}
      {task.status === "complete" && (
        <div className="workflow-notice">
          Workflow complete. Dismiss it when you’re ready; your threads, worktree, and files remain
          available.
        </div>
      )}
      <div className="workflow-body">
        <Tabs.Root className="workflow-content-tabs" value={activeTab} onValueChange={setActiveTab}>
          <Tabs.List className="workflow-content-tab-list" aria-label="Workflow views">
            <Tabs.Tab className="workflow-content-tab" value="workflow">
              Workflow
            </Tabs.Tab>
            <Tabs.Tab className="workflow-content-tab" value="files">
              Files
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel className="workflow-content-panel" value="workflow" keepMounted>
            <WorkflowGraph
              fitToView
              definition={task.definition}
              states={task.nodes}
              selectedId={selectedId}
              onSelect={(id) => {
                const node = task.definition.nodes.find((item) => item.id === id);
                const threadId = node?.kind === "agent" ? task.threadIds[node.threadId] : undefined;
                if (threadId) {
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId, threadId },
                  });
                  return;
                }
                setSelectedId(id);
                setArtifact(null);
              }}
            />
          </Tabs.Panel>
          <Tabs.Panel className="workflow-content-panel" value="files">
            {artifact ? (
              <WorkflowArtifactReview
                key={`${artifact.nodeId}:${artifact.revision}`}
                artifact={artifact}
                environmentId={environmentId}
                cwd={task.worktreePath ?? undefined}
                reviewKey={`t3code.workflow-review:${JSON.stringify([environmentId, task.id, artifact.nodeId, artifact.path])}`}
                canReview={
                  task.status !== "cancelled" &&
                  task.status !== "complete" &&
                  selected?.kind === "approval" &&
                  artifact.nodeId === selected.id &&
                  state?.status === "awaiting-approval"
                }
                busy={busy}
                onClose={() => setArtifact(null)}
                onApprove={() => act("approve", artifact.nodeId)}
                onRequestRevision={(comments) => act("revise", artifact.nodeId, comments)}
              />
            ) : (
              <div className="workflow-empty">
                Select a stage and open an artifact to review its file.
              </div>
            )}
          </Tabs.Panel>
        </Tabs.Root>
        {selected && state && (
          <aside className="workflow-inspector" key={selected.id}>
            <h2>{selected.name}</h2>
            <p className="workflow-help">
              {state.status} · Attempt {state.attempt + 1}
            </p>
            {selected.kind === "agent" && (
              <>
                <p className="workflow-help">
                  Skill {state.skillIndex + 1} of {selected.skills.length} ·{" "}
                  {selected.access === "read-only" ? "Read-only review" : "Read and write"}
                </p>
                {task.threadIds[selected.threadId] && (
                  <Link
                    className="workflow-button"
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: task.threadIds[selected.threadId]! }}
                  >
                    <MessageSquare size={14} />
                    Open agent thread
                  </Link>
                )}
              </>
            )}
            {state.error && <p className="workflow-error">{state.error}</p>}
            {state.status === "failed" &&
              task.status === "paused" &&
              selected.kind === "agent" &&
              state.turnId &&
              state.operationId && (
                <button
                  className="workflow-button"
                  disabled={busy}
                  onClick={() => void act("reconcile", selected.id)}
                >
                  Recheck completed turn
                </button>
              )}
            {state.status === "failed" && task.status === "paused" && (
              <button
                className="workflow-button"
                disabled={busy}
                onClick={() => void act("retry", selected.id)}
              >
                <RotateCcw size={14} />
                Prepare skill retry
              </button>
            )}
            {selected.kind === "approval" && (
              <section className="workflow-divider">
                <button
                  className="workflow-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const result = await readArtifact({
                      environmentId,
                      input: { taskId: task.id, nodeId: selected.id },
                    });
                    setBusy(false);
                    if (result._tag === "Failure")
                      setError(String(squashAtomCommandFailure(result)));
                    else {
                      setError(null);
                      setArtifact({ ...result.value, nodeId: selected.id });
                      setActiveTab("files");
                    }
                  }}
                >
                  <FileText size={14} />
                  {artifact?.nodeId === selected.id
                    ? "Reload artifact"
                    : `Open ${selected.artifactPath}`}
                </button>
                <p className="workflow-help">
                  Review the file in the Files tab. Add line comments there to request changes
                  before approving.
                </p>
              </section>
            )}
            {state.result && (
              <section className="workflow-divider">
                <h3>Stage result</h3>
                <ChatMarkdown
                  text={state.result.summary}
                  cwd={task.worktreePath ?? undefined}
                  environmentId={environmentId}
                  className="workflow-result"
                />
                {state.result.artifacts.map((path) => (
                  <button
                    className="workflow-button"
                    key={path}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const result = await readArtifact({
                        environmentId,
                        input: { taskId: task.id, nodeId: selected.id, path },
                      });
                      setBusy(false);
                      if (result._tag === "Failure")
                        setError(String(squashAtomCommandFailure(result)));
                      else {
                        setError(null);
                        setArtifact({ ...result.value, nodeId: selected.id });
                        setActiveTab("files");
                      }
                    }}
                  >
                    <FileText size={12} /> {path}
                  </button>
                ))}
              </section>
            )}
            <section className="workflow-divider">
              <h3>Worktree</h3>
              <p className="workflow-help break-all">{task.worktreePath ?? "Preparing…"}</p>
            </section>
          </aside>
        )}
      </div>
    </>
  );
}
