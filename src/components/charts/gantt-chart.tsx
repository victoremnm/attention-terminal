"use client";

import { CHART_PALETTE, formatNumber, parseDateLike } from "./shared";

export type GanttItem = {
  label: string;
  start: string | Date;
  end: string | Date;
  lane?: string;
  color?: string;
};

export function GanttChart({ items, title }: { items: GanttItem[]; title?: string }) {
  if (!items.length) return null;

  const W = 640;
  const laneMap = new Map<string, number>();
  items.forEach((item) => {
    const lane = item.lane || item.label;
    if (!laneMap.has(lane)) laneMap.set(lane, laneMap.size);
  });

  const times = items
    .flatMap((item) => [parseDateLike(item.start), parseDateLike(item.end)])
    .filter((value): value is number => value !== null);
  if (!times.length) return null;

  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min || 1;
  const rowH = 26;
  const padT = title ? 30 : 16;
  const padB = 20;
  const padL = 120;
  const H = padT + laneMap.size * rowH + padB;
  const x = (value: string | Date) => padL + ((parseDateLike(value) ?? min) - min) / span * (W - padL - 24);

  return (
    <figure className="chart gantt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Gantt chart"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {Array.from(laneMap.entries()).map(([lane, rowIndex]) => {
          const y = padT + rowIndex * rowH;
          return (
            <g key={lane}>
              <rect x={padL} y={y - 12} width={W - padL - 24} height={rowH - 2} fill="var(--grid-line)" opacity="0.2" rx="4" />
              <text x={padL - 10} y={y + 4} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {lane}
              </text>
            </g>
          );
        })}
        {items.map((item, idx) => {
          const lane = item.lane || item.label;
          const rowIndex = laneMap.get(lane) ?? idx;
          const y = padT + rowIndex * rowH - 10;
          const startX = x(item.start);
          const endX = x(item.end);
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={`${item.label}-${idx}`}>
              <rect x={startX} y={y} width={Math.max(4, endX - startX)} height={14} fill={color} opacity="0.85" rx="4" />
              <text x={endX + 6} y={y + 11} fontSize="9.5" fill="var(--text-secondary)" className="mono">
                {formatNumber((parseDateLike(item.end) ?? 0) - (parseDateLike(item.start) ?? 0))}
              </text>
            </g>
          );
        })}
        <text x={padL} y={H - 8} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          timeline span: {new Date(min).toISOString().slice(0, 10)} → {new Date(max).toISOString().slice(0, 10)}
        </text>
      </svg>
    </figure>
  );
}

