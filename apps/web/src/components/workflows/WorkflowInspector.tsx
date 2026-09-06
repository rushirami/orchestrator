import { randomUUID } from "../../lib/utils";
import type { WorkflowDefinition, WorkflowNode } from "@t3tools/contracts";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

function ArtifactPathsInput({
  paths,
  onChange,
}: {
  paths: readonly string[];
  onChange: (paths: string[]) => void;
}) {
  const [text, setText] = useState(paths.join(", "));
  return (
    <input
      placeholder="spec.md, validation.md"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(
          event.target.value
            .split(",")
            .map((path) => path.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

export function WorkflowField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="workflow-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function WorkflowInspector({
  definition,
  node,
  onChange,
  onSelect,
}: {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  onChange: (definition: WorkflowDefinition) => void;
  onSelect: (id: string | null) => void;
}) {
  const update = (next: WorkflowNode) =>
    onChange({
      ...definition,
      nodes: definition.nodes.map((item) => (item.id === node.id ? next : item)),
    });
  const addThread = () => {
    if (node.kind !== "agent" || !definition.threads[0]) return;
    const id = randomUUID();
    const thread = { ...definition.threads[0], id, name: `Agent ${definition.threads.length + 1}` };
    onChange({
      ...definition,
      threads: [...definition.threads, thread],
      nodes: definition.nodes.map((item) =>
        item.id === node.id ? { ...node, threadId: id } : item,
      ),
    });
  };
  return (
    <aside className="workflow-inspector" key={node.id} aria-label="Stage settings">
      <h2>{node.name}</h2>
      <WorkflowField label="Stage name">
        <input
          value={node.name}
          onChange={(event) => update({ ...node, name: event.target.value })}
        />
      </WorkflowField>
      <WorkflowField label="Stage type">
        <select
          value={node.kind}
          onChange={(event) => {
            const common = { id: node.id, name: node.name, position: node.position };
            if (event.target.value === "join") update({ ...common, kind: "join" });
            if (event.target.value === "approval")
              update({
                ...common,
                kind: "approval",
                artifactPath: "spec.md",
                revisionTarget:
                  definition.nodes.find((item) => item.kind === "agent" && item.id !== node.id)
                    ?.id ?? "",
              });
            if (event.target.value === "agent")
              update({
                ...common,
                kind: "agent",
                threadId: definition.threads[0]?.id ?? "",
                access: "read-only",
                skills: [
                  {
                    id: randomUUID(),
                    prompt: "Describe what this stage should do.",
                    outputPaths: [],
                  },
                ],
              });
          }}
        >
          <option value="agent">Agent task</option>
          <option value="approval">Human approval</option>
          <option value="join">Join branches</option>
        </select>
      </WorkflowField>
      {node.kind === "agent" && (
        <>
          <WorkflowField label="Agent thread">
            <select
              value={node.threadId}
              onChange={(event) => update({ ...node, threadId: event.target.value })}
            >
              {definition.threads.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.name}
                </option>
              ))}
            </select>
            <small>Reuse a thread to preserve its conversation.</small>
          </WorkflowField>
          <button className="workflow-button" onClick={addThread}>
            <Plus size={14} />
            New agent thread
          </button>
          <WorkflowField label="Worktree access">
            <select
              value={node.access}
              onChange={(event) =>
                update({ ...node, access: event.target.value === "write" ? "write" : "read-only" })
              }
            >
              <option value="read-only">Read only · Can run in parallel</option>
              <option value="write">Read and write · Runs exclusively</option>
            </select>
          </WorkflowField>
          <div className="workflow-divider">
            <strong>Skills · Run in order</strong>
            {node.skills.map((skill, index) => (
              <section key={skill.id} className="workflow-divider">
                <div className="workflow-row">
                  <strong>Skill {index + 1}</strong>
                  <button
                    aria-label={`Move skill ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => {
                      const skills = [...node.skills];
                      [skills[index - 1], skills[index]] = [skills[index]!, skills[index - 1]!];
                      update({ ...node, skills });
                    }}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={`Move skill ${index + 1} down`}
                    disabled={index === node.skills.length - 1}
                    onClick={() => {
                      const skills = [...node.skills];
                      [skills[index + 1], skills[index]] = [skills[index]!, skills[index + 1]!];
                      update({ ...node, skills });
                    }}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label={`Remove skill ${index + 1}`}
                    onClick={() =>
                      update({
                        ...node,
                        skills: node.skills.filter((item) => item.id !== skill.id),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <WorkflowField label="Skill instructions">
                  <textarea
                    value={skill.prompt}
                    onChange={(event) =>
                      update({
                        ...node,
                        skills: node.skills.map((item) =>
                          item.id === skill.id ? { ...item, prompt: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </WorkflowField>
                <WorkflowField label="Required artifacts">
                  <ArtifactPathsInput
                    paths={skill.outputPaths}
                    onChange={(paths) =>
                      update({
                        ...node,
                        skills: node.skills.map((item) =>
                          item.id === skill.id
                            ? {
                                ...item,
                                outputPaths: paths,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <small>Paths relative to this task's worktree.</small>
                </WorkflowField>
              </section>
            ))}
            <button
              className="workflow-button"
              onClick={() =>
                update({
                  ...node,
                  skills: [
                    ...node.skills,
                    {
                      id: randomUUID(),
                      prompt: "Describe the next skill.",
                      outputPaths: [],
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              Add skill
            </button>
          </div>
        </>
      )}
      {node.kind === "approval" && (
        <>
          <WorkflowField label="Artifact to approve">
            <input
              value={node.artifactPath}
              onChange={(event) => update({ ...node, artifactPath: event.target.value })}
            />
          </WorkflowField>
          <WorkflowField label="Return revisions to">
            <select
              value={node.revisionTarget}
              onChange={(event) => update({ ...node, revisionTarget: event.target.value })}
            >
              {definition.nodes
                .filter((item) => item.kind === "agent" && item.id !== node.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </WorkflowField>
        </>
      )}
      {node.kind === "join" && (
        <p className="workflow-help">
          Wait for every incoming branch to finish successfully. A failed or paused branch keeps
          this stage waiting.
        </p>
      )}
      <div className="workflow-divider">
        <strong>After this stage</strong>
        <p className="workflow-help">
          Select every stage to start next. Multiple selections create parallel branches.
        </p>
        {definition.nodes
          .filter((item) => item.id !== node.id)
          .map((item) => (
            <label className="workflow-row" key={item.id}>
              <input
                type="checkbox"
                checked={definition.edges.some(
                  (edge) => edge.from === node.id && edge.to === item.id,
                )}
                onChange={(event) =>
                  onChange({
                    ...definition,
                    edges: event.target.checked
                      ? [...definition.edges, { from: node.id, to: item.id }]
                      : definition.edges.filter(
                          (edge) => edge.from !== node.id || edge.to !== item.id,
                        ),
                  })
                }
              />
              <span>{item.name}</span>
            </label>
          ))}
      </div>
      <div className="workflow-divider">
        <button
          className="workflow-button"
          onClick={() => {
            onChange({
              ...definition,
              nodes: definition.nodes.filter((item) => item.id !== node.id),
              edges: definition.edges.filter(
                (edge) => edge.from !== node.id && edge.to !== node.id,
              ),
              rework:
                definition.rework?.from === node.id || definition.rework?.to === node.id
                  ? null
                  : definition.rework,
            });
            onSelect(null);
          }}
        >
          <Trash2 size={14} />
          Remove stage
        </button>
      </div>
    </aside>
  );
}
