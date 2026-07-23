"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActiveContributionRow, RepoActivitySort, RepoWindow, RepoWindowRow } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import {
  ACTIVE_COLUMNS,
  ATTENTION_COLUMNS,
  DEFAULT_PREFERENCES,
  RANKING_MODES,
  activeMeasureValue,
  activeRowView,
  attentionMeasureValue,
  attentionRowView,
  compareByField,
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
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";

// skills.sh-style tabs, mapped to the fixed repoActivityWindow windows.
const TABS: Array<{ key: RepoWindow; label: string }> = [
  { key: "1d", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

const NUMBER = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 100;

// Fields the "attention" family can sort/filter by server-side (issue #137's
// whitelisted RepoActivitySort set). Kept local so a header click can be
// type-checked against exactly what /api/trending accepts.
const ATTENTION_SORT_FIELDS: RepoActivitySort[] = [
  "events",
  "actors",
  "pushes",
  "commits",
  "stars",
  "forks",
  "prsOpened",
  "prsMerged",
];

function RankRow({
  view,
  rank,
  state,
  onOpen,
}: {
  view: RankingRowView;
  rank: number;
  state: "idle" | "selected" | "loading";
  onOpen: (repo: string) => void;
}) {
  const subline = [view.language, view.description].filter(Boolean).join(" · ");
  const chipSummary = view.chips.map((c) => `${NUMBER.format(c.value)} ${c.label}`).join(", ");
  return (
    <button
      type="button"
      className="rank-row mono"
      data-state={state}
      data-mode={view.spark ? "attention" : "active"}
      onClick={() => onOpen(view.repoName)}
      aria-pressed={state === "selected"}
      aria-label={`${view.repoName}. ${NUMBER.format(view.primaryValue)} ${view.primaryLabel}${
        chipSummary ? `. ${chipSummary}` : ""
      }${view.botOnly ? ". Bot-only activity" : ""}.`}
    >
      <span className="rank-num">{rank}</span>
      <span className="rank-repo">
        <b>{view.repoName}</b>
        {subline ? <em>{subline}</em> : null}
        {view.botOnly ? <em className="rank-badge">bot-only</em> : null}
      </span>
      {view.spark ? (
        <span className="rank-spark">
          <Sparkline data={view.spark} color="var(--cyan)" w={148} h={24} />
        </span>
      ) : null}
      <span className="rank-stats">
        {view.chips.map((chip) => (
          <span key={chip.key}>
            <b>{NUMBER.format(chip.value)}</b> {chip.label}
          </span>
        ))}
      </span>
      <span className="rank-events">{NUMBER.format(view.primaryValue)}</span>
    </button>
  );
}

function SortHeader({
  field,
  label,
  activeField,
  direction,
  onSort,
}: {
  field: string;
  label: string;
  activeField: string;
  direction: "asc" | "desc";
  onSort: (field: string) => void;
}) {
  const isActive = field === activeField;
  return (
    <button
      type="button"
      className="rank-sort-header"
      onClick={() => onSort(field)}
      aria-pressed={isActive}
      aria-label={`Sort by ${label}${isActive ? `, currently ${direction === "desc" ? "descending" : "ascending"}` : ""}`}
    >
      {label}
      {isActive ? <span aria-hidden="true">{direction === "desc" ? " ↓" : " ↑"}</span> : null}
    </button>
  );
}

export function RepoRankings({ windows }: { windows: Record<RepoWindow, RepoWindowRow[]> }) {
  const [activeWindow, setActiveWindow] = useState<RepoWindow>("1d");
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState<RankingsPreferences>(DEFAULT_PREFERENCES);
  const [controlsOpen, setControlsOpen] = useState(false);
  const hydrated = useRef(false);

  // Attention family: page cache per window/sort/direction, seeded page 0
  // from server-rendered `windows` for the default sort so switching time
  // windows on first load never issues a client fetch.
  const [attentionCache, setAttentionCache] = useState<Record<string, RepoWindowRow[]>>(() => ({
    "1d|events|desc|0": windows["1d"] ?? [],
    "7d|events|desc|0": windows["7d"] ?? [],
    "30d|events|desc|0": windows["30d"] ?? [],
    "td|events|desc|0": windows.td ?? [],
  }));
  const [attentionPage, setAttentionPage] = useState(0);
  const [activeRows, setActiveRows] = useState<ActiveContributionRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | undefined>();

  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [drilldown, setDrilldown] = useState<RepoDrilldownPayload | undefined>();
  const [loadingRepo, setLoadingRepo] = useState<string | undefined>();
  const [drilldownError, setDrilldownError] = useState<string | undefined>();
  const drilldownRequest = useRef(0);
  const drilldownAbort = useRef<AbortController | undefined>(undefined);
  const rowsRequest = useRef(0);

  useEffect(() => () => drilldownAbort.current?.abort(), []);

  // Hydrate persisted preferences after mount only, so SSR/CSR markup match
  // on first paint (issue #135: "persist preferences locally").
  useEffect(() => {
    const stored = loadPreferences(typeof window === "undefined" ? undefined : window.localStorage);
    setPrefs(stored);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    savePreferences(typeof window === "undefined" ? undefined : window.localStorage, prefs);
  }, [prefs]);

  const currentModeCfg = modeConfig(prefs.mode);
  const isActiveSource = currentModeCfg.source === "active";

  // The field actually sent to the server for the "active" family must stay
  // within {"commits","pushes"} - anything else is a client-only re-sort of
  // the already-fetched top-N (issue #139: mode drives the query; header
  // clicks beyond that only reorder what's on screen).
  const activeServerSort = prefs.sortField === "pushes" ? "pushes" : "commits";
  const attentionCacheKey = `${activeWindow}|${prefs.sortField}|${prefs.sortDirection}|${attentionPage}`;

  // Fetch whenever the effective query changes. Attention-family requests
  // hit the already-cached page when available; active-family always
  // re-fetches (no offset pagination in the anti-noise ranking - issue #140).
  useEffect(() => {
    let cancelled = false;
    const requestId = rowsRequest.current + 1;
    rowsRequest.current = requestId;

    async function run() {
      setRowsError(undefined);
      if (!isActiveSource) {
        if (attentionCache[attentionCacheKey]) return;
        setRowsLoading(true);
        try {
          const sort = ATTENTION_SORT_FIELDS.includes(prefs.sortField as RepoActivitySort)
            ? (prefs.sortField as RepoActivitySort)
            : "events";
          const params = new URLSearchParams({
            window: activeWindow,
            limit: String(PAGE_SIZE),
            offset: String(attentionPage * PAGE_SIZE),
            sort,
            direction: prefs.sortDirection,
            search: query.trim(),
          });
          const response = await fetch(`/api/trending?${params.toString()}`);
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "trending page failed");
          if (cancelled || rowsRequest.current !== requestId) return;
          const nextRows = Array.isArray(body.data) ? (body.data as RepoWindowRow[]) : [];
          setAttentionCache((current) => ({ ...current, [attentionCacheKey]: nextRows }));
        } catch (error) {
          if (cancelled || rowsRequest.current !== requestId) return;
          setRowsError(error instanceof Error ? error.message : "trending page failed");
        } finally {
          if (!cancelled && rowsRequest.current === requestId) setRowsLoading(false);
        }
        return;
      }

      setRowsLoading(true);
      try {
        const params = new URLSearchParams({
          window: activeWindow === "td" ? "30d" : activeWindow,
          sort: activeServerSort,
          limit: "100",
        });
        const response = await fetch(`/api/trending-active?${params.toString()}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "active ranking failed");
        if (cancelled || rowsRequest.current !== requestId) return;
        setActiveRows(Array.isArray(body.data) ? (body.data as ActiveContributionRow[]) : []);
      } catch (error) {
        if (cancelled || rowsRequest.current !== requestId) return;
        setRowsError(error instanceof Error ? error.message : "active ranking failed");
      } finally {
        if (!cancelled && rowsRequest.current === requestId) setRowsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Search is intentionally excluded from the active-family fetch key -
    // that family always returns its full top-N and is filtered client-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWindow, isActiveSource, activeServerSort, attentionCacheKey, attentionPage, prefs.sortField, prefs.sortDirection, query]);

  const sourceRows = isActiveSource ? activeRows : attentionCache[attentionCacheKey] ?? [];

  // Sort the currently loaded rows by whatever field/direction is active.
  // For the attention family this mirrors the server's own order (search/sort
  // both round-trip through /api/trending); for the active family, and for
  // any attention field the server didn't sort by (defensive), it's the
  // actual sort.
  const sortedRows = useMemo(() => {
    if (isActiveSource) {
      const decorated = activeRows.map((row) => ({ row, __v: activeMeasureValue(row, prefs.sortField) }));
      decorated.sort(compareByField("__v", prefs.sortDirection));
      return decorated.map((d) => d.row);
    }
    const rows = attentionCache[attentionCacheKey] ?? [];
    const decorated = rows.map((row) => ({ row, __v: attentionMeasureValue(row, prefs.sortField) }));
    decorated.sort(compareByField("__v", prefs.sortDirection));
    return decorated.map((d) => d.row);
  }, [isActiveSource, activeRows, attentionCache, attentionCacheKey, prefs.sortField, prefs.sortDirection]);

  const rowViews = useMemo<RankingRowView[]>(() => {
    if (isActiveSource) {
      return (sortedRows as ActiveContributionRow[]).map((r) => activeRowView(r, prefs.sortField, prefs.activeColumns));
    }
    return (sortedRows as RepoWindowRow[]).map((r) => attentionRowView(r, prefs.sortField, prefs.attentionColumns));
  }, [isActiveSource, sortedRows, prefs.sortField, prefs.activeColumns, prefs.attentionColumns]);

  const filteredViews = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rowViews.filter((view) => {
      if (needle && !view.searchText.includes(needle)) return false;
      if (!isActiveSource && prefs.minStars > 0 && view.githubStars < prefs.minStars) return false;
      if (isActiveSource && prefs.hideBotOnly && view.botOnly) return false;
      return true;
    });
  }, [rowViews, query, isActiveSource, prefs.minStars, prefs.hideBotOnly]);

  const summary = useMemo(() => {
    const totals = rowViews.reduce(
      (acc, view) => {
        acc.primary += view.primaryValue;
        return acc;
      },
      { primary: 0 }
    );
    const top = rowViews[0];
    return {
      visible: filteredViews.length,
      total: rowViews.length,
      topRepo: top?.repoName ?? "—",
      topValue: top?.primaryValue ?? 0,
      ...totals,
    };
  }, [rowViews, filteredViews.length]);

  function selectMode(mode: RankingMode) {
    const cfg = modeConfig(mode);
    setPrefs((p) => ({ ...p, mode, sortField: cfg.querySort, sortDirection: "desc" }));
    setAttentionPage(0);
  }

  function handleSort(field: string) {
    setPrefs((p) => {
      const direction = nextSortDirection(p.sortField, p.sortDirection, field);
      // Keep the mode indicator honest: if the clicked field matches a
      // preset for the current source, adopt that preset; otherwise this is
      // a "custom" sort within the same source (still fully valid).
      const preset = RANKING_MODES.find((m) => m.source === currentModeCfg.source && m.querySort === field);
      return { ...p, sortField: field, sortDirection: direction, mode: preset?.key ?? p.mode };
    });
    setAttentionPage(0);
  }

  function resetToDefaults() {
    setPrefs(DEFAULT_PREFERENCES);
    setAttentionPage(0);
  }

  async function loadAttentionPage(nextPage: number) {
    if (nextPage < 0 || rowsLoading) return;
    setAttentionPage(nextPage);
  }

  // Mirrors TickerRail.openRepo: abort-safe, last-click-wins drill-down fetch.
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

  const columnDefs = isActiveSource ? ACTIVE_COLUMNS : ATTENTION_COLUMNS;
  const visibleColumns: string[] = isActiveSource ? prefs.activeColumns : prefs.attentionColumns;

  return (
    <section className="rankings" aria-label="Repo rankings">
      <div className="rankings-summary mono" aria-label="Trending summary">
        <div className="rankings-summary-card">
          <span>visible</span>
          <b>{summary.visible}</b>
          <em>of {summary.total}</em>
        </div>
        <div className="rankings-summary-card">
          <span>{currentModeCfg.label.toLowerCase()}</span>
          <b>{NUMBER.format(summary.primary)}</b>
          <em>{activeWindow} window</em>
        </div>
        <div className="rankings-summary-card">
          <span>leader</span>
          <b title={summary.topRepo}>{summary.topRepo}</b>
          <em>
            {NUMBER.format(summary.topValue)} {rowViews[0]?.primaryLabel ?? ""}
          </em>
        </div>
        <div className="rankings-summary-card">
          <span>mode</span>
          <b>{currentModeCfg.label}</b>
          <em title={currentModeCfg.description}>{currentModeCfg.description}</em>
        </div>
      </div>

      <div className="rankings-modes mono" role="group" aria-label="Ranking mode">
        {RANKING_MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className="rankings-mode-button"
            aria-pressed={prefs.mode === mode.key}
            onClick={() => selectMode(mode.key)}
          >
            {mode.label}
          </button>
        ))}
        <button
          type="button"
          className="rankings-controls-toggle"
          aria-expanded={controlsOpen}
          aria-controls="rankings-controls-panel"
          onClick={() => setControlsOpen((v) => !v)}
        >
          ⚙ Filters &amp; Columns
        </button>
      </div>
      <p className="rankings-mode-caption mono" aria-live="polite">
        {currentModeCfg.description}
      </p>

      {controlsOpen ? (
        <div
          id="rankings-controls-panel"
          className="rankings-controls-panel mono"
          role="region"
          aria-label="Filters and columns"
        >
          <div className="rankings-controls-section">
            <h3>Filters</h3>
            {!isActiveSource ? (
              <label className="rankings-controls-field">
                Min ★ stars
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={prefs.minStars}
                  onChange={(e) => setPrefs((p) => ({ ...p, minStars: Math.max(0, Number(e.target.value) || 0) }))}
                />
              </label>
            ) : (
              <label className="rankings-controls-field rankings-controls-checkbox">
                <input
                  type="checkbox"
                  checked={prefs.hideBotOnly}
                  onChange={(e) => setPrefs((p) => ({ ...p, hideBotOnly: e.target.checked }))}
                />
                Hide bot-only activity
              </label>
            )}
          </div>
          <div className="rankings-controls-section">
            <h3>Columns</h3>
            <ul className="rankings-columns-list">
              {columnDefs.map((col) => {
                const isVisible = visibleColumns.includes(col.key);
                const idx = visibleColumns.indexOf(col.key);
                return (
                  <li key={col.key} className="rankings-columns-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() =>
                          setPrefs((p) =>
                            isActiveSource
                              ? {
                                  ...p,
                                  activeColumns: toggleColumn(
                                    p.activeColumns,
                                    ACTIVE_COLUMNS.map((c) => c.key),
                                    col.key as ActiveColumnKey
                                  ),
                                }
                              : {
                                  ...p,
                                  attentionColumns: toggleColumn(
                                    p.attentionColumns,
                                    ATTENTION_COLUMNS.map((c) => c.key),
                                    col.key as AttentionColumnKey
                                  ),
                                }
                          )
                        }
                      />
                      <span title={col.hint}>{col.label}</span>
                    </label>
                    <span className="rankings-columns-reorder">
                      <button
                        type="button"
                        disabled={!isVisible || idx <= 0}
                        aria-label={`Move ${col.label} earlier`}
                        onClick={() =>
                          setPrefs((p) =>
                            isActiveSource
                              ? { ...p, activeColumns: moveColumn(p.activeColumns, col.key as ActiveColumnKey, -1) }
                              : {
                                  ...p,
                                  attentionColumns: moveColumn(p.attentionColumns, col.key as AttentionColumnKey, -1),
                                }
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={!isVisible || idx === -1 || idx >= visibleColumns.length - 1}
                        aria-label={`Move ${col.label} later`}
                        onClick={() =>
                          setPrefs((p) =>
                            isActiveSource
                              ? { ...p, activeColumns: moveColumn(p.activeColumns, col.key as ActiveColumnKey, 1) }
                              : {
                                  ...p,
                                  attentionColumns: moveColumn(p.attentionColumns, col.key as AttentionColumnKey, 1),
                                }
                          )
                        }
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <button type="button" className="rankings-reset-button" onClick={resetToDefaults}>
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
            aria-selected={activeWindow === tab.key}
            className="rankings-tab"
            onClick={() => {
              setActiveWindow(tab.key);
              setAttentionPage(0);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rankings-meta mono" aria-live="polite">
        <span>{NUMBER.format(summary.visible)} shown</span>
        <span>{NUMBER.format(summary.total)} loaded</span>
        {query.trim() ? <span>filtered by &ldquo;{query.trim()}&rdquo;</span> : null}
        {rowsLoading ? <span>loading…</span> : null}
      </div>

      <div className="rank-head mono" data-mode={isActiveSource ? "active" : "attention"}>
        <span className="rank-num">#</span>
        <span className="rank-repo-head">REPO</span>
        {!isActiveSource ? <span className="rank-spark">ACTIVITY</span> : null}
        <span className="rank-stats-head">
          {columnDefs
            .filter((c) => visibleColumns.includes(c.key))
            .map((c) => (
              <SortHeader
                key={c.key}
                field={c.key}
                label={c.label}
                activeField={prefs.sortField}
                direction={prefs.sortDirection}
                onSort={handleSort}
              />
            ))}
        </span>
        <SortHeader
          field={isActiveSource ? activeServerSort : "events"}
          label={(rowViews[0]?.primaryLabel ?? currentModeCfg.querySort).toUpperCase()}
          activeField={prefs.sortField}
          direction={prefs.sortDirection}
          onSort={handleSort}
        />
      </div>

      {filteredViews.length === 0 ? (
        <div className="repo-empty mono">
          {rowsLoading ? "Loading…" : query ? `No repos match "${query}".` : "No repos in this window."}
        </div>
      ) : (
        filteredViews.map((view, i) => (
          <RankRow
            key={view.key}
            view={view}
            rank={!isActiveSource ? attentionPage * PAGE_SIZE + i + 1 : i + 1}
            state={loadingRepo === view.repoName ? "loading" : selectedRepo === view.repoName ? "selected" : "idle"}
            onOpen={openRepo}
          />
        ))
      )}

      {!isActiveSource ? (
        <div className="rankings-pagination mono" aria-label="Trending pagination">
          <button
            type="button"
            className="rankings-pagination-button"
            disabled={attentionPage === 0 || rowsLoading}
            onClick={() => void loadAttentionPage(attentionPage - 1)}
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {attentionPage + 1} · {rowsLoading ? "loading..." : `up to ${PAGE_SIZE} repos`}
          </span>
          <button
            type="button"
            className="rankings-pagination-button"
            disabled={rowsLoading || sourceRows.length < PAGE_SIZE}
            onClick={() => void loadAttentionPage(attentionPage + 1)}
          >
            Next
          </button>
        </div>
      ) : (
        <p className="rankings-hint mono">
          Active-contribution rankings show the top {sourceRows.length || 0} repos for this window — not paginated.
        </p>
      )}
      {rowsError ? (
        <div className="repo-empty mono" role="alert">
          ! {rowsError}
        </div>
      ) : null}

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
