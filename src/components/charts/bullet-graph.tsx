"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type BulletGraphItem = {
  label: string;
  value: number;
  target: number;
  ranges?: [number, number, number];
  color?: string;
};

export function BulletGraph({ items, title }: { items: BulletGraphItem[]; title?: string }) {
  if (!items.length) return null;

  const W = 640;
  const H = Math.max(140, 28 + items.length * 34);
  const padL = 140;
  const padR = 28;
  const padT = title ? 30 : 16;
  const barH = 16;
  const rangeMax = Math.max(
    ...items.flatMap((item) => [item.value, item.target, ...(item.ranges ?? [])]),
    1,
  );
  const x = (value: number) => padL + (clamp(value, 0, rangeMax) / rangeMax) * (W - padL - padR);

  return (
    <figure className="chart bullet-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Bullet graph"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {items.map((item, idx) => {
          const y = padT + idx * 34;
          const [low = rangeMax * 0.4, mid = rangeMax * 0.75, high = rangeMax] = item.ranges ?? [];
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <g key={`${item.label}-${idx}`}>
              <text x={padL - 10} y={y + 12} fontSize="9.5" fill="var(--ink)" textAnchor="end" className="mono">
                {item.label}
              </text>
              <rect x={padL} y={y} width={x(high) - padL} height={barH} fill="var(--grid-line)" opacity="0.5" rx="4" />
              <rect x={padL} y={y} width={x(mid) - padL} height={barH} fill="var(--grid-line)" opacity="0.35" rx="4" />
              <rect x={padL} y={y} width={x(low) - padL} height={barH} fill="var(--grid-line)" opacity="0.2" rx="4" />
              <rect x={padL} y={y + 4} width={x(item.value) - padL} height={barH - 8} fill={color} opacity="0.9" rx="3" />
              <line x1={x(item.target)} x2={x(item.target)} y1={y - 2} y2={y + barH + 2} stroke="var(--text-primary)" strokeWidth="2" />
              <text x={x(item.value) + 8} y={y + 12} fontSize="9.5" fill="var(--text-secondary)" className="mono">
                {formatNumber(item.value)} / {formatNumber(item.target)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

