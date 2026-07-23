"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export function WaffleChart({
  value,
  total = 100,
  label,
  title,
}: {
  value: number;
  total?: number;
  label?: string;
  title?: string;
}) {
  if (!Number.isFinite(value) || total <= 0) return null;

  const W = 640;
  const H = 250;
  const grid = 10;
  const cell = 18;
  const gap = 4;
  const startX = 24;
  const startY = title ? 40 : 20;
  const filled = clamp(Math.round((value / total) * 100), 0, 100);

  return (
    <figure className="chart waffle-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Waffle chart"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {Array.from({ length: 100 }, (_, idx) => {
          const row = Math.floor(idx / grid);
          const col = idx % grid;
          const x = startX + col * (cell + gap);
          const y = startY + (grid - 1 - row) * (cell + gap);
          const isFilled = idx < filled;
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx="3"
              fill={isFilled ? color : "var(--grid-line)"}
              opacity={isFilled ? 0.9 : 0.22}
            />
          );
        })}
        <text x={260} y={92} fontSize="26" fontWeight="800" fill="var(--ink)" textAnchor="middle" className="mono">
          {filled}%
        </text>
        <text x={260} y={112} fontSize="10" fill="var(--text-secondary)" textAnchor="middle" className="mono">
          {label || `${formatNumber(value)} of ${formatNumber(total)}`}
        </text>
      </svg>
    </figure>
  );
}
