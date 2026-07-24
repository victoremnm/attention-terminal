"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type SlopegraphItem = {
  label: string;
  start: number;
  end: number;
  color?: string;
};

export function Slopegraph({
  items,
  startLabel,
  endLabel,
  title,
}: {
  items: SlopegraphItem[];
  startLabel: string;
  endLabel: string;
  title?: string;
}) {
  if (!items.length) return null;

  const W = 640;
  const H = Math.max(200, 34 + items.length * 28);
  const padT = title ? 26 : 12;
  const padB = 24;
  const leftX = 150;
  const rightX = W - 150;
  const values = items.flatMap((item) => [item.start, item.end]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const y = (value: number) => padT + (1 - clamp((value - min) / span, 0, 1)) * (H - padT - padB);

  const sorted = [...items].sort((a, b) => (a.start + a.end) - (b.start + b.end));

  return (
    <figure className="chart slopegraph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Slopegraph"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        <text x={leftX} y={padT - 2} fontSize="10" fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" className="mono">
          {startLabel}
        </text>
        <text x={rightX} y={padT - 2} fontSize="10" fontWeight="700" fill="var(--text-secondary)" textAnchor="middle" className="mono">
          {endLabel}
        </text>
        <line x1={leftX} x2={rightX} y1={padT + 6} y2={padT + 6} stroke="var(--grid-line)" strokeWidth="1" />

        {sorted.map((item, idx) => {
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          const y1 = y(item.start);
          const y2 = y(item.end);
          const positive = item.end >= item.start;
          return (
            <g key={`${item.label}-${idx}`}>
              <line
                x1={leftX}
                y1={y1}
                x2={rightX}
                y2={y2}
                stroke={color}
                strokeWidth={positive ? 2.2 : 1.8}
                opacity={positive ? 0.9 : 0.7}
              />
              <circle cx={leftX} cy={y1} r="3.2" fill={color} />
              <circle cx={rightX} cy={y2} r="3.2" fill={color} />
              <text x={leftX - 10} y={y1 + 4} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {item.label}
              </text>
              <text x={rightX + 10} y={y2 + 4} fontSize="9.5" fill="var(--ink)" textAnchor="start" className="mono">
                {formatNumber(item.end)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

