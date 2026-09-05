import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Link } from "@tanstack/react-router";
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
import { useAtomCommand } from "../../state/use-atom-command";
import { workflowEnvironment } from "../../state/workflows";
import ChatMarkdown from "../ChatMarkdown";
import { WorkflowGraph } from "./WorkflowGraph";

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
  const [artifact, setArtifact] = useState<
    (typeof WorkflowArtifact.Type & { nodeId: string }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const control = useAtomCommand(workflowEnvironment.control);
  const readArtifact = useAtomCommand(workflowEnvironment.artifact);
  const remove = useAtomCommand(workflowEnvironment.remove);
  const selected = task.definition.nodes.find((node) => node.id === selectedId);
  const state = task.nodes.find((node) => node.nodeId === selectedId);
  const act = async (action: WorkflowControlInput["action"], nodeId?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await control({
      environmentId,
      input: {
        taskId: task.id,
        expectedRevision: task.revision,
        action,
        ...(nodeId ? { nodeId } : {}),
        ...(artifact && artifact.nodeId === nodeId ? { artifactRevision: artifact.revision } : {}),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (action === "approve" || action === "revise") setArtifact(null);
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
        <WorkflowGraph
          definition={task.definition}
          states={task.nodes}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setArtifact(null);
          }}
        />
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
                    else setArtifact({ ...result.value, nodeId: selected.id });
                  }}
                >
                  <FileText size={14} />
                  {artifact ? "Reload artifact" : `Read ${selected.artifactPath}`}
                </button>
                {artifact?.nodeId === selected.id && (
                  <>
                    <pre className="workflow-artifact">{artifact.content}</pre>
                    {state.status === "awaiting-approval" && (
                      <div className="workflow-row">
                        <button
                          className="workflow-button is-primary"
                          disabled={busy}
                          onClick={() => void act("approve", selected.id)}
                        >
                          <Check size={14} />
                          Approve
                        </button>
                        <button
                          className="workflow-button"
                          disabled={busy}
                          onClick={() => void act("revise", selected.id)}
                        >
                          Request revision
                        </button>
                      </div>
                    )}
                  </>
                )}
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
                      else setArtifact({ ...result.value, nodeId: selected.id });
                    }}
                  >
                    <FileText size={12} /> {path}
                  </button>
                ))}
              </section>
            )}
            {selected.kind !== "approval" && artifact?.nodeId === selected.id && (
              <pre className="workflow-artifact">{artifact.content}</pre>
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
