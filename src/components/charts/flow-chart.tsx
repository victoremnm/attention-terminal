"use client";

import { CHART_PALETTE, formatNumber } from "./shared";

export type FlowNode = {
  id: string;
  label: string;
  kind?: "start" | "process" | "decision" | "input" | "output";
};

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};

export function FlowChart({ nodes, edges, title }: { nodes: FlowNode[]; edges?: FlowEdge[]; title?: string }) {
  if (!nodes.length) return null;

  const W = 640;
  const H = Math.max(180, 54 + nodes.length * 70);
  const centerX = W / 2;
  const nodeW = 160;
  const nodeH = 40;
  const orderedNodes = [...nodes];
  const nodeY = new Map<string, number>();
  orderedNodes.forEach((node, idx) => nodeY.set(node.id, 42 + idx * 70));
  const lineEdges: FlowEdge[] = edges?.length
    ? edges
    : orderedNodes.slice(0, -1).map((node, idx) => ({ from: node.id, to: orderedNodes[idx + 1].id, label: undefined }));

  const shape = (node: FlowNode) => {
    const y = nodeY.get(node.id) ?? 0;
    const fill = CHART_PALETTE[nodes.indexOf(node) % CHART_PALETTE.length];
    const baseProps = { fill, fillOpacity: 0.22, stroke: "var(--axis-stroke)", strokeWidth: "1.4" as const };
    if (node.kind === "decision") {
      return <polygon points={`${centerX},${y - 22} ${centerX + 44},${y} ${centerX},${y + 22} ${centerX - 44},${y}`} {...baseProps} />;
    }
    if (node.kind === "input" || node.kind === "output") {
      return <polygon points={`${centerX - 52},${y - 20} ${centerX + 44},${y - 20} ${centerX + 52},${y + 20} ${centerX - 44},${y + 20}`} {...baseProps} />;
    }
    return <rect x={centerX - nodeW / 2} y={y - nodeH / 2} width={nodeW} height={nodeH} rx="12" {...baseProps} />;
  };

  return (
    <figure className="chart flow-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Flow chart"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {lineEdges.map((edge, idx) => {
          const fromY = nodeY.get(edge.from) ?? 0;
          const toY = nodeY.get(edge.to) ?? 0;
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={`${edge.from}-${edge.to}-${idx}`}>
              <line x1={centerX} y1={fromY + 22} x2={centerX} y2={toY - 22} stroke="var(--grid-line)" strokeWidth="1.3" markerEnd="url(#flow-arrow)" />
          {edge.label && (
            <text x={centerX + 10} y={(fromY + toY) / 2} fontSize="9" fill={color} className="mono">
              {edge.label}
            </text>
          )}
            </g>
          );
        })}
        <defs>
          <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--grid-line)" />
          </marker>
        </defs>
        {orderedNodes.map((node, idx) => {
          const y = nodeY.get(node.id) ?? 0;
          const fill = CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={node.id}>
              {shape(node)}
              <text x={centerX} y={y + 4} fontSize="10" fontWeight="700" fill="var(--ink)" textAnchor="middle" className="mono">
                {node.label}
              </text>
              <text x={centerX} y={y + 22} fontSize="8.5" fill="var(--text-secondary)" textAnchor="middle" className="mono">
                {node.kind || "process"} · {formatNumber(idx + 1)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
