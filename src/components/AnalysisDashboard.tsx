"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TelemetryPayload } from "@/lib/telemetry-queries";
import type { QueryPerformancePayload } from "@/lib/query-performance";
import { QueryPerformancePanel } from "./QueryPerformancePanel";
import { ModelDistributionChart } from "./ModelDistributionChart";

interface AnalysisDashboardProps {
  initialData: TelemetryPayload;
}

type AnalysisTab = "models" | "learnings" | "runs" | "events" | "sql" | "query-performance";

const TAB_ORDER: AnalysisTab[] = ["models", "learnings", "runs", "events", "sql", "query-performance"];

const TAB_IDS: Record<AnalysisTab, string> = {
  models: "analysis-tab-models",
  learnings: "analysis-tab-learnings",
  runs: "analysis-tab-runs",
  events: "analysis-tab-events",
  sql: "analysis-tab-sql",
  "query-performance": "analysis-tab-query-performance",
};

const PANEL_IDS: Record<AnalysisTab, string> = {
  models: "analysis-panel-models",
  learnings: "analysis-panel-learnings",
  runs: "analysis-panel-runs",
  events: "analysis-panel-events",
  sql: "analysis-panel-sql",
  "query-performance": "analysis-panel-query-performance",
};

export function AnalysisDashboard({ initialData }: AnalysisDashboardProps) {
  const [data, setData] = useState<TelemetryPayload>(initialData);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("models");
  const tabRefs = useRef<Partial<Record<AnalysisTab, HTMLButtonElement | null>>>({});
  const [queryPerformance, setQueryPerformance] = useState<QueryPerformancePayload | null>(null);
  const [queryPerformanceLoading, setQueryPerformanceLoading] = useState(false);
  const [queryPerformanceLoaded, setQueryPerformanceLoaded] = useState(false);
  const [queryPerformanceError, setQueryPerformanceError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const refreshTelemetry = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/analysis");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to refresh telemetry:", e);
    } finally {
      setLoading(false);
    }
  };

  const retryQueryPerformance = () => {
    setQueryPerformance(null);
    setQueryPerformanceError(null);
    setQueryPerformanceLoaded(false);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: AnalysisTab) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    let nextIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % TAB_ORDER.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TAB_ORDER.length - 1;
        break;
      default:
        return;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TAB_ORDER[nextIndex];
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  useEffect(() => {
    if (activeTab !== "query-performance" || queryPerformanceLoaded || queryPerformanceLoading) return;

    const loadQueryPerformance = async () => {
      setQueryPerformanceLoading(true);
      setQueryPerformanceError(null);
      try {
        const res = await fetch("/api/analysis/query-performance");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as QueryPerformancePayload;
        setQueryPerformance(json);
      } catch (error) {
        setQueryPerformanceError(error instanceof Error ? error.message : String(error));
      } finally {
        setQueryPerformanceLoaded(true);
        setQueryPerformanceLoading(false);
      }
    };

    void loadQueryPerformance();
  }, [activeTab, queryPerformanceLoaded, queryPerformanceLoading]);

  const categories = [
    "all",
    ...Array.from(new Set(data.learnings.map((l) => l.category).filter(Boolean))),
  ];

  const filteredLearnings = data.learnings.filter((l) => {
    const matchesCategory = selectedCategory === "all" || l.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      l.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.learning.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toString();
  };

  return (
    <div className="telemetry-dashboard-container">
      {/* Header */}
      <header className="telemetry-header">
        <div className="header-titles">
          <h1>Agent Telemetry & Session Learnings</h1>
          <p className="subtitle">
            Autonomous multi-agent execution metrics, model latency distributions, token cost analytics, and durable engineering learnings stored in ClickHouse.
          </p>
        </div>

        <button
          onClick={refreshTelemetry}
          disabled={loading}
          className="refresh-btn mono"
          aria-label="Refresh telemetry data"
        >
          {loading ? "Refreshing..." : "⚡ Sync ClickHouse Data"}
        </button>
      </header>

      {/* KPI Cards Grid */}
      <div className="kpi-grid">
        <div className="kpi-card accent-cyan">
          <div className="kpi-label">Subagent Executions</div>
          <div className="kpi-value">{data.kpis.runCount}</div>
          <div className="kpi-sub">Total AGY subagent runs</div>
        </div>

        <div className="kpi-card accent-purple">
          <div className="kpi-label">Input Tokens</div>
          <div className="kpi-value">{formatTokens(data.kpis.totalInputTokens)}</div>
          <div className="kpi-sub">Prompt & context tokens</div>
        </div>

        <div className="kpi-card accent-blue">
          <div className="kpi-label">Output Tokens</div>
          <div className="kpi-value">{formatTokens(data.kpis.totalOutputTokens)}</div>
          <div className="kpi-sub">Generated code & responses</div>
        </div>

        <div className="kpi-card accent-emerald">
          <div className="kpi-label">Total LLM Cost</div>
          <div className="kpi-value">${data.kpis.totalCostUsd.toFixed(4)}</div>
          <div className="kpi-sub">Estimated USD spend</div>
        </div>

        <div className="kpi-card accent-amber">
          <div className="kpi-label">Avg Execution Latency</div>
          <div className="kpi-value">{(data.kpis.avgLatencyMs / 1000).toFixed(1)}s</div>
          <div className="kpi-sub">{data.kpis.avgLatencyMs} ms / run</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-nav" role="tablist" aria-label="Analysis views">
        <button
          type="button"
          className={`tab-btn ${activeTab === "models" ? "active" : ""}`}
          id={TAB_IDS.models}
          role="tab"
          aria-selected={activeTab === "models"}
          aria-controls={PANEL_IDS.models}
          tabIndex={activeTab === "models" ? 0 : -1}
          ref={(element) => {
            tabRefs.current.models = element;
          }}
          onClick={() => setActiveTab("models")}
          onKeyDown={(event) => handleTabKeyDown(event, "models")}
        >
          📊 Model Distribution ({data.modelStats.length} Models)
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "learnings" ? "active" : ""}`}
          id={TAB_IDS.learnings}
          role="tab"
          aria-selected={activeTab === "learnings"}
          aria-controls={PANEL_IDS.learnings}
          tabIndex={activeTab === "learnings" ? 0 : -1}
          ref={(element) => {
            tabRefs.current.learnings = element;
          }}
          onClick={() => setActiveTab("learnings")}
          onKeyDown={(event) => handleTabKeyDown(event, "learnings")}
        >
          🧠 Session Learnings ({data.learnings.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "runs" ? "active" : ""}`}
          id={TAB_IDS.runs}
          role="tab"
          aria-selected={activeTab === "runs"}
          aria-controls={PANEL_IDS.runs}
          tabIndex={activeTab === "runs" ? 0 : -1}
          ref={(element) => {
            tabRefs.current.runs = element;
          }}
          onClick={() => setActiveTab("runs")}
          onKeyDown={(event) => handleTabKeyDown(event, "runs")}
        >
          🤖 Subagent Runs ({data.runs.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "events" ? "active" : ""}`}
          id={TAB_IDS.events}
          role="tab"
          aria-selected={activeTab === "events"}
          aria-controls={PANEL_IDS.events}
          tabIndex={activeTab === "events" ? 0 : -1}
          ref={(element) => {
            tabRefs.current.events = element;
          }}
          onClick={() => setActiveTab("events")}
          onKeyDown={(event) => handleTabKeyDown(event, "events")}
        >
          📡 OTel API Events ({data.apiEvents.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "sql" ? "active" : ""}`}
          id={TAB_IDS.sql}
          role="tab"
          aria-selected={activeTab === "sql"}
          aria-controls={PANEL_IDS.sql}
          tabIndex={activeTab === "sql" ? 0 : -1}
          ref={(element) => {
            tabRefs.current.sql = element;
          }}
          onClick={() => setActiveTab("sql")}
          onKeyDown={(event) => handleTabKeyDown(event, "sql")}
        >
          ⚡ SQL Provenance
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "query-performance" ? "active" : ""}`}
          onClick={() => setActiveTab("query-performance")}
          id={TAB_IDS["query-performance"]}
          role="tab"
          aria-selected={activeTab === "query-performance"}
          aria-controls={PANEL_IDS["query-performance"]}
          tabIndex={activeTab === "query-performance" ? 0 : -1}
          ref={(element) => {
            tabRefs.current["query-performance"] = element;
          }}
          onKeyDown={(event) => handleTabKeyDown(event, "query-performance")}
        >
          📈 Query Performance
        </button>
      </div>

      {/* Tab Content 0: Model Distribution Box/Violin Plot */}
      {activeTab === "models" && (
        <section
          className="dashboard-section space-y-6"
          id={PANEL_IDS.models}
          role="tabpanel"
          aria-labelledby={TAB_IDS.models}
          tabIndex={0}
        >
          <ModelDistributionChart stats={data.modelStats} />
        </section>
      )}

      {/* Tab Content 1: Learnings Bank */}
      {activeTab === "learnings" && (
        <section
          className="dashboard-section"
          id={PANEL_IDS.learnings}
          role="tabpanel"
          aria-labelledby={TAB_IDS.learnings}
          tabIndex={0}
        >
          <div className="filter-bar">
            <div className="category-pills">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`pill-btn ${selectedCategory === cat ? "active" : ""}`}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search learnings, slugs, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input mono"
            />
          </div>

          <div className="learnings-grid">
            {filteredLearnings.length === 0 ? (
              <div className="empty-state">No learnings matched query.</div>
            ) : (
              filteredLearnings.map((item, idx) => (
                <article key={`${item.slug}-${idx}`} className="learning-card">
                  <div className="card-top">
                    <span className={`cat-badge cat-${item.category}`}>{item.category}</span>
                    <span className="slug-title mono">{item.slug}</span>
                  </div>

                  <p className="learning-body">{item.learning}</p>

                  <div className="card-footer">
                    <div className="tags-row">
                      {item.tags.map((tag) => (
                        <span key={tag} className="tag-pill">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <time className="time-stamp mono">{item.ts.substring(0, 10)}</time>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {/* Tab Content 2: Subagent Runs Table */}
      {activeTab === "runs" && (
        <section
          className="dashboard-section"
          id={PANEL_IDS.runs}
          role="tabpanel"
          aria-labelledby={TAB_IDS.runs}
          tabIndex={0}
        >
          <div className="table-responsive">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>Prompt ID</th>
                  <th>Agent / Model</th>
                  <th>Latency</th>
                  <th>Tokens (In / Out)</th>
                  <th>Cost</th>
                  <th>Spec Preview</th>
                  <th>Result Preview</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center">
                      No subagent runs recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.runs.map((r, i) => (
                    <tr key={`${r.prompt_id}-${i}`}>
                      <td className="mono font-semibold text-cyan-400">{r.prompt_id}</td>
                      <td>
                        <div className="agent-tag">{r.agent_type}</div>
                        <div className="model-sub mono">{r.model}</div>
                      </td>
                      <td className="mono">{(r.latency_ms / 1000).toFixed(1)}s</td>
                      <td className="mono">
                        {formatTokens(r.input_tokens)} / {formatTokens(r.output_tokens)}
                      </td>
                      <td className="mono text-emerald-400">${r.cost_usd.toFixed(4)}</td>
                      <td className="spec-text">{r.spec_preview}</td>
                      <td className="result-text">{r.result_preview}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab Content 3: OTel API Events */}
      {activeTab === "events" && (
        <section
          className="dashboard-section"
          id={PANEL_IDS.events}
          role="tabpanel"
          aria-labelledby={TAB_IDS.events}
          tabIndex={0}
        >
          <div className="table-responsive">
            <table className="telemetry-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Agent Name</th>
                  <th>Model</th>
                  <th>Source</th>
                  <th>Duration</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Cost USD</th>
                </tr>
              </thead>
              <tbody>
                {data.apiEvents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center">
                      No OTel API events recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.apiEvents.map((ev, i) => (
                    <tr key={`${ev.prompt_id}-${i}`}>
                      <td className="mono">{ev.ts.substring(0, 19)}</td>
                      <td className="mono font-semibold">{ev.agent_name}</td>
                      <td className="mono">{ev.model}</td>
                      <td className="mono text-purple-400">{ev.query_source}</td>
                      <td className="mono">{(ev.duration_ms / 1000).toFixed(1)}s</td>
                      <td className="mono">{formatTokens(ev.input_tokens)}</td>
                      <td className="mono">{formatTokens(ev.output_tokens)}</td>
                      <td className="mono text-emerald-400">${ev.cost_usd.toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab Content 4: SQL Provenance */}
      {activeTab === "sql" && (
        <section
          className="dashboard-section"
          id={PANEL_IDS.sql}
          role="tabpanel"
          aria-labelledby={TAB_IDS.sql}
          tabIndex={0}
        >
          <div className="sql-box">
            <div className="sql-header mono">
              <span>PROVENANCE EXECUTION TIMING</span>
              <span className="text-cyan-400">{data.provenance.elapsedMs} ms total</span>
            </div>

            <div className="sql-meta">
              <div>
                <strong>Tables Read:</strong>{" "}
                {data.provenance.tables.map((t) => (
                  <span key={t} className="table-chip mono">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <pre className="sql-code mono">{data.provenance.sql}</pre>
          </div>
        </section>
      )}

      {/* Tab Content 5: Query Performance */}
      {activeTab === "query-performance" && (
        <section
          className="dashboard-section"
          id={PANEL_IDS["query-performance"]}
          role="tabpanel"
          aria-labelledby={TAB_IDS["query-performance"]}
          tabIndex={0}
        >
          {queryPerformanceLoading ? (
            <div className="empty-state">Loading query performance from system.query_log…</div>
          ) : queryPerformanceError ? (
            <div className="empty-state">
              <p>Failed to load query performance: {queryPerformanceError}</p>
              <button type="button" className="refresh-btn mono mt-4" onClick={retryQueryPerformance}>
                Retry query log load
              </button>
            </div>
          ) : queryPerformance ? (
            <QueryPerformancePanel payload={queryPerformance} />
          ) : (
            <div className="empty-state">Open this tab to load query performance data.</div>
          )}
        </section>
      )}
    </div>
  );
}
