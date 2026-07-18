"use client";

// Hand-rolled SVG charts per the wireframes - no chart libraries.
// Cyan = talk/HN, magenta = code/GitHub, muted grid, tabular numerals.

export function Sparkline({ data, color = "var(--cyan)", w = 64, h = 18 }: {
  data: number[]; color?: string; w?: number; h?: number;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
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
