"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActiveContributionRow, RepoWindow, RepoWindowRow } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";
import {
  ACTIVE_COLUMNS,
  ATTENTION_COLUMNS,
  DEFAULT_PREFERENCES,
  RANKING_MODES,
  activeRowView,
  attentionRowView,
  loadPreferences,
  modeConfig,
  moveColumn,
  nextSortDirection,
  savePreferences,
  toggleColumn,
  type ActiveColumnKey,
  type AttentionColumnKey,
  type RankingMode,
  type RankingRowView,
  type RankingsPreferences,
} from "@/lib/rankings-preferences";

const TABS: Array<{ key: RepoWindow; label: string }> = [
  { key: "1d", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

const NUMBER = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 100;
const ACTIVE_LIMIT = 40;

function readInitialPrefs(): RankingsPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  return loadPreferences(window.localStorage);
}

function RankRow({
  view,
  rank,
  state,
  onOpen,
  columns,
}: {
  view: RankingRowView;
  rank: number;
  state: "idle" | "selected" | "loading";
  onOpen: (repo: string) => void;
  columns: readonly { key: string; label: string }[];
}) {
  const subline = [view.language, view.description].filter(Boolean).join(" · ");
  const spark = view.spark;
  const trend =
    spark && spark.length >= 2
      ? spark[spark.length - 1] > spark[0]
        ? "trending up"
        : spark[spark.length - 1] < spark[0]
          ? "trending down"
          : "stable"
      : "";
  const chipSummary = view.chips.map((c) => `${NUMBER.format(c.value)} ${c.label}`).join(", ");
  const chipValue = (key: string) => view.chips.find((c) => c.key === key)?.value ?? 0;
  return (
    <tr className="rank-row mono" data-state={state}>
      <td className="rank-num">{rank}</td>
      <td className="rank-repo">
        <button
          type="button"
          onClick={() => onOpen(view.repoName)}
          aria-pressed={state === "selected"}
          aria-label={`${view.repoName}. ${NUMBER.format(view.primaryValue)} ${view.primaryLabel}${trend ? `, ${trend}` : ""}. ${chipSummary}.`}
        >
          <b>{view.repoName}</b>
          {subline ? <em>{subline}</em> : null}
          {view.botOnly ? <span className="rank-bot-badge">bot-only</span> : null}
        </button>
      </td>
      <td className="rank-spark">{spark ? <Sparkline data={spark} color="var(--cyan)" w={110} h={22} /> : null}</td>
      {columns.map((col) => (
        <td key={col.key} className="rank-cell-num">
          {NUMBER.format(chipValue(col.key))}
        </td>
      ))}
      <td className="rank-events">{NUMBER.format(view.primaryValue)}</td>
    </tr>
  );
}

export function RepoRankings({ windows }: { windows: Record<RepoWindow, RepoWindowRow[]> }) {
  const [prefs, setPrefs] = useState<RankingsPreferences>(readInitialPrefs);
  const [activeWindowTab, setActiveWindowTab] = useState<RepoWindow>("1d");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  const [attentionRawRows, setAttentionRawRows] = useState<RepoWindowRow[]>(() => windows["1d"] ?? []);
  const [activeRawRows, setActiveRawRows] = useState<ActiveContributionRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | undefined>();

  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [drilldown, setDrilldown] = useState<RepoDrilldownPayload | undefined>();
  const [loadingRepo, setLoadingRepo] = useState<string | undefined>();
  const [drilldownError, setDrilldownError] = useState<string | undefined>();
  const drilldownRequest = useRef(0);
  const drilldownAbort = useRef<AbortController | undefined>(undefined);

  const dataRequestId = useRef(0);
  const mountedGuard = useRef(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => () => drilldownAbort.current?.abort(), []);

  useEffect(() => {
    savePreferences(typeof window === "undefined" ? undefined : window.localStorage, prefs);
  }, [prefs]);

  const source = modeConfig(prefs.mode).source;

  useEffect(() => {
    if (!mountedGuard.current) {
      mountedGuard.current = true;
      return;
    }
    const requestId = ++dataRequestId.current;
    const controller = new AbortController();
    setRowsLoading(true);
    setRowsError(undefined);

    const url =
      source === "attention"
        ? `/api/trending?${new URLSearchParams({
            window: activeWindowTab,
            limit: String(PAGE_SIZE),
            offset: String(page * PAGE_SIZE),
            sort: prefs.sortField,
            direction: prefs.sortDirection,
          }).toString()}`
        : `/api/trending-active?${new URLSearchParams({
            window: activeWindowTab,
            sort: prefs.sortField,
            limit: String(ACTIVE_LIMIT),
          }).toString()}`;

    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "trending query failed");
        if (dataRequestId.current !== requestId) return;
        if (source === "attention") {
          setAttentionRawRows(Array.isArray(body.data) ? (body.data as RepoWindowRow[]) : []);
        } else {
          setActiveRawRows(Array.isArray(body.data) ? (body.data as ActiveContributionRow[]) : []);
        }
      } catch (error) {
        if (controller.signal.aborted || dataRequestId.current !== requestId) return;
        setRowsError(error instanceof Error ? error.message : "trending query failed");
      } finally {
        if (dataRequestId.current === requestId) setRowsLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, prefs.sortField, prefs.sortDirection, activeWindowTab, page, refreshNonce]);

  const hasSubstantiveWork = (r: { pushes: number; prsOpened: number; prsMerged: number }) =>
    !prefs.requireSubstantiveWork || (r.pushes > 0 && (r.prsOpened > 0 || r.prsMerged > 0));

  const attentionRowsFiltered = useMemo(
    () => attentionRawRows.filter(hasSubstantiveWork),
    [attentionRawRows, prefs.requireSubstantiveWork]
  );

  const activeRowsFiltered = useMemo(
    () => activeRawRows.filter(hasSubstantiveWork),
    [activeRawRows, prefs.requireSubstantiveWork]
  );

  const rows = useMemo<RankingRowView[]>(() => {
    if (source === "attention") {
      return attentionRowsFiltered.map((r) => attentionRowView(r, prefs.sortField, prefs.attentionColumns));
    }
    return activeRowsFiltered.map((r) => activeRowView(r, prefs.sortField, prefs.activeColumns));
  }, [source, attentionRowsFiltered, activeRowsFiltered, prefs.sortField, prefs.attentionColumns, prefs.activeColumns]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((v) => {
      if (needle && !v.searchText.includes(needle)) return false;
      if (prefs.minStars > 0 && v.githubStars < prefs.minStars) return false;
      if (prefs.hideBotOnly && v.botOnly) return false;
      return true;
    });
  }, [rows, query, prefs.minStars, prefs.hideBotOnly]);

  const summary = useMemo(() => {
    const totals = rows.reduce(
      (acc, v) => {
        acc.primary += v.primaryValue;
        return acc;
      },
      { primary: 0 }
    );
    const top = rows[0];
    return {
      visible: filteredRows.length,
      total: rows.length,
      topRepo: top?.repoName ?? "—",
      topValue: top?.primaryValue ?? 0,
      topLabel: top?.primaryLabel ?? "events",
      primaryTotal: totals.primary,
    };
  }, [rows, filteredRows.length]);

  function handleSelectMode(mode: RankingMode) {
    setPage(0);
    setPrefs((prev) => ({ ...prev, mode, sortField: modeConfig(mode).querySort, sortDirection: "desc" }));
  }

  function handleSelectWindow(win: RepoWindow) {
    setPage(0);
    setActiveWindowTab(win);
  }

  function handleSort(field: string) {
    setPage(0);
    setPrefs((prev) => ({
      ...prev,
      sortField: field,
      sortDirection: nextSortDirection(prev.sortField, prev.sortDirection, field),
    }));
  }

  function handleToggleAttentionColumn(key: AttentionColumnKey) {
    setPrefs((prev) => ({
      ...prev,
      attentionColumns: toggleColumn(prev.attentionColumns, ATTENTION_COLUMNS.map((c) => c.key), key),
    }));
  }

  function handleToggleActiveColumn(key: ActiveColumnKey) {
    setPrefs((prev) => ({
      ...prev,
      activeColumns: toggleColumn(prev.activeColumns, ACTIVE_COLUMNS.map((c) => c.key), key),
    }));
  }

  function handleMoveAttentionColumn(key: AttentionColumnKey, direction: -1 | 1) {
    setPrefs((prev) => ({ ...prev, attentionColumns: moveColumn(prev.attentionColumns, key, direction) }));
  }

  function handleMoveActiveColumn(key: ActiveColumnKey, direction: -1 | 1) {
    setPrefs((prev) => ({ ...prev, activeColumns: moveColumn(prev.activeColumns, key, direction) }));
  }

  function handleRefresh() {
    setPrefs((prev) => (prev.sortDirection === "desc" ? prev : { ...prev, sortDirection: "desc" }));
    setPage(0);
    setRefreshNonce((n) => n + 1);
  }

  function handleResetDefaults() {
    setPage(0);
    setPrefs(DEFAULT_PREFERENCES);
  }

  async function openRepo(repoName: string) {
    const requestId = drilldownRequest.current + 1;
    drilldownRequest.current = requestId;
    drilldownAbort.current?.abort();
    const controller = new AbortController();
    drilldownAbort.current = controller;
    setSelectedRepo(repoName);
    setLoadingRepo(repoName);
    setDrilldownError(undefined);
    try {
      const res = await fetch(`/api/repo-drilldown?repo=${encodeURIComponent(repoName)}`, {
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "repo drill-down failed");
      if (drilldownRequest.current !== requestId) return;
      setDrilldown(body as RepoDrilldownPayload);
    } catch (error) {
      if (controller.signal.aborted || drilldownRequest.current !== requestId) return;
      setDrilldown(undefined);
      setDrilldownError(error instanceof Error ? error.message : "repo drill-down failed");
    } finally {
      if (drilldownRequest.current === requestId) setLoadingRepo(undefined);
    }
  }

  const headerColumns =
    source === "attention"
      ? ATTENTION_COLUMNS.filter((c) => prefs.attentionColumns.includes(c.key))
      : ACTIVE_COLUMNS.filter((c) => prefs.activeColumns.includes(c.key));

  const primaryHeaderLabel = (filteredRows[0]?.primaryLabel ?? rows[0]?.primaryLabel ?? prefs.sortField).toUpperCase();

  return (
    <section className="rankings" aria-label="Repo rankings">
      <div className="rankings-summary mono" aria-label="Trending summary">
        <div className="rankings-summary-card">
          <span>visible</span>
          <b>{summary.visible}</b>
          <em>of {summary.total}</em>
        </div>
        <div className="rankings-summary-card">
          <span>{summary.topLabel}</span>
          <b>{NUMBER.format(summary.primaryTotal)}</b>
          <em>{activeWindowTab} window</em>
        </div>
        <div className="rankings-summary-card">
          <span>leader</span>
          <b title={summary.topRepo}>{summary.topRepo}</b>
          <em>
            {NUMBER.format(summary.topValue)} {summary.topLabel}
          </em>
        </div>
        <div className="rankings-summary-card">
          <span>mode</span>
          <b>{modeConfig(prefs.mode).label}</b>
          <em>{source === "attention" ? "paginated" : "top " + ACTIVE_LIMIT}</em>
        </div>
      </div>

      <div className="rankings-modes" role="group" aria-label="Ranking mode">
        {RANKING_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className="rankings-mode-button"
            aria-pressed={prefs.mode === m.key}
            onClick={() => handleSelectMode(m.key)}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          className="rankings-controls-toggle"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
        >
          Filters & Columns
        </button>
      </div>
      <p className="rankings-mode-caption">{modeConfig(prefs.mode).description}</p>

      {panelOpen ? (
        <div className="rankings-controls-panel" role="region" aria-label="Filters and columns">
          <div className="rankings-controls-section">
            <h3>Filters</h3>
            <label className="rankings-controls-field">
              Min total ★ (all-time, independent of window)
              <input
                type="number"
                min={0}
                value={prefs.minStars}
                onChange={(e) => setPrefs((prev) => ({ ...prev, minStars: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </label>
            <label className="rankings-controls-field rankings-controls-checkbox">
              <input
                type="checkbox"
                checked={prefs.requireSubstantiveWork}
                onChange={(e) => setPrefs((prev) => ({ ...prev, requireSubstantiveWork: e.target.checked }))}
              />
              Hide repos with no pushes or PR activity (substantive-work floor, applies to every mode)
            </label>
            <label className="rankings-controls-field rankings-controls-checkbox">
              <input
                type="checkbox"
                checked={prefs.hideBotOnly}
                onChange={(e) => setPrefs((prev) => ({ ...prev, hideBotOnly: e.target.checked }))}
              />
              Hide bot-only repos
            </label>
          </div>
          <div className="rankings-controls-section">
            <h3>Columns</h3>
            <ul className="rankings-columns-list">
              {source === "attention"
                ? ATTENTION_COLUMNS.map((col) => (
                    <li key={col.key} className="rankings-columns-item">
                      <label>
                        <input
                          type="checkbox"
                          checked={prefs.attentionColumns.includes(col.key)}
                          onChange={() => handleToggleAttentionColumn(col.key)}
                        />
                        {col.label}
                      </label>
                      <span className="rankings-columns-reorder">
                        <button
                          type="button"
                          disabled={!prefs.attentionColumns.includes(col.key) || prefs.attentionColumns.indexOf(col.key) === 0}
                          onClick={() => handleMoveAttentionColumn(col.key, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            !prefs.attentionColumns.includes(col.key) ||
                            prefs.attentionColumns.indexOf(col.key) === prefs.attentionColumns.length - 1
                          }
                          onClick={() => handleMoveAttentionColumn(col.key, 1)}
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  ))
                : ACTIVE_COLUMNS.map((col) => (
                    <li key={col.key} className="rankings-columns-item">
                      <label>
                        <input
                          type="checkbox"
                          checked={prefs.activeColumns.includes(col.key)}
                          onChange={() => handleToggleActiveColumn(col.key)}
                        />
                        {col.label}
                      </label>
                      <span className="rankings-columns-reorder">
                        <button
                          type="button"
                          disabled={!prefs.activeColumns.includes(col.key) || prefs.activeColumns.indexOf(col.key) === 0}
                          onClick={() => handleMoveActiveColumn(col.key, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            !prefs.activeColumns.includes(col.key) ||
                            prefs.activeColumns.indexOf(col.key) === prefs.activeColumns.length - 1
                          }
                          onClick={() => handleMoveActiveColumn(col.key, 1)}
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  ))}
            </ul>
          </div>
          <button type="button" className="rankings-reset-button" onClick={handleResetDefaults}>
            Reset to defaults
          </button>
        </div>
      ) : null}

      <input
        type="search"
        className="rankings-search mono"
        placeholder="Search repo, owner, language, topic..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search repos"
        aria-describedby="rankings-search-hint"
      />
      <p id="rankings-search-hint" className="rankings-hint mono">
        Search against repo name, owner, description, language, topics, and window metrics.
      </p>

      <div className="rankings-tabs mono" role="tablist" aria-label="Time window">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeWindowTab === tab.key}
            className="rankings-tab"
            onClick={() => handleSelectWindow(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <p className="rankings-context mono" aria-live="polite">
        <b>{activeWindowTab}</b> window · {NUMBER.format(summary.visible)} of {NUMBER.format(summary.total)} repos
        {query.trim() ? (
          <>
            {" "}
            · filtered by &ldquo;{query.trim()}&rdquo;
          </>
        ) : (
          <> · ranked by {modeConfig(prefs.mode).label.toLowerCase()}</>
        )}
      </p>

      <div className="rankings-table-wrap">
        <table className="rank-table mono">
          <thead>
            <tr className="rank-head rank-stats-head">
              <th scope="col" className="rank-num">#</th>
              <th scope="col" className="rank-repo">REPO</th>
              <th scope="col" className="rank-spark">ACTIVITY</th>
              {headerColumns.map((col) => {
                const pressed = prefs.sortField === col.key;
                const directionWord = pressed ? (prefs.sortDirection === "desc" ? "descending" : "ascending") : "not sorted";
                return (
                  <th scope="col" key={col.key}>
                    <button
                      type="button"
                      className="rank-sort-header"
                      aria-pressed={pressed}
                      aria-label={`Sort by ${col.label}, currently ${directionWord}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="rank-events">{primaryHeaderLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rowsError ? (
              <tr>
                <td colSpan={headerColumns.length + 4} className="repo-empty mono" role="alert">
                  ! {rowsError}
                </td>
              </tr>
            ) : rows.length === 0 && !query ? (
              <tr>
                <td colSpan={headerColumns.length + 4} className="rankings-loading mono" role="status">
                  No ranking data available for the <b>{activeWindowTab}</b> window
                  {source === "active" ? " and this mode" : ""}. Data appears after the first ingestion run populates
                  per-day aggregates.{" "}
                  <button type="button" className="rankings-refresh-button" onClick={handleRefresh}>
                    Refresh
                  </button>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={headerColumns.length + 4} className="repo-empty mono" role="status">
                  No repos match &ldquo;{query}&rdquo; in the <b>{activeWindowTab}</b> window.
                </td>
              </tr>
            ) : (
              filteredRows.map((view, i) => (
                <RankRow
                  key={view.key}
                  view={view}
                  rank={page * PAGE_SIZE + i + 1}
                  columns={headerColumns}
                  state={loadingRepo === view.repoName ? "loading" : selectedRepo === view.repoName ? "selected" : "idle"}
                  onOpen={openRepo}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {source === "attention" ? (
        <div className="rankings-pagination mono" aria-label="Trending pagination">
          <button
            type="button"
            className="rankings-pagination-button"
            disabled={page === 0 || rowsLoading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {page + 1} · {rowsLoading ? "loading..." : `up to ${PAGE_SIZE} repos`}
          </span>
          <button
            type="button"
            className="rankings-pagination-button"
            disabled={rowsLoading || attentionRawRows.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : (
        <p className="rankings-hint mono">
          Showing top {ACTIVE_LIMIT} repos for this mode — not paginated.
        </p>
      )}

      {(loadingRepo || drilldownError || drilldown) && (
        <div className="ticker-drilldown" aria-live="polite">
          {loadingRepo && <div className="agent-tool mono">rendering {loadingRepo} in background...</div>}
          {drilldownError && (
            <div className="agent-fault mono" role="alert">
              ! {drilldownError}
            </div>
          )}
          {drilldown && <RenderedAnswer payload={drilldown} />}
        </div>
      )}
    </section>
  );
}
