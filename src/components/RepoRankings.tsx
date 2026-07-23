"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import type { RepoWindow, RepoWindowRow } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";
import { Sparkline } from "./charts";

// skills.sh-style tabs, mapped to the fixed repoActivityWindow windows.
const TABS: Array<{ key: RepoWindow; label: string }> = [
  { key: "1d", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

const NUMBER = new Intl.NumberFormat("en-US");

function RankRow({
  row,
  rank,
  state,
  onOpen,
}: {
  row: RepoWindowRow;
  rank: number;
  state: "idle" | "selected" | "loading";
  onOpen: (repo: string) => void;
}) {
  const subline = [row.language, row.description].filter(Boolean).join(" · ");
  const sparkLabel = `${row.events} events over the selected window`;
  return (
    <button
      type="button"
      className="rank-row mono"
      data-state={state}
      onClick={() => onOpen(row.repo_name)}
      aria-pressed={state === "selected"}
      aria-label={`${row.repo_name}. ${sparkLabel}. ${row.pushes} pushes, ${row.commits} commits, ${row.actors} actors, ${row.stars} stars, ${row.forks} forks.`}
    >
      <span className="rank-num">{rank}</span>
      <span className="rank-repo">
        <b>{row.repo_name}</b>
        {subline ? <em>{subline}</em> : null}
      </span>
      <span className="rank-spark">
        <Sparkline data={row.spark} color="var(--cyan)" w={148} h={24} label={`${row.repo_name} activity trend, ${row.spark.length} days, ${row.events} total events`} />
      </span>
      <span className="rank-stats">
        <span><b>{NUMBER.format(row.pushes)}</b> pushes</span>
        <span><b>{NUMBER.format(row.commits)}</b> commits</span>
        <span><b>{NUMBER.format(row.actors)}</b> actors</span>
      </span>
      <span className="rank-events">{NUMBER.format(row.events)}</span>
    </button>
  );
}

export function RepoRankings({ windows }: { windows: Record<RepoWindow, RepoWindowRow[]> }) {
  const [active, setActive] = useState<RepoWindow>("1d");
  const [query, setQuery] = useState("");

  const [selectedRepo, setSelectedRepo] = useState<string | undefined>();
  const [drilldown, setDrilldown] = useState<RepoDrilldownPayload | undefined>();
  const [loadingRepo, setLoadingRepo] = useState<string | undefined>();
  const [drilldownError, setDrilldownError] = useState<string | undefined>();
  const drilldownRequest = useRef(0);
  const drilldownAbort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => drilldownAbort.current?.abort(), []);

  const source = windows[active] ?? [];
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((r) =>
      [
        r.repo_name,
        r.owner,
        r.description,
        r.language,
        ...r.topics,
        String(r.github_stars),
        String(r.events),
        String(r.pushes),
        String(r.commits),
        String(r.actors),
        String(r.forks),
        String(r.stars),
        String(r.prsOpened),
        String(r.prsMerged),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [source, query]);

  const summary = useMemo(() => {
    const totals = source.reduce(
      (acc, row) => {
        acc.events += row.events;
        acc.pushes += row.pushes;
        acc.commits += row.commits;
        acc.actors += row.actors;
        return acc;
      },
      { events: 0, pushes: 0, commits: 0, actors: 0 }
    );
    const top = source[0];
    return {
      visible: rows.length,
      total: source.length,
      topRepo: top?.repo_name ?? "—",
      topEvents: top?.events ?? 0,
      ...totals,
    };
  }, [rows.length, source]);

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

  return (
    <section className="rankings" aria-label="Repo rankings">
      <div className="rankings-summary mono" aria-label="Trending summary">
        <div className="rankings-summary-card">
          <span>visible</span>
          <b>{summary.visible}</b>
          <em>of {summary.total}</em>
        </div>
        <div className="rankings-summary-card">
          <span>events</span>
          <b>{NUMBER.format(summary.events)}</b>
          <em>{active} window</em>
        </div>
        <div className="rankings-summary-card">
          <span>pushes</span>
          <b>{NUMBER.format(summary.pushes)}</b>
          <em>{NUMBER.format(summary.commits)} commits</em>
        </div>
        <div className="rankings-summary-card">
          <span>leader</span>
          <b title={summary.topRepo}>{summary.topRepo}</b>
          <em>{NUMBER.format(summary.topEvents)} events</em>
        </div>
      </div>
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
            aria-selected={active === tab.key}
            className="rankings-tab"
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <p className="rankings-context mono" aria-live="polite">
        <b>{active}</b> window · {NUMBER.format(summary.visible)} of {NUMBER.format(summary.total)} repos
        {query.trim() ? <> · filtered by &ldquo;{query.trim()}&rdquo;</> : <> · ranked by event volume</>}
      </p>

      <div className="rank-head mono">
        <span className="rank-num">#</span>
        <span className="rank-repo">REPO</span>
        <span className="rank-spark">ACTIVITY</span>
        <span className="rank-stats">DETAILS</span>
        <span className="rank-events">EVENTS</span>
      </div>

      {source.length === 0 && !query ? (
        <div className="rankings-loading mono" role="status">
          No ranking data available for the <b>{active}</b> window. Data appears after the first ingestion run populates per-day aggregates.
        </div>
      ) : rows.length === 0 ? (
        <div className="repo-empty mono" role="status">No repos match &ldquo;{query}&rdquo; in the <b>{active}</b> window.</div>
      ) : (
        rows.map((row, i) => (
          <RankRow
            key={row.repo_name}
            row={row}
            rank={i + 1}
            state={
              loadingRepo === row.repo_name
                ? "loading"
                : selectedRepo === row.repo_name
                  ? "selected"
                  : "idle"
            }
            onOpen={openRepo}
          />
        ))
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
