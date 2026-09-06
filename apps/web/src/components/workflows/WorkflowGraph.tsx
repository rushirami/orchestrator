import type { WorkflowDefinition, WorkflowNode, WorkflowNodeState } from "@t3tools/contracts";
import { Check, GitBranch, GripVertical, LockKeyhole, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./workflows.css";

const EMPTY_STATES: readonly WorkflowNodeState[] = [];
const NODE_WIDTH = 260;
const NODE_HEIGHT = 86;

export function arrangeWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  const depth = new Map<string, number>();
  for (let pass = 0; pass < definition.nodes.length; pass++) {
    for (const node of definition.nodes) {
      const parents = definition.edges.filter((edge) => edge.to === node.id);
      if (parents.every((edge) => depth.has(edge.from))) {
        depth.set(node.id, Math.max(-1, ...parents.map((edge) => depth.get(edge.from)!)) + 1);
      }
    }
  }
  const levels = new Map<number, string[]>();
  for (const node of definition.nodes) {
    const level = depth.get(node.id) ?? 0;
    levels.set(level, [...(levels.get(level) ?? []), node.id]);
  }
  const widest = Math.max(1, ...Array.from(levels.values(), (items) => items.length));
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const level = depth.get(node.id) ?? 0;
      const peers = levels.get(level)!;
      return {
        ...node,
        position: {
          x: 40 + (widest - peers.length) * 150 + peers.indexOf(node.id) * 300,
          y: 40 + level * 134,
        },
      };
    }),
  };
}

export function WorkflowGraph({
  definition,
  selectedId,
  onSelect,
  onChange,
  states = EMPTY_STATES,
  fitToView = false,
}: {
  definition: WorkflowDefinition;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange?: (definition: WorkflowDefinition) => void;
  states?: readonly WorkflowNodeState[];
  fitToView?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [dragged, setDragged] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(
    null,
  );
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom((value) => Math.max(0.35, Math.min(1.8, value - event.deltaY * 0.002)));
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const nodes = useMemo(
    () =>
      definition.nodes.map((node) =>
        dragged?.id === node.id ? { ...node, position: { x: dragged.x, y: dragged.y } } : node,
      ),
    [definition.nodes, dragged],
  );
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const width = Math.max(640, ...nodes.map((node) => node.position.x + NODE_WIDTH + 40));
  const height = Math.max(500, ...nodes.map((node) => node.position.y + NODE_HEIGHT + 50));
  useEffect(() => {
    if (!fitToView) return;
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds)
      setZoom(
        Math.max(0.35, Math.min(1, (bounds.width - 30) / width, (bounds.height - 82) / height)),
      );
  }, [fitToView, width, height]);
  const moveNode = (id: string, x: number, y: number) =>
    onChange?.({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === id ? { ...node, position: { x: Math.max(0, x), y: Math.max(0, y) } } : node,
      ),
    });
  const fit = () => {
    const bounds = viewport.current?.getBoundingClientRect();
    if (bounds) setZoom(Math.min(1, (bounds.width - 30) / width, (bounds.height - 82) / height));
  };
  return (
    <div className="workflow-graph" aria-label="Workflow graph">
      {onChange && nodes.length === 0 && (
        <div className="workflow-empty workflow-graph-empty">
          <strong>Build your workflow</strong>
          <p>Use Add stage to choose what happens first.</p>
        </div>
      )}
      <div className="workflow-graph-tools">
        {onChange && (
          <button onClick={() => onChange(arrangeWorkflow(definition))}>Arrange nodes</button>
        )}
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}
        >
          <Minus size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))}>
          <Plus size={14} />
        </button>
        <button aria-label="Fit workflow" onClick={fit}>
          <Maximize2 size={14} />
        </button>
      </div>
      <div
        className="workflow-graph-viewport"
        ref={viewport}
        tabIndex={0}
        aria-label="Pan workflow canvas with arrow keys or drag its background"
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button"))
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          if (!pan.current) return;
          event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
          event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
      >
        <div style={{ width: width * zoom, height: height * zoom, marginInline: "auto" }}>
          <div
            className="workflow-graph-plane"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            <svg width={width} height={height} className="workflow-edges" aria-hidden="true">
              {definition.edges.map((edge) => {
                const from = byId.get(edge.from);
                const to = byId.get(edge.to);
                if (!from || !to) return null;
                const x1 = from.position.x + NODE_WIDTH / 2;
                const y1 = from.position.y + NODE_HEIGHT;
                const x2 = to.position.x + NODE_WIDTH / 2;
                const y2 = to.position.y;
                const middle = (y1 + y2) / 2;
                const completed =
                  states.find((state) => state.nodeId === from.id)?.status === "complete";
                return (
                  <path
                    key={`${edge.from}:${edge.to}`}
                    className={completed ? "is-complete" : undefined}
                    d={`M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}`}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => {
              const state = states.find((entry) => entry.nodeId === node.id);
              return (
                <button
                  key={node.id}
                  className={`workflow-node ${selectedId === node.id ? "is-selected" : ""} ${dragged?.id === node.id ? "is-dragging" : ""}`}
                  style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)` }}
                  data-status={state?.status}
                  onClick={() => onSelect(node.id)}
                  onPointerDown={(event) => {
                    if (!onChange || event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                      id: node.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: node.position.x,
                      y: node.position.y,
                    };
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current;
                    if (!start || start.id !== node.id) return;
                    setDragged({
                      id: node.id,
                      x: Math.max(0, start.x + (event.clientX - start.startX) / zoom),
                      y: Math.max(0, start.y + (event.clientY - start.startY) / zoom),
                    });
                  }}
                  onPointerUp={() => {
                    if (dragged) moveNode(dragged.id, dragged.x, dragged.y);
                    drag.current = null;
                    setDragged(null);
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDragged(null);
                  }}
                  onKeyDown={(event) => {
                    const delta = {
                      ArrowLeft: [-10, 0],
                      ArrowRight: [10, 0],
                      ArrowUp: [0, -10],
                      ArrowDown: [0, 10],
                    }[event.key];
                    if (delta && onChange) {
                      event.preventDefault();
                      moveNode(node.id, node.position.x + delta[0]!, node.position.y + delta[1]!);
                    }
                  }}
                  aria-pressed={selectedId === node.id}
                  aria-label={`${node.name}${state ? `, ${state.status}` : ""}`}
                >
                  <span className="workflow-node-icon">
                    {state?.status === "complete" ? (
                      <Check size={16} />
                    ) : node.kind === "approval" ? (
                      <LockKeyhole size={16} />
                    ) : node.kind === "join" ? (
                      <GitBranch size={16} />
                    ) : (
                      <GripVertical size={16} />
                    )}
                  </span>
                  <span className="workflow-node-label">
                    <strong>{node.name}</strong>
                    <small>{nodeSubtitle(node, definition)}</small>
                  </span>
                  {state && (
                    <span className="workflow-node-status">
                      {state.status.replaceAll("-", " ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function nodeSubtitle(node: WorkflowNode, definition: WorkflowDefinition) {
  if (node.kind === "approval") return "Your approval · " + node.artifactPath;
  if (node.kind === "join") return "Wait for all incoming branches";
  return `${definition.threads.find((thread) => thread.id === node.threadId)?.name ?? "Choose a thread"} · ${node.skills.length} ${node.skills.length === 1 ? "skill" : "skills"}`;
}
