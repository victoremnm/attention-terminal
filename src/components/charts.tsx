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
          const val = Number.isFinite(item.value) && item.value > 0 ? item.value : 0;
          const barW = Math.max(4, (val / maxVal) * barMaxW);
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
  scale = "linear",
}: {
  items: BarItem[];
  title?: string;
  unit?: string;
  // "log" scales bar HEIGHT only (via log1p) for high-variance datasets where a
  // few outliers would otherwise flatten every other bar to ~0px. The value
  // label above each bar always shows the real, untransformed number.
  scale?: "linear" | "log";
}) {
  if (!items || items.length === 0) return null;

  const maxVal = Math.max(...items.map((i) => i.value), 1);
  const magnitude = (v: number) => (scale === "log" ? Math.log1p(Math.max(0, v)) : v);
  const maxMagnitude = Math.max(magnitude(maxVal), 1);
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
          const h = (magnitude(item.value) / maxMagnitude) * ih;
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

export interface PieItem {
  label: string;
  value: number;
  color?: string;
}

export function PieChart({ items, title }: { items: PieItem[]; title?: string }) {
  if (!items || items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return null;

  const W = 640, H = 220;
  const cx = 140, cy = 110, r = 75, innerR = 40;
  const colors = ["var(--cyan)", "var(--mag)", "var(--amber)", "var(--blue)", "var(--emerald)", "#a855f7", "#ec4899"];

  const displayItems = items.length > 7
    ? [
        ...items.slice(0, 6),
        { label: "Other", value: items.slice(6).reduce((sum, item) => sum + item.value, 0), color: "var(--muted)" },
      ]
    : items;

  let cumulativeAngle = 0;
  const slices = displayItems.map((item, idx) => {
    const angle = (item.value / total) * 2 * Math.PI;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle += angle;

    const x1 = cx + r * Math.sin(startAngle);
    const y1 = cy - r * Math.cos(startAngle);
    const x2 = cx + r * Math.sin(endAngle);
    const y2 = cy - r * Math.cos(endAngle);

    const ix1 = cx + innerR * Math.sin(endAngle);
    const iy1 = cy - innerR * Math.cos(endAngle);
    const ix2 = cx + innerR * Math.sin(startAngle);
    const iy2 = cy - innerR * Math.cos(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;
    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      `Z`,
    ].join(" ");

    const color = item.color || colors[idx % colors.length];
    const pct = ((item.value / total) * 100).toFixed(1);

    return { label: item.label, value: item.value, pct, color, d };
  });

  return (
    <figure className="chart pie-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Pie chart distribution"}>
        {title && (
          <text x={20} y={20} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {slices.length === 1 ? (
          <circle cx={cx} cy={cy} r={(r + innerR) / 2} fill="none" stroke={slices[0].color} strokeWidth={r - innerR} opacity="0.88" />
        ) : (
          slices.map((slice, idx) => (
            <path key={`${slice.label}-${idx}`} d={slice.d} fill={slice.color} opacity="0.88" stroke="var(--s)" strokeWidth="1.5" />
          ))
        )}
        <text x={cx} y={cy - 2} fontSize="13" fontWeight="800" fill="var(--ink)" textAnchor="middle" className="mono">
          {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 14} fontSize="9" fill="var(--muted)" textAnchor="middle" className="mono">
          TOTAL
        </text>
        {/* Legend */}
        {slices.map((slice, idx) => (
          <g key={`leg-${slice.label}-${idx}`} transform={`translate(280, ${35 + idx * 24})`}>
            <rect x={0} y={0} width={12} height={12} rx={2} fill={slice.color} />
            <text x={20} y={10} fontSize="10.5" fontWeight="600" fill="var(--ink)" className="mono">
              {slice.label.length > 22 ? slice.label.slice(0, 20) + "…" : slice.label}
            </text>
            <text x={320} y={10} fontSize="10.5" fontWeight="700" fill="var(--muted)" textAnchor="end" className="mono">
              {slice.value.toLocaleString()} ({slice.pct}%)
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export interface StackedSegment {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface StackedBarItem {
  category: string;
  segments: StackedSegment[];
}

export function StackedBarChart({ items, title }: { items: StackedBarItem[]; title?: string }) {
  if (!items || items.length === 0) return null;
  const W = 640;
  const barH = 24, gap = 14, padL = 130, padR = 60, padT = title ? 28 : 10;
  const H = padT + items.length * (barH + gap) + 30;
  const barMaxW = W - padL - padR;

  const maxTotal = Math.max(
    ...items.map((item) => item.segments.reduce((acc, seg) => acc + seg.value, 0)),
    1
  );

  const colors = ["var(--cyan)", "var(--mag)", "var(--amber)", "var(--blue)", "var(--emerald)", "#a855f7"];
  const segmentKeys = Array.from(new Set(items.flatMap((i) => i.segments.map((s) => s.key))));

  return (
    <figure className="chart stacked-bar-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Stacked bar chart"}>
        {title && (
          <text x={padL} y={18} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {items.map((item, idx) => {
          const y = padT + idx * (barH + gap);
          let currentX = padL;
          const totalVal = item.segments.reduce((sum, s) => sum + s.value, 0);

          return (
            <g key={`${item.category}-${idx}`}>
              <text x={padL - 10} y={y + barH / 2 + 4} fontSize="10" fontWeight="600" fill="var(--ink)" textAnchor="end" className="mono">
                {item.category.length > 18 ? item.category.slice(0, 16) + "…" : item.category}
              </text>
              {item.segments.map((seg, sIdx) => {
                const segW = (seg.value / maxTotal) * barMaxW;
                const segX = currentX;
                currentX += segW;
                const keyIdx = segmentKeys.indexOf(seg.key);
                const segColor = seg.color || colors[(keyIdx >= 0 ? keyIdx : sIdx) % colors.length];

                return (
                  <rect key={`${seg.key}-${sIdx}`} x={segX} y={y} width={Math.max(0, segW)} height={barH} fill={segColor} opacity="0.88" />
                );
              })}
              <text x={currentX + 8} y={y + barH / 2 + 4} fontSize="10" fontWeight="700" fill="var(--ink)" className="mono">
                {totalVal.toLocaleString()}
              </text>
            </g>
          );
        })}
        {/* Legend */}
        <g transform={`translate(${padL}, ${H - 12})`}>
          {segmentKeys.slice(0, 5).map((key, i) => (
            <g key={key} transform={`translate(${i * 100}, 0)`}>
              <rect x={0} y={-8} width={10} height={10} rx={2} fill={colors[i % colors.length]} />
              <text x={14} y={0} fontSize="9.5" fill="var(--muted)" className="mono">{key}</text>
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
}

export interface WaterfallStep {
  label: string;
  delta: number;
  type?: "baseline" | "change" | "total";
}

export function WaterfallChart({ steps, title }: { steps: WaterfallStep[]; title?: string }) {
  if (!steps || steps.length === 0) return null;
  const W = 640, H = 220, padL = 40, padR = 20, padT = title ? 28 : 14, padB = 36;
  const iw = W - padL - padR, ih = H - padT - padB;

  let cumulative = 0;
  const computed = steps.map((s) => {
    const isTotal = s.type === "total";
    const start = isTotal ? 0 : cumulative;
    const end = isTotal ? s.delta : cumulative + s.delta;
    if (!isTotal) cumulative = end;
    return { ...s, start, end, isTotal };
  });

  const maxVal = Math.max(...computed.flatMap((c) => [c.start, c.end]), 1);
  const minVal = Math.min(...computed.flatMap((c) => [c.start, c.end]), 0);
  const range = maxVal - minVal || 1;

  const y = (v: number) => padT + ih - ((v - minVal) / range) * ih;
  const barW = Math.max(12, Math.min(45, (iw / steps.length) * 0.65));
  const stepW = iw / steps.length;

  return (
    <figure className="chart waterfall-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Waterfall chart"}>
        {title && (
          <text x={padL} y={16} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1" />

        {computed.map((step, idx) => {
          const xCenter = padL + idx * stepW + stepW / 2;
          const xLeft = xCenter - barW / 2;
          const yTop = y(Math.max(step.start, step.end));
          const yBot = y(Math.min(step.start, step.end));
          const h = Math.max(3, yBot - yTop);

          const isPositive = step.delta >= 0;
          const color = step.isTotal
            ? "var(--blue)"
            : isPositive
            ? "var(--cyan)"
            : "var(--mag)";

          return (
            <g key={`${step.label}-${idx}`}>
              <rect x={xLeft} y={yTop} width={barW} height={h} fill={color} rx="3" opacity="0.88" />
              <text x={xCenter} y={yTop - 5} fontSize="9.5" fontWeight="700" fill="var(--ink)" textAnchor="middle" className="mono">
                {isPositive && !step.isTotal ? `+${step.delta}` : step.delta}
              </text>
              <text x={xCenter} y={H - padB + 14} fontSize="9" fill="var(--muted)" textAnchor="middle" className="mono">
                {step.label.length > 10 ? step.label.slice(0, 8) + "…" : step.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export interface TreemapTile {
  label: string;
  value: number;
  category?: string;
}

export function TreemapChart({ items, title }: { items: TreemapTile[]; title?: string }) {
  if (!items || items.length === 0) return null;
  const W = 640, H = 220, padT = title ? 26 : 8;
  const chartH = H - padT;

  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return null;

  const colors = ["var(--cyan)", "var(--mag)", "var(--amber)", "var(--blue)", "var(--emerald)", "#a855f7"];

  const displayItems = items.length > 8
    ? [
        ...items.slice(0, 7),
        { label: "Other", value: items.slice(7).reduce((sum, item) => sum + item.value, 0) },
      ]
    : items;

  let currentX = 0;
  const tiles = displayItems.map((item, idx) => {
    const w = (item.value / total) * W;
    const tile = {
      label: item.label,
      value: item.value,
      x: currentX,
      y: padT,
      w,
      h: chartH,
      color: colors[idx % colors.length],
    };
    currentX += w;
    return tile;
  });

  return (
    <figure className="chart treemap-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || "Treemap grid"}>
        {title && (
          <text x={0} y={16} fontSize="11" fontWeight="700" fill="var(--ink)" className="mono">
            {title.toUpperCase()}
          </text>
        )}
        {tiles.map((tile, idx) => (
          <g key={`${tile.label}-${idx}`}>
            <rect x={tile.x} y={tile.y} width={Math.max(0, tile.w - 2)} height={tile.h - 2} fill={tile.color} rx="4" opacity="0.82" />
            {tile.w > 40 && (
              <>
                <text x={tile.x + 8} y={tile.y + 20} fontSize="10.5" fontWeight="700" fill="var(--s)" className="mono">
                  {tile.label.length > 12 ? tile.label.slice(0, 10) + "…" : tile.label}
                </text>
                <text x={tile.x + 8} y={tile.y + 36} fontSize="9.5" fill="var(--s)" opacity="0.9" className="mono">
                  {tile.value.toLocaleString()}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function CodeFrequencyChart({ data }: { data: Array<{ week: string; additions: number; deletions: number }> }) {
  if (!data || data.length < 2) return null;

  const weeks = data.map((d) => d.week);
  const additions = data.map((d) => d.additions);
  const deletions = data.map((d) => d.deletions);

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

  function axisWeeks(weeks_: string[], n = 4): { i: number; label: string }[] {
    const step = Math.max(1, Math.floor((weeks_.length - 1) / (n - 1)));
    const out: { i: number; label: string }[] = [];
    for (let i = 0; i < weeks_.length; i += step) out.push({ i, label: weeks_[i].slice(5).replace("-", "/") });
    return out;
  }

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Code frequency: additions vs deletions, normalized, 52 weeks">
        {[0.5, 1].map((t) => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + ih - t * ih} y2={padT + ih - t * ih}
                stroke="var(--line)" strokeWidth="1" />
        ))}
        <line x1={padL} x2={W - padR} y1={padT + ih} y2={padT + ih} stroke="var(--line)" strokeWidth="1" />
        {axisWeeks(weeks).map(({ i, label }) => (
          <text key={i} x={padL + (i / (weeks.length - 1)) * iw} y={H - 6}
                fontSize="9.5" fill="var(--muted)" textAnchor="middle" className="mono">{label}</text>
        ))}
        <polyline points={line(additions)} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={line(deletions)} fill="none" stroke="var(--mag)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption className="legend">
        <span><i className="swatch" style={{ background: "var(--cyan)" }} /> additions</span>
        <span><i className="swatch" style={{ background: "var(--mag)" }} /> deletions</span>
        <span className="muted">each series normalized to its own 52-week max</span>
      </figcaption>
    </figure>
  );
}
