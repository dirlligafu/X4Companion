import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import type { ResearchEntry } from "@/types/save";

const NODE_W = 190;
const NODE_H = 56;

function cleanName(name: string | null): string {
  if (!name) return "—";
  return name
    .replace(/\(same as \{[^}]+\}\)/g, "")
    .replace(/^\([^)]+\)/, "")
    .trim();
}

type NodeStatus = "completed" | "pending" | "available" | "locked";

type ResearchNodeData = {
  entry: ResearchEntry;
  status: NodeStatus;
};

type ResearchFlowNode = Node<ResearchNodeData, "research">;

const STATUS_STYLES: Record<NodeStatus, { border: string; background: string; color: string; opacity?: number }> = {
  completed: { border: "2px solid #16a34a", background: "rgba(34,197,94,0.1)",  color: "inherit" },
  pending:   { border: "2px solid #4ade80", background: "rgba(74,222,128,0.1)", color: "inherit" },
  available: { border: "2px solid #3b82f6", background: "rgba(59,130,246,0.05)", color: "inherit" },
  locked:    { border: "2px solid #444",    background: "transparent",          color: "inherit", opacity: 0.45 },
};

function ResearchNodeComponent({ data }: NodeProps<ResearchFlowNode>) {
  const { entry, status } = data;
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.locked;

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        border: s.border,
        background: s.background,
        opacity: s.opacity,
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 11,
        overflow: "hidden",
        boxSizing: "border-box",
        cursor: (status === "available" || status === "pending") ? "pointer" : "default",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {cleanName(entry.name) || entry.id}
      </div>
      {entry.dlc !== "vanilla" && (
        <div style={{ fontSize: 9, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {entry.dlc.replace(/_/g, " ")}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { research: ResearchNodeComponent };

type Props = {
  researchCatalog: ResearchEntry[];
  completedResearch: string[];
  pendingResearch: Set<string>;
  toggleResearch: (id: string) => void;
};

export function ResearchTreeView({ researchCatalog, completedResearch, pendingResearch, toggleResearch }: Props) {
  const visibleCatalog = useMemo(
    () => researchCatalog.filter(e => !e.missiononly),
    [researchCatalog]
  );

  const catalogMap = useMemo(
    () => new Map(researchCatalog.map(e => [e.id, e])),
    [researchCatalog]
  );

  const { positions, edges } = useMemo(() => {
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 130, marginx: 40, marginy: 40 });

    for (const e of visibleCatalog) {
      g.setNode(e.id, { width: NODE_W, height: NODE_H });
    }
    for (const e of visibleCatalog) {
      for (const prereq of e.prerequisites) {
        if (g.hasNode(prereq)) g.setEdge(prereq, e.id);
      }
    }

    Dagre.layout(g);

    const positions: Record<string, { x: number; y: number }> = {};
    for (const e of visibleCatalog) {
      const n = g.node(e.id);
      positions[e.id] = { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 };
    }

    const edges: Edge[] = [];
    for (const e of visibleCatalog) {
      for (const prereq of e.prerequisites) {
        if (g.hasNode(prereq)) {
          edges.push({
            id: `${prereq}->${e.id}`,
            source: prereq,
            target: e.id,
            type: "smoothstep",
            style: { strokeWidth: 1.5, opacity: 0.4 },
          });
        }
      }
    }

    return { positions, edges };
  }, [visibleCatalog]);

  const nodes = useMemo((): ResearchFlowNode[] => {
    const completedSet = new Set(completedResearch);
    const allUnlocked = new Set([...completedResearch, ...pendingResearch]);

    function status(e: ResearchEntry): NodeStatus {
      if (completedSet.has(e.id)) return "completed";
      if (pendingResearch.has(e.id)) return "pending";
      const blocking = e.prerequisites.filter(p => !catalogMap.get(p)?.missiononly);
      if (blocking.every(p => allUnlocked.has(p))) return "available";
      return "locked";
    }

    return visibleCatalog.map(e => ({
      id: e.id,
      type: "research" as const,
      position: positions[e.id] ?? { x: 0, y: 0 },
      data: { entry: e, status: status(e) },
    }));
  }, [visibleCatalog, catalogMap, positions, completedResearch, pendingResearch]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: ResearchFlowNode) => {
      const { status } = node.data;
      if (status === "available" || status === "pending") {
        toggleResearch(node.id);
      }
    },
    [toggleResearch]
  );

  return (
    <div
      className="flex-1 min-h-0 rounded-md border overflow-hidden"
      style={{
        height: "100%",
        "--xy-controls-button-background-color": "hsl(var(--card))",
        "--xy-controls-button-background-color-hover": "hsl(var(--muted))",
        "--xy-controls-button-color": "hsl(var(--foreground))",
        "--xy-controls-button-color-hover": "hsl(var(--foreground))",
        "--xy-controls-button-border-color": "hsl(var(--border))",
        "--xy-background-color": "hsl(var(--card))",
        "--xy-background-pattern-color": "hsl(var(--muted-foreground) / 0.15)",
      } as React.CSSProperties}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="system"
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
