"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type BoxplotItem = {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  color?: string;
};

export function BoxplotChart({ items, title }: { items: BoxplotItem[]; title?: string }) {
  if (!items.length) return null;

  const W = 640;
  const H = Math.max(180, 36 + items.length * 36);
  const padL = 120;
  const padR = 24;
  const padT = title ? 30 : 16;
  const values = items.flatMap((item) => [item.min, item.q1, item.median, item.q3, item.max]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const x = (value: number) => padL + clamp((value - min) / span, 0, 1) * (W - padL - padR);

  return (
    <figure className="chart boxplot-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Boxplot"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {items.map((item, idx) => {
          const y = padT + idx * 36;
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={`${item.label}-${idx}`}>
              <text x={padL - 10} y={y + 4} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {item.label}
              </text>
              <line x1={x(item.min)} x2={x(item.max)} y1={y} y2={y} stroke="var(--axis-stroke)" strokeWidth="1.4" />
              <rect x={x(item.q1)} y={y - 10} width={Math.max(3, x(item.q3) - x(item.q1))} height={20} fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5" rx="3" />
              <line x1={x(item.median)} x2={x(item.median)} y1={y - 10} y2={y + 10} stroke={color} strokeWidth="2.2" />
              <circle cx={x(item.min)} cy={y} r="2.6" fill={color} />
              <circle cx={x(item.max)} cy={y} r="2.6" fill={color} />
              <text x={x(item.max) + 8} y={y + 4} fontSize="9.5" fill="var(--text-secondary)" className="mono">
                {formatNumber(item.min)} · {formatNumber(item.q1)} · {formatNumber(item.median)} · {formatNumber(item.q3)} · {formatNumber(item.max)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

