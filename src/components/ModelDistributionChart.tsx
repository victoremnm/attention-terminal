"use client";

import type { ModelDistributionSummary } from "@/lib/telemetry-queries";

interface ModelDistributionChartProps {
  stats: ModelDistributionSummary[];
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

  // Max latency across all models for scale
  const globalMaxLatency = Math.max(...stats.map((s) => s.maxLatencyMs || 1000), 1000);
  const minScale = 0;
  const maxScale = Math.ceil(globalMaxLatency / 1000) * 1000;

  const xScale = (valMs: number) => {
    const ratio = Math.min(1, Math.max(0, valMs / maxScale));
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

  const ticks = [0, maxScale * 0.25, maxScale * 0.5, maxScale * 0.75, maxScale];

  return (
    <div className="model-analysis-container space-y-6">
      <div className="model-chart-box">
        <div className="chart-title-row">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Model Latency Distribution (Violin / Box Plot)</h3>
            <p className="text-xs text-slate-400">
              Interquartile range (Q1–Q3 box), Median (center line), Whiskers (Min–Max), and kernel density violin contours grouped by model.
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

              const xMin = xScale(s.minLatencyMs);
              const xQ1 = xScale(s.q1LatencyMs);
              const xMed = xScale(s.medianLatencyMs);
              const xQ3 = xScale(s.q3LatencyMs);
              const xMax = xScale(s.maxLatencyMs);

              const boxW = Math.max(4, xQ3 - xQ1);
              const violinW = Math.max(12, xMax - xMin);

              return (
                <g key={s.model} className="model-row-group">
                  {/* Model Label */}
                  <text x={padL - 12} y={cy + 4} fontSize="11" fontWeight="600" fill="#cbd5e1" textAnchor="end" className="mono">
                    {s.model}
                  </text>
                  <text x={padL - 12} y={cy + 18} fontSize="9" fill="#64748b" textAnchor="end" className="mono">
                    n = {s.count} runs
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

                  {/* Whisker Line (Min to Max) */}
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

                  {/* Data Points (Scatter Dots) */}
                  {s.latencies.map((lat, dotIdx) => (
                    <circle
                      key={`${s.model}-${dotIdx}-${lat}`}
                      cx={xScale(lat)}
                      cy={cy + (dotIdx % 2 === 0 ? -3 : 3)}
                      r="2.5"
                      fill={colors.primary}
                      opacity="0.85"
                    />
                  ))}
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
