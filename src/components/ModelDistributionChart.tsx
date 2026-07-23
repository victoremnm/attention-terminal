"use client";

import type { ModelDistributionSummary } from "@/lib/telemetry-queries";

interface ModelDistributionChartProps {
  stats: ModelDistributionSummary[];
}

// Tukey's fences (1.5x IQR) -- the standard box-plot convention for
// separating the "core" distribution from outliers. A single very slow (or
// very fast) run would otherwise stretch the whisker/violin shape and
// compress every other model's box into a sliver of the shared axis.
const OUTLIER_IQR_MULTIPLIER = 1.5;
// If the widest model's core range is at least this many times the
// narrowest model's, a linear axis makes the narrower groups unreadable --
// switch to a log scale instead of trying to fit both on one linear ruler.
const LOG_SCALE_SPREAD_THRESHOLD = 10;

type ModelFences = {
  whiskerMin: number;
  whiskerMax: number;
  outliers: number[];
};

function computeFences(s: ModelDistributionSummary): ModelFences {
  const iqr = s.q3LatencyMs - s.q1LatencyMs;
  const lowerFence = s.q1LatencyMs - OUTLIER_IQR_MULTIPLIER * iqr;
  const upperFence = s.q3LatencyMs + OUTLIER_IQR_MULTIPLIER * iqr;
  // s.latencies is sorted ascending (see computeModelDistributionStats).
  const inliers = s.latencies.filter((lat) => lat >= lowerFence && lat <= upperFence);
  const outliers = s.latencies.filter((lat) => lat < lowerFence || lat > upperFence);
  return {
    whiskerMin: inliers.length > 0 ? inliers[0] : s.minLatencyMs,
    whiskerMax: inliers.length > 0 ? inliers[inliers.length - 1] : s.maxLatencyMs,
    outliers,
  };
}

export function ModelDistributionChart({ stats }: ModelDistributionChartProps) {
  if (!stats || stats.length === 0) return null;

  const W = 720;
  const rowHeight = 64;
  const padL = 140;
  const padR = 24;
  const padT = 24;
  const padB = 30;
  const H = padT + stats.length * rowHeight + padB;
  const iw = W - padL - padR;

  const fencesByModel = new Map(stats.map((s) => [s.model, computeFences(s)]));
  const whiskerMaxes = stats.map((s) => fencesByModel.get(s.model)!.whiskerMax).filter((v) => v > 0);
  const whiskerMins = stats.map((s) => fencesByModel.get(s.model)!.whiskerMin).filter((v) => v > 0);

  // Scale domain is driven by each model's *core* range, not raw min/max --
  // an outlier still gets plotted (clamped to the domain edge with its own
  // marker below), it just no longer dictates the axis.
  const domainMax = Math.max(...whiskerMaxes, 1000) * 1.15;
  const spreadRatio = whiskerMins.length > 0 ? domainMax / Math.max(1, Math.min(...whiskerMins)) : 1;
  const useLogScale = spreadRatio >= LOG_SCALE_SPREAD_THRESHOLD;
  const logDomainMax = Math.max(domainMax, 10);

  const xScale = (valMs: number) => {
    if (useLogScale) {
      const clamped = Math.min(logDomainMax, Math.max(1, valMs));
      const ratio = Math.log10(clamped) / Math.log10(logDomainMax);
      return padL + Math.min(1, Math.max(0, ratio)) * iw;
    }
    const ratio = Math.min(1, Math.max(0, valMs / domainMax));
    return padL + ratio * iw;
  };

  const getModelColor = (model: string) => {
    const m = model.toLowerCase();
    if (m.includes("gemini")) return { primary: "#22d3ee", fill: "rgba(34, 211, 238, 0.18)" };
    if (m.includes("glm")) return { primary: "#c084fc", fill: "rgba(192, 132, 252, 0.18)" };
    if (m.includes("kimi")) return { primary: "#34d399", fill: "rgba(52, 211, 153, 0.18)" };
    if (m.includes("claude")) return { primary: "#fbbf24", fill: "rgba(251, 191, 36, 0.18)" };
    if (m.includes("gpt")) return { primary: "#60a5fa", fill: "rgba(96, 165, 250, 0.18)" };
    return { primary: "#a7f3d0", fill: "rgba(167, 243, 208, 0.18)" };
  };

  const formatMs = (ms: number) => {
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  };

  // Log ticks land on powers of ten (1, 10, 100, 1000, ...) up to the
  // domain; linear ticks stay evenly spaced across it.
  const ticks = useLogScale
    ? (() => {
        const out: number[] = [];
        for (let p = 1; p <= logDomainMax; p *= 10) out.push(p);
        if (out[out.length - 1] !== logDomainMax) out.push(logDomainMax);
        return out;
      })()
    : [0, domainMax * 0.25, domainMax * 0.5, domainMax * 0.75, domainMax];

  return (
    <div className="model-analysis-container space-y-6">
      <div className="model-chart-box">
        <div className="chart-title-row">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Model Latency Distribution (Violin / Box Plot)</h3>
            <p className="text-xs text-slate-400">
              Interquartile range (Q1–Q3 box), Median (center line), Whiskers (core range within 1.5×IQR), and kernel
              density violin contours grouped by model. Points beyond 1.5×IQR are plotted as individual outlier
              markers past the whisker rather than stretching the axis.
              {useLogScale && " Axis is log-scaled — model latencies differ by more than 10x."}
            </p>
          </div>
          <div className="legend-pills flex items-center gap-3 text-xs mono">
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" /> Gemini</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block" /> GLM</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> Kimi</span>
            <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Claude</span>
          </div>
        </div>

        <div className="svg-wrapper overflow-x-auto py-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-4xl mx-auto" role="img" aria-label="Model Latency Box and Violin Plot">
            {/* Grid Ticks */}
            {ticks.map((t) => (
              <g key={`tick-${t}`}>
                <line x1={xScale(t)} x2={xScale(t)} y1={padT} y2={H - padB} stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="3 3" />
                <text x={xScale(t)} y={H - 8} fontSize="10" fill="#64748b" textAnchor="middle" className="mono">
                  {formatMs(t)}
                </text>
              </g>
            ))}

            {/* Model Rows */}
            {stats.map((s, idx) => {
              const cy = padT + idx * rowHeight + rowHeight / 2;
              const boxHeight = 18;
              const colors = getModelColor(s.model);
              const fences = fencesByModel.get(s.model)!;

              const xMin = xScale(fences.whiskerMin);
              const xQ1 = xScale(s.q1LatencyMs);
              const xMed = xScale(s.medianLatencyMs);
              const xQ3 = xScale(s.q3LatencyMs);
              const xMax = xScale(fences.whiskerMax);

              const boxW = Math.max(4, xQ3 - xQ1);
              const violinW = Math.max(12, xMax - xMin);

              const inlierLatencies = s.latencies.filter(
                (lat) => lat >= fences.whiskerMin && lat <= fences.whiskerMax
              );

              return (
                <g key={s.model} className="model-row-group">
                  {/* Model Label */}
                  <text x={padL - 12} y={cy + 4} fontSize="11" fontWeight="600" fill="#cbd5e1" textAnchor="end" className="mono">
                    {s.model}
                  </text>
                  <text x={padL - 12} y={cy + 18} fontSize="9" fill="#64748b" textAnchor="end" className="mono">
                    n = {s.count} runs{fences.outliers.length > 0 ? ` (${fences.outliers.length} outlier${fences.outliers.length === 1 ? "" : "s"})` : ""}
                  </text>

                  {/* Violin Contour Path */}
                  <path
                    d={`M ${xMin} ${cy}
                        C ${xMin + violinW * 0.25} ${cy - 16}, ${xQ1 + boxW * 0.5} ${cy - 14}, ${xQ3} ${cy - 10}
                        C ${xMax - 2} ${cy - 4}, ${xMax} ${cy}, ${xMax} ${cy}
                        C ${xMax} ${cy}, ${xMax - 2} ${cy + 4}, ${xQ3} ${cy + 10}
                        C ${xQ1 + boxW * 0.5} ${cy + 14}, ${xMin + violinW * 0.25} ${cy + 16}, ${xMin} ${cy} Z`}
                    fill={colors.fill}
                    stroke={colors.primary}
                    strokeWidth="1"
                    strokeOpacity="0.5"
                  />

                  {/* Whisker Line (fenced core range) */}
                  <line x1={xMin} x2={xMax} y1={cy} y2={cy} stroke={colors.primary} strokeWidth="1.5" />
                  <line x1={xMin} x2={xMin} y1={cy - 6} y2={cy + 6} stroke={colors.primary} strokeWidth="1.5" />
                  <line x1={xMax} x2={xMax} y1={cy - 6} y2={cy + 6} stroke={colors.primary} strokeWidth="1.5" />

                  {/* IQR Box (Q1 to Q3) */}
                  <rect
                    x={xQ1}
                    y={cy - boxHeight / 2}
                    width={boxW}
                    height={boxHeight}
                    fill="rgba(15, 23, 42, 0.85)"
                    stroke={colors.primary}
                    strokeWidth="2"
                    rx="3"
                  />

                  {/* Median Line */}
                  <line x1={xMed} x2={xMed} y1={cy - boxHeight / 2} y2={cy + boxHeight / 2} stroke="#ffffff" strokeWidth="2.5" />

                  {/* Data Points (Scatter Dots) -- core distribution only */}
                  {inlierLatencies.map((lat, dotIdx) => (
                    <circle
                      key={`${s.model}-in-${dotIdx}-${lat}`}
                      cx={xScale(lat)}
                      cy={cy + (dotIdx % 2 === 0 ? -3 : 3)}
                      r="2.5"
                      fill={colors.primary}
                      opacity="0.85"
                    />
                  ))}

                  {/* Outlier markers -- diamonds past the whisker, clamped to the domain edge if needed */}
                  {fences.outliers.map((lat, dotIdx) => {
                    const cx = xScale(lat);
                    const r = 3.5;
                    return (
                      <path
                        key={`${s.model}-out-${dotIdx}-${lat}`}
                        d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
                        fill="none"
                        stroke={colors.primary}
                        strokeWidth="1.5"
                        opacity="0.9"
                      >
                        <title>{`outlier: ${formatMs(lat)}`}</title>
                      </path>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Model Breakdown Stats Table */}
      <div className="table-responsive">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Model Name</th>
              <th>Executions</th>
              <th>Median Latency</th>
              <th>Min – Max Range</th>
              <th>Avg Input Tokens</th>
              <th>Avg Output Tokens</th>
              <th>Avg Cost</th>
              <th>Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.model}>
                <td className="mono font-bold text-cyan-400">{s.model}</td>
                <td className="mono">{s.count} runs</td>
                <td className="mono font-semibold text-slate-100">{formatMs(s.medianLatencyMs)}</td>
                <td className="mono text-slate-400">
                  {formatMs(s.minLatencyMs)} – {formatMs(s.maxLatencyMs)}
                </td>
                <td className="mono">{s.avgInputTokens.toLocaleString()}</td>
                <td className="mono">{s.avgOutputTokens.toLocaleString()}</td>
                <td className="mono text-emerald-400">${s.avgCostUsd.toFixed(4)}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mono ${s.successRate >= 100 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30"}`}>
                    {s.successRate}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
