"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type UnitChartItem = {
  label: string;
  value: number;
  color?: string;
};

export function UnitChart({
  items,
  unitsPerRow = 10,
  title,
}: {
  items: UnitChartItem[];
  unitsPerRow?: number;
  title?: string;
}) {
  if (!items.length) return null;

  const MAX_RENDERED_UNITS = 1000;
  const unitSize = 14;
  const gap = 4;
  const maxUnits = clamp(Math.max(...items.map((item) => Math.max(0, Math.round(item.value))), 1), 1, MAX_RENDERED_UNITS);
  const rows = Math.max(1, Math.ceil(maxUnits / unitsPerRow));
  const W = 640;
  const H = Math.max(180, 36 + items.length * (rows * (unitSize + gap) + 16));
  const startX = 160;
  const startY = title ? 34 : 18;

  return (
    <figure className="chart unit-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Unit chart"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {items.map((item, rowIndex) => {
          const units = clamp(Math.round(item.value), 0, MAX_RENDERED_UNITS);
          const color = item.color || CHART_PALETTE[rowIndex % CHART_PALETTE.length];
          const yOffset = startY + rowIndex * (rows * (unitSize + gap) + 16);
          return (
            <g key={`${item.label}-${rowIndex}`}>
              <text x={startX - 10} y={yOffset + 12} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {item.label}
              </text>
              {Array.from({ length: units }, (_, idx) => {
                const col = idx % unitsPerRow;
                const row = Math.floor(idx / unitsPerRow);
                const x = startX + col * (unitSize + gap);
                const y = yOffset + row * (unitSize + gap);
                return <rect key={idx} x={x} y={y} width={unitSize} height={unitSize} rx="3" fill={color} opacity="0.86" />;
              })}
              <text x={startX + unitsPerRow * (unitSize + gap) + 12} y={yOffset + 12} fontSize="9.5" fill="var(--text-secondary)" className="mono">
                {formatNumber(item.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

