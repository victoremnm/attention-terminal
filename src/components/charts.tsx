"use client";

import type { DevPoint } from "@/lib/render-payload";

// Hand-rolled SVG charts per the wireframes - no chart libraries.
// Cyan = talk/HN, magenta = code/GitHub, muted grid, tabular numerals.

export function Sparkline({ data, color = "var(--cyan)", w = 64, h = 18, label }: {
  data: number[]; color?: string; w?: number; h?: number; label?: string;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const x = (i: number) => ((i / (data.length - 1)) * (w - 2) + 1).toFixed(1);
  const y = (v: number) => (h - 2 - (v / max) * (h - 4)).toFixed(1);
  const pts = data
    .map((v, i) => `${x(i)},${y(v)}`)
    .join(" ");
  const attrs = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} {...attrs}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle
          key={`${i}-${v}`}
          cx={x(i)}
          cy={y(v)}
          r={i === data.length - 1 ? 1.8 : 1.5}
          fill={color}
          opacity={i === data.length - 1 ? 1 : 0.75}
        />
      ))}
    </svg>
  );
}

function axisDays(days: string[], n = 4): { i: number; label: string }[] {
  const step = Math.max(1, Math.floor((days.length - 1) / (n - 1)));
  const out: { i: number; label: string }[] = [];
  for (let i = 0; i < days.length; i += step) out.push({ i, label: days[i].slice(5).replace("-", "/") });
  return out;
}

export function DualLine({ days, a, b, aLabel, bLabel }: {
  days: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string;
}) {
  const W = 640, H = 200, padL = 8, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const norm = (xs: number[]) => {
    const max = Math.max(...xs, 1);
    return xs.map((v) => v / max);
  };
  const line = (xs: number[]) =>
    norm(xs)
      .map((v, i) => `${(padL + (i / (xs.length - 1)) * iw).toFixed(1)},${(padT + ih - v * ih).toFixed(1)}`)
      .join(" ");
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aLabel} vs ${bLabel}, normalized, 30 days`}>
        {[0.5, 1].map((t) => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + ih - t * ih} y2={padT + ih - t * ih}
                stroke="var(--line)" strokeWidth="1" />
        ))}
        <line x1={padL} x2={W - padR} y1={padT + ih} y2={padT + ih} stroke="var(--line)" strokeWidth="1" />
        {axisDays(days).map(({ i, label }) => (
          <text key={i} x={padL + (i / (days.length - 1)) * iw} y={H - 6}
                fontSize="9.5" fill="var(--muted)" textAnchor="middle" className="mono">{label}</text>
        ))}
        <polyline points={line(a)} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={line(b)} fill="none" stroke="var(--mag)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption className="legend">
        <span><i className="swatch" style={{ background: "var(--cyan)" }} /> {aLabel}</span>
        <span><i className="swatch" style={{ background: "var(--mag)" }} /> {bLabel}</span>
        <span className="muted">each series normalized to its own 30d max</span>
      </figcaption>
    </figure>
  );
}

export function AreaChart({ days, values, label }: { days: string[]; values: number[]; label: string }) {
  const W = 640, H = 200, padL = 30, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(Math.ceil(Math.max(...values, 1) / 5) * 5, 5);
  const x = (i: number) => padL + (i / (values.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const peak = values.indexOf(Math.max(...values));
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, 30 days`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 5} y={y(max * t) + 3} fontSize="9.5" fill="var(--muted)" textAnchor="end" className="mono">
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {axisDays(days).map(({ i, label: l }) => (
          <text key={i} x={x(i)} y={H - 6} fontSize="9.5" fill="var(--muted)" textAnchor="middle" className="mono">{l}</text>
        ))}
        <polygon points={`${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`} fill="var(--cyan)" opacity="0.13" />
        <polyline points={pts} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill="var(--cyan)" stroke="var(--s)" strokeWidth="2" />
        <text x={x(peak)} y={y(values[peak]) - 6} fontSize="10" fontWeight="700" fill="var(--ink)" textAnchor="middle" className="mono">
          {values[peak]}
        </text>
      </svg>
      <figcaption className="legend"><span className="muted">{label}</span></figcaption>
    </figure>
  );
}

// DevScatter: "real builders vs script goblins". Log-log pushes(Y) x repos(X),
// color = mergedPrs/(prs+1) (script-goblin magenta -> real-builder cyan),
// size = commits. Hand-rolled SVG, no chart libraries.
export function DevScatterChart({ points, note }: { points: DevPoint[]; note?: string }) {
  const W = 640, H = 300, padL = 48, padR = 20, padT = 18, padB = 34;
  const iw = W - padL - padR, ih = H - padT - padB;

  if (!points.length) return null;

  const reposVals = points.map((p) => Math.max(1, p.repos));
  const pushVals = points.map((p) => Math.max(1, p.pushes));
  const maxRepos = Math.max(...reposVals, 10);
  const maxPushes = Math.max(...pushVals, 10);
  const minPushes = Math.min(...pushVals, 1);

  const xLog = (v: number) => Math.log10(Math.max(1, v)) / Math.log10(Math.max(10, maxRepos));
  const yLog = (v: number) => {
    const lo = Math.log10(Math.max(1, minPushes));
    const hi = Math.log10(Math.max(10, maxPushes));
    const span = hi - lo || 1;
    return (Math.log10(Math.max(1, v)) - lo) / span;
  };

  const x = (v: number) => padL + xLog(v) * iw;
  const y = (v: number) => padT + ih - yLog(v) * ih;

  const radius = (commits: number) => Math.min(22, Math.max(4, 4 + Math.sqrt(commits) * 0.28));
  const color = (p: DevPoint) => {
    const ratio = Math.min(1, Math.max(0, p.mergedPrs / (p.prs + 1)));
    const pct = Math.round(ratio * 100);
    return `color-mix(in srgb, var(--cyan) ${pct}%, var(--mag) ${100 - pct}%)`;
  };

  const xTicks = [1, 10, 100, 1000].filter((t) => t <= maxRepos * 1.4);
  const yTicks = [100, 1000, 10000, 100000].filter((t) => t >= minPushes / 4 && t <= maxPushes * 3);

  return (
    <figure className="chart dev-scatter">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Developer scatter: pushes vs repos touched, log-log axes, color shows merged-PR ratio, size shows commit volume"
      >
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} fontSize="9" fill="var(--muted)" textAnchor="end" className="mono">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line x1={x(t)} x2={x(t)} y1={padT} y2={padT + ih} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={x(t)} y={H - padB + 14} fontSize="9" fill="var(--muted)" textAnchor="middle" className="mono">
              {t}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={padT + ih} y2={padT + ih} stroke="var(--line)" strokeWidth="1" />
        <line x1={padL} x2={padL} y1={padT} y2={padT + ih} stroke="var(--line)" strokeWidth="1" />
        <text x={W - padR} y={H - 4} fontSize="9" fill="var(--muted)" textAnchor="end" className="mono">
          repos touched (log)
        </text>
        <text x={padL} y={padT - 6} fontSize="9" fill="var(--muted)" textAnchor="start" className="mono">
          pushes (log)
        </text>
        {points.map((p) => {
          const r = radius(p.commits);
          return (
            <g key={p.actor}>
              <circle cx={x(p.repos)} cy={y(p.pushes)} r={r} fill={color(p)} fillOpacity="0.82" stroke="var(--s)" strokeWidth="1.5" />
              <text x={x(p.repos)} y={y(p.pushes) - r - 5} fontSize="9" fill="var(--ink)" textAnchor="middle" className="mono">
                {p.actor}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend dev-scatter-legend">
        <span className="scatter-gradient-legend">
          <i className="scatter-gradient" aria-hidden="true" />
          <b>script-goblins</b>
          <span className="muted">color = merged PRs / (PRs+1)</span>
          <b>real builders</b>
        </span>
        <span className="scatter-size-legend" aria-hidden="true">
          <i style={{ width: radius(0) * 2, height: radius(0) * 2 }} />
          <i style={{ width: radius(1000) * 2, height: radius(1000) * 2 }} />
          <i style={{ width: radius(4000) * 2, height: radius(4000) * 2 }} />
        </span>
        <span className="muted">size = commits</span>
      </figcaption>
      {note && <p className="scatter-note mono muted">{note}</p>}
    </figure>
  );
}

export interface BarItem {
  label: string;
  value: number;
  secondaryValue?: number;
  secondaryLabel?: string;
  color?: string;
  badge?: string;
}

export function HorizontalBarChart({
  items,
  title,
  unit = "",
}: {
  items: BarItem[];
  title?: string;
  unit?: string;
}) {
  if (!items || items.length === 0) return null;

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const W = 640;
  const barH = 22;
  const gap = 12;
  const padL = 140;
  const padR = 60;
  const padT = title ? 28 : 10;
  const H = padT + items.length * (barH + gap) + 10;
  const barMaxW = W - padL - padR;

  return (
    <figure className="chart bar-chart-horizontal">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Horizontal bar comparison"}>
        {title && (
          <text x={padL} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {items.map((item, idx) => {
          const y = padT + idx * (barH + gap);
          const barW = Math.max(4, (item.value / maxVal) * barMaxW);
          const barColor = item.color || "var(--cyan)";

          return (
            <g key={`${item.label}-${idx}`} className="bar-row">
              {/* Row Label */}
              <text
                x={padL - 10}
                y={y + barH / 2 + 4}
                fontSize="10"
                fontWeight="600"
                fill="var(--ink)"
                textAnchor="end"
                className="mono"
              >
                {item.label.length > 20 ? item.label.slice(0, 18) + "…" : item.label}
              </text>

              {/* Background Bar */}
              <rect
                x={padL}
                y={y}
                width={barMaxW}
                height={barH}
                fill="var(--line-soft)"
                rx="4"
                opacity="0.4"
              />

              {/* Value Bar */}
              <rect
                x={padL}
                y={y}
                width={barW}
                height={barH}
                fill={barColor}
                rx="4"
                opacity="0.88"
              />

              {/* Value Text */}
              <text
                x={padL + barW + 8}
                y={y + barH / 2 + 4}
                fontSize="10.5"
                fontWeight="700"
                fill="var(--ink)"
                className="mono"
              >
                {item.value.toLocaleString()}
                {unit ? ` ${unit}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function VerticalBarChart({
  items,
  title,
  unit = "",
}: {
  items: BarItem[];
  title?: string;
  unit?: string;
}) {
  if (!items || items.length === 0) return null;

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const W = 640;
  const H = 200;
  const padL = 36;
  const padR = 12;
  const padT = 24;
  const padB = 32;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const barW = Math.max(8, Math.min(36, (iw / items.length) * 0.6));
  const step = iw / items.length;

  return (
    <figure className="chart bar-chart-vertical">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Vertical bar comparison"}>
        {title && (
          <text x={padL} y={16} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--line)" strokeWidth="1" />

        {items.map((item, idx) => {
          const xCenter = padL + idx * step + step / 2;
          const xLeft = xCenter - barW / 2;
          const h = (item.value / maxVal) * ih;
          const y = H - padB - h;
          const barColor = item.color || "var(--cyan)";

          return (
            <g key={`${item.label}-${idx}`}>
              {/* Vertical Bar */}
              <rect
                x={xLeft}
                y={y}
                width={barW}
                height={Math.max(2, h)}
                fill={barColor}
                rx="3"
                opacity="0.85"
              />

              {/* Value on top */}
              {h > 14 && (
                <text
                  x={xCenter}
                  y={y - 5}
                  fontSize="9.5"
                  fontWeight="700"
                  fill="var(--ink)"
                  textAnchor="middle"
                  className="mono"
                >
                  {item.value >= 1000 ? `${(item.value / 1000).toFixed(1)}k` : item.value}
                </text>
              )}

              {/* Label at bottom */}
              <text
                x={xCenter}
                y={H - padB + 14}
                fontSize="9"
                fill="var(--muted)"
                textAnchor="middle"
                className="mono"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
