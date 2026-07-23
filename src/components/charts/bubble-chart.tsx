"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type BubblePoint = {
  x: number;
  y: number;
  size: number;
  label?: string;
  color?: string;
};

export function BubbleChart({
  points,
  xLabel = "x",
  yLabel = "y",
  title,
}: {
  points: BubblePoint[];
  xLabel?: string;
  yLabel?: string;
  title?: string;
}) {
  if (!points.length) return null;

  const sorted = [...points].sort((a, b) => b.size - a.size);
  const W = 640;
  const H = 320;
  const padL = 52;
  const padR = 24;
  const padT = title ? 34 : 20;
  const padB = 34;
  const xs = sorted.map((point) => point.x);
  const ys = sorted.map((point) => point.y);
  const maxSize = Math.max(...sorted.map((point) => Math.max(0, point.size)), 1);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const x = (value: number) => padL + clamp((value - minX) / spanX, 0, 1) * (W - padL - padR);
  const y = (value: number) => padT + (1 - clamp((value - minY) / spanY, 0, 1)) * (H - padT - padB);
  const radius = (size: number) => 4 + Math.sqrt(Math.max(0, size) / maxSize) * 22;

  return (
    <figure className="chart bubble-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Bubble chart"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--axis-stroke)" strokeWidth="1" />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="var(--axis-stroke)" strokeWidth="1" />
        <text x={W - padR} y={H - 10} fontSize="9.5" fill="var(--text-secondary)" textAnchor="end" className="mono">
          {xLabel}
        </text>
        <text x={12} y={padT + 8} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          {yLabel}
        </text>
        {sorted.map((point, idx) => {
          const color = point.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          const r = radius(point.size);
          const cx = x(point.x);
          const cy = y(point.y);
          return (
            <g key={`${point.label ?? idx}-${idx}`}>
              <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity="0.46" stroke={color} strokeWidth="1.5" />
              {point.label && (
                <text x={cx} y={cy + 3} fontSize="9" fill="var(--ink)" textAnchor="middle" className="mono">
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={24} y={H - 8} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          size max: {formatNumber(maxSize)}
        </text>
      </svg>
    </figure>
  );
}

