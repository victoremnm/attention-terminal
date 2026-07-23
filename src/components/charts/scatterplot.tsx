"use client";

import { CHART_PALETTE, clamp, formatNumber } from "./shared";

export type ScatterPoint = {
  x: number;
  y: number;
  label?: string;
  color?: string;
};

export function Scatterplot({
  points,
  xLabel = "x",
  yLabel = "y",
  title,
}: {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  title?: string;
}) {
  if (!points.length) return null;

  const W = 640;
  const H = 320;
  const padL = 52;
  const padR = 24;
  const padT = title ? 34 : 20;
  const padB = 34;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const x = (value: number) => padL + clamp((value - minX) / spanX, 0, 1) * (W - padL - padR);
  const y = (value: number) => padT + (1 - clamp((value - minY) / spanY, 0, 1)) * (H - padT - padB);

  return (
    <figure className="chart scatterplot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Scatterplot"}>
        {title && (
          <text x={24} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {[0, 0.5, 1].map((tick) => {
          const yPos = padT + tick * (H - padT - padB);
          const value = maxY - tick * spanY;
          return (
            <g key={tick}>
              <line x1={padL} x2={W - padR} y1={yPos} y2={yPos} stroke="var(--grid-line)" strokeWidth="1" />
              <text x={padL - 8} y={yPos + 3} fontSize="9" fill="var(--text-secondary)" textAnchor="end" className="mono">
                {formatNumber(value)}
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--axis-stroke)" strokeWidth="1" />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="var(--axis-stroke)" strokeWidth="1" />
        <text x={W - padR} y={H - 10} fontSize="9.5" fill="var(--text-secondary)" textAnchor="end" className="mono">
          {xLabel}
        </text>
        <text x={12} y={padT + 8} fontSize="9.5" fill="var(--text-secondary)" className="mono">
          {yLabel}
        </text>
        {points.map((point, idx) => {
          const color = point.color || CHART_PALETTE[idx % CHART_PALETTE.length];
          const cx = x(point.x);
          const cy = y(point.y);
          return (
            <g key={`${point.label ?? idx}-${idx}`}>
              <circle cx={cx} cy={cy} r="4.5" fill={color} fillOpacity="0.82" stroke="var(--s)" strokeWidth="1.4" />
              {point.label && (
                <text x={cx + 6} y={cy - 6} fontSize="9" fill="var(--ink)" className="mono">
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

