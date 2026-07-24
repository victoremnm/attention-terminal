"use client";

import type { QueryPerformancePayload, QueryPerformanceRow } from "@/lib/query-performance";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function queryPerformanceHeaderLabel(row: QueryPerformanceRow) {
  return row.attention_tag || row.query_type || "Query";
}

function badgeClass(row: QueryPerformanceRow) {
  if (row.antipatterns.length > 0) {
    return "query-badge query-badge-alert";
  }
  if (row.attention_tag) return "query-badge query-badge-attn";
  return "query-badge";
}

function formatQueryPreview(query: string) {
  return query.length > 140 ? `${query.slice(0, 139)}…` : query;
}

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="kpi-card query-metric-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sublabel}</div>
    </div>
  );
}

export function QueryPerformancePanel({ payload }: { payload: QueryPerformancePayload }) {
  const { rows, summary } = payload;

  return (
    <section className="dashboard-section query-performance-section space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Query Performance</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Recent attention-tagged ClickHouse queries from <code>system.query_log</code>, scored with the local antipattern analyzer and loaded only when this tab opens.
        </p>
      </div>

      <div className="kpi-grid query-performance-kpis">
        <MetricCard
          label="Queries Captured"
          value={String(summary.queryCount)}
          sublabel="Recent QueryFinish rows"
        />
        <MetricCard
          label="Attention Tagged"
          value={String(summary.attentionTaggedCount)}
          sublabel="Rows with attn log_comment tags"
        />
        <MetricCard
          label="Avg Duration"
          value={`${summary.avgDurationMs} ms`}
          sublabel={`Slowest ${summary.slowestDurationMs} ms`}
        />
        <MetricCard
          label="Rows Read"
          value={summary.totalReadRows.toLocaleString()}
          sublabel={formatBytes(summary.totalReadBytes)}
        />
      </div>

      <div className="table-responsive">
        <table className="telemetry-table query-performance-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Surface</th>
              <th className="text-right">Duration</th>
              <th className="text-right">Rows Read</th>
              <th className="text-right">Result Rows</th>
              <th className="text-right">Memory</th>
              <th>Query</th>
              <th>Antipatterns</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center">
                  No query-log rows matched the attention tag yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.query_id}>
                  <td className="mono text-zinc-400">{row.event_time.substring(0, 19).replace("T", " ")}</td>
                  <td>
                    <div className={badgeClass(row)} title={row.log_comment || queryPerformanceHeaderLabel(row)}>
                      {queryPerformanceHeaderLabel(row)}
                    </div>
                    <div className="mono mt-1 text-[11px] text-zinc-500">{row.query_type}</div>
                  </td>
                  <td className="mono text-right">{row.query_duration_ms} ms</td>
                  <td className="mono text-right">{row.read_rows.toLocaleString()}</td>
                  <td className="mono text-right">{row.result_rows.toLocaleString()}</td>
                  <td className="mono text-right">{formatBytes(row.memory_usage)}</td>
                  <td className="query-preview mono" title={row.query}>
                    {formatQueryPreview(row.query)}
                  </td>
                  <td>
                    {row.antipatterns.length === 0 ? (
                      <span className="mono text-[11px] text-zinc-500">none</span>
                    ) : (
                      <div className="query-antipattern-pills">
                        {row.antipatterns.map((rule) => (
                          <span key={rule} className="query-rule-pill mono">
                            {rule}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
