"use client";

import { CHART_PALETTE, formatNumber } from "./shared";

export type DotPlotItem = {
  label: string;
  value: number;
  color?: string;
};

export function DotPlot({ items, title }: { items: DotPlotItem[]; title?: string }) {
  if (!items.length) return null;

  const W = 640;
  const H = Math.max(180, 36 + items.length * 26);
  const padL = 150;
  const padR = 24;
  const padT = title ? 30 : 14;
  const padB = 18;
  const max = Math.max(...items.map((item) => item.value), 1);
  const x = (value: number) => padL + (value / max) * (W - padL - padR);

  return (
    <figure className="chart dot-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Dot plot"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        <line x1={padL} x2={W - padR} y1={padT - 2} y2={padT - 2} stroke="var(--grid-line)" strokeWidth="1" />
        {items.map((item, idx) => {
          const y = padT + idx * 26;
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={`${item.label}-${idx}`}>
              <line x1={padL} x2={x(item.value)} y1={y} y2={y} stroke="var(--line-soft)" strokeWidth="1" />
              <circle cx={x(item.value)} cy={y} r="5.5" fill={color} stroke="var(--s)" strokeWidth="1.5" />
              <text x={padL - 10} y={y + 4} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {item.label}
              </text>
              <text x={x(item.value) + 10} y={y + 4} fontSize="9.5" fill="var(--text-secondary)" className="mono">
                {formatNumber(item.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

