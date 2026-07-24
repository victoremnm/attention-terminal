"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  color?: string;
};

export function SankeyDiagram({ links, title }: { links: SankeyLink[]; title?: string }) {
  if (!links.length) return null;

  const W = 640;
  const H = 320;
  const padT = title ? 34 : 20;
  const padB = 22;
  const leftX = 110;
  const rightX = W - 110;
  const maxValue = Math.max(...links.map((link) => link.value), 1);
  const nodes = Array.from(new Set([...links.map((link) => link.source), ...links.map((link) => link.target)]));
  const leftNodes = Array.from(new Set(links.map((link) => link.source)));
  const rightNodes = Array.from(new Set(links.map((link) => link.target)));
  const laneHeight = (H - padT - padB) / Math.max(1, Math.max(leftNodes.length, rightNodes.length));
  const nodeHeight = 16;

  const nodeY = (node: string, side: "left" | "right") => {
    const list = side === "left" ? leftNodes : rightNodes;
    const idx = list.indexOf(node);
    return padT + idx * laneHeight + laneHeight / 2;
  };

  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  links.forEach((link) => {
    sourceTotals.set(link.source, (sourceTotals.get(link.source) || 0) + link.value);
    targetTotals.set(link.target, (targetTotals.get(link.target) || 0) + link.value);
  });

  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();

  return (
    <figure className="chart sankey-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Sankey diagram"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}

        {links.map((link, idx) => {
          const color = link.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          const sourceY = nodeY(link.source, "left") + (sourceOffsets.get(link.source) || 0);
          const targetY = nodeY(link.target, "right") + (targetOffsets.get(link.target) || 0);
          const thickness = Math.max(2, (link.value / maxValue) * 22);
          sourceOffsets.set(link.source, (sourceOffsets.get(link.source) || 0) + thickness + 2);
          targetOffsets.set(link.target, (targetOffsets.get(link.target) || 0) + thickness + 2);
          const midX = (leftX + rightX) / 2;
          const d = [
            `M ${leftX} ${sourceY}`,
            `C ${midX} ${sourceY}, ${midX} ${targetY}, ${rightX} ${targetY}`,
            `L ${rightX} ${targetY + thickness}`,
            `C ${midX} ${targetY + thickness}, ${midX} ${sourceY + thickness}, ${leftX} ${sourceY + thickness}`,
            "Z",
          ].join(" ");

          return <path key={`${link.source}-${link.target}-${idx}`} d={d} fill={color} opacity="0.35" stroke="none" />;
        })}

        {leftNodes.map((node) => {
          const y = nodeY(node, "left");
          return (
            <g key={`left-${node}`}>
              <rect x={leftX - 22} y={y - nodeHeight / 2} width={16} height={nodeHeight} rx="4" fill="var(--text-primary)" />
              <text x={leftX - 28} y={y + 4} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {node}
              </text>
            </g>
          );
        })}

        {rightNodes.map((node) => {
          const y = nodeY(node, "right");
          return (
            <g key={`right-${node}`}>
              <rect x={rightX + 6} y={y - nodeHeight / 2} width={16} height={nodeHeight} rx="4" fill="var(--text-primary)" />
              <text x={rightX + 28} y={y + 4} fontSize="9.5" fill="var(--ink)" className="mono">
                {node}
              </text>
            </g>
          );
        })}

        <text x={24} y={H - 8} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          nodes: {nodes.length} · total flow {formatNumber(links.reduce((sum, link) => sum + link.value, 0))}
        </text>
      </svg>
    </figure>
  );
}

