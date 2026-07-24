"use client";

import { CHART_PALETTE, clamp, formatNumber, humanizeKey } from "./shared";

export type SpiderSeries = {
  label: string;
  values: number[];
  color?: string;
};

export function SpiderChart({
  axes,
  series,
  title,
}: {
  axes: string[];
  series: SpiderSeries[];
  title?: string;
}) {
  if (!axes.length || !series.length) return null;

  const W = 640;
  const H = 320;
  const cx = 240;
  const cy = 160;
  const radius = 108;
  const layers = 4;
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values.map((value) => Math.max(0, value))));

  const pointAtDistance = (index: number, distance: number) => {
    const angle = (index / axes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * distance,
      y: cy + Math.sin(angle) * distance,
    };
  };

  const pointFor = (index: number, value: number) => {
    const distance = (clamp(value, 0, maxValue) / maxValue) * radius;
    return pointAtDistance(index, distance);
  };

  return (
    <figure className="chart spider-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Spider chart"}>
        {title && (
          <text x={24} y={22} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}

        {Array.from({ length: layers }, (_, layerIndex) => {
          const ring = ((layerIndex + 1) / layers) * radius;
          const points = axes
            .map((_, axisIndex) => pointAtDistance(axisIndex, ring))
            .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(" ");
          return <polygon key={`ring-${layerIndex}`} points={points} fill="none" stroke="var(--grid-line)" strokeWidth="1" opacity="0.9" />;
        })}

        {axes.map((axis, axisIndex) => {
          const end = pointFor(axisIndex, maxValue);
          const labelPoint = pointFor(axisIndex, maxValue + 12);
          return (
            <g key={axis}>
              <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="var(--axis-stroke)" strokeWidth="1" opacity="0.8" />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                fontSize="9.5"
                fill="var(--text-secondary)"
                textAnchor={labelPoint.x < cx - 4 ? "end" : labelPoint.x > cx + 4 ? "start" : "middle"}
                className="mono"
              >
                {humanizeKey(axis)}
              </text>
            </g>
          );
        })}

        {series.map((item, idx) => {
          const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          const points = axes.map((_, axisIndex) => pointFor(axisIndex, item.values[axisIndex] ?? 0));
          const path = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
          return (
            <g key={`${item.label}-${idx}`}>
              <polygon points={path} fill={color} fillOpacity="0.16" stroke={color} strokeWidth="2" />
              {points.map((point, pointIndex) => (
                <circle key={`${item.label}-${pointIndex}`} cx={point.x} cy={point.y} r="2.5" fill={color} />
              ))}
            </g>
          );
        })}

        <g transform="translate(380, 42)">
          {series.slice(0, 6).map((item, idx) => {
            const color = item.color || CHART_PALETTE[idx % CHART_PALETTE.length];
            return (
              <g key={`${item.label}-${idx}`} transform={`translate(0, ${idx * 20})`}>
                <rect x={0} y={-9} width={11} height={11} rx={2} fill={color} opacity="0.85" />
                <text x={18} y={0} fontSize="10.5" fill="var(--ink)" className="mono">
                  {item.label}
                </text>
              </g>
            );
          })}
        </g>

        <text x={24} y={H - 18} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          axes: {axes.length} · max {formatNumber(maxValue)}
        </text>
      </svg>
    </figure>
  );
}

