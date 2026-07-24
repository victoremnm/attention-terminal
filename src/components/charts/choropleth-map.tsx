"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type ChoroplethRegion = {
  id: string;
  label: string;
  value: number;
  path: string;
  color?: string;
};

export function ChoroplethMap({ regions, title }: { regions: ChoroplethRegion[]; title?: string }) {
  if (!regions.length) return null;

  const W = 640;
  const H = 320;
  const max = Math.max(...regions.map((region) => region.value), 1);
  const min = Math.min(...regions.map((region) => region.value), 0);
  const span = max - min || 1;
  const fill = (value: number) => {
    const ratio = clamp((value - min) / span, 0, 1);
    const cyan = 220 - Math.round(ratio * 80);
    const alpha = 0.18 + ratio * 0.55;
    return `rgba(${cyan}, ${240 - Math.round(ratio * 45)}, ${255}, ${alpha.toFixed(2)})`;
  };

  return (
    <figure className="chart choropleth-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Choropleth map"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {regions.map((region, idx) => (
          <g key={region.id}>
            <path d={region.path} fill={region.color || fill(region.value)} stroke="var(--axis-stroke)" strokeWidth="1" opacity="0.95" />
            <text x={24 + (idx % 3) * 120} y={H - 24 - Math.floor(idx / 3) * 14} fontSize="9" fill="var(--text-secondary)" className="mono">
              {region.label}: {formatNumber(region.value)}
            </text>
          </g>
        ))}
        <text x={24} y={H - 10} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          regions: {regions.length} · max {formatNumber(max)}
        </text>
      </svg>
    </figure>
  );
}

