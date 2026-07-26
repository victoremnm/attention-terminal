"use client";

import { useCallback, useState } from "react";
import { SurfaceNav } from "@/components/SurfaceNav";
import { EventTimeline } from "@/components/EventTimeline";
import { EventTypeExplorer } from "@/components/EventTypeExplorer";
import type {
  EventTimelineRow,
  EventVolumeRow,
  FirehoseStatsRow,
  FirehoseRepoSignalRow,
  FirehoseEventMixRow,
  EventTypeHourlyRow,
} from "@/lib/queries";

const TYPE_COLORS: Record<string, string> = {
  PushEvent: "var(--green)",
  WatchEvent: "var(--gold)",
  ForkEvent: "var(--purple)",
  PullRequestEvent: "var(--blue)",
  IssuesEvent: "var(--red)",
  CreateEvent: "var(--cyan)",
  DeleteEvent: "var(--muted)",
  ReleaseEvent: "var(--orange)",
  IssueCommentEvent: "var(--muted)",
  PullRequestReviewEvent: "var(--blue)",
  PullRequestReviewCommentEvent: "var(--blue)",
};

function EventTypeBadge({ type }: { type: string }) {
  return (
    <span
      className="mono"
      style={{
        color: TYPE_COLORS[type] ?? "var(--muted)",
        fontSize: "10px",
        letterSpacing: ".08em",
      }}
    >
      {type.replace("Event", "")}
    </span>
  );
}

function VolumeBar({ row }: { row: EventVolumeRow }) {
  const count = Number(row.event_count);
  const width = Math.min(100, (count / 500) * 100);
  return (
    <div className="events-volume-row">
      <span className="mono events-volume-type">
        <EventTypeBadge type={row.event_type} />
      </span>
      <span className="events-volume-repo">{row.repo_name}</span>
      <div className="events-volume-bar-track">
        <div className="events-volume-bar-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="mono events-volume-count">{row.event_count}</span>
    </div>
  );
}

function StatsCards({ stats }: { stats: FirehoseStatsRow }) {
  return (
    <div className="events-stats-grid">
      <div className="events-stat-card">
        <span className="events-stat-value">{Number(stats.total_events).toLocaleString()}</span>
        <span className="events-stat-label mono">EVENTS_24H</span>
      </div>
      <div className="events-stat-card">
        <span className="events-stat-value">{Number(stats.total_repos).toLocaleString()}</span>
        <span className="events-stat-label mono">REPOS</span>
      </div>
      <div className="events-stat-card">
        <span className="events-stat-value">{Number(stats.total_actors).toLocaleString()}</span>
        <span className="events-stat-label mono">ACTORS</span>
      </div>
    </div>
  );
}

function SignalCard({ row }: { row: FirehoseRepoSignalRow }) {
  return (
    <div className="signal-card">
      <span className="mono signal-repo">{row.repo_name}</span>
      <span className="mono signal-metric" title="Pushes">⊞{row.pushes}</span>
      <span className="mono signal-metric signal-muted" title="Stars">★{row.stars}</span>
      <span className="mono signal-metric signal-muted" title="Forks">⑂{row.forks}</span>
      <span className="mono signal-metric signal-muted" title="PRs opened/closed">⊞PR {row.prs_opened}/{row.prs_closed}</span>
      <span className="mono signal-metric signal-muted" title="Issues opened/closed">I {row.issues_opened}/{row.issues_closed}</span>
      <span className="mono signal-metric signal-muted" title="Releases">●{row.releases}</span>
    </div>
  );
}

function EventMixRow({ row }: { row: FirehoseEventMixRow }) {
  const action = row.action || "(none)";
  return (
    <div className="events-mix-row">
      <span className="events-mix-repo">{row.repo_name}</span>
      <EventTypeBadge type={row.event_type} />
      <span className="mono events-mix-action">{action}</span>
      <span className="mono events-mix-count">{row.event_count}</span>
    </div>
  );
}

interface EventsSurfaceProps {
  timeline: EventTimelineRow[];
  volume: EventVolumeRow[];
  stats: FirehoseStatsRow;
  signalData: FirehoseRepoSignalRow[];
  eventMixData: FirehoseEventMixRow[];
  hourlyData: EventTypeHourlyRow[];
}

export function EventsSurface({
  timeline,
  volume,
  stats,
  signalData,
  eventMixData,
  hourlyData,
}: EventsSurfaceProps) {
  const [filterEventTypes, setFilterEventTypes] = useState<string[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);

  const handleFilterChange = useCallback((types: string[]) => {
    setFilterEventTypes(types);
  }, []);

  return (
    <>
      <SurfaceNav active="events" />
      <main className="events-shell">
        <header className="events-head">
          <p className="skinny-kicker mono">EVENT_FIREHOSE</p>
          <h1>Event Stream</h1>
          <p className="events-copy">
            Live GitHub event firehose with payload drilldown. Ingested from GH Archive every hour.
          </p>
        </header>

        <StatsCards stats={stats} />

        <section className="events-section">
          <h2 className="events-section-title mono">EVENT_TYPE_EXPLORER_24H</h2>
          <EventTypeExplorer
            hourlyData={hourlyData}
            onFilterChange={handleFilterChange}
            activeEventTypes={filterEventTypes}
          />
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">REPO_SIGNALS_24H</h2>
          <div className="events-signal-grid">
            {signalData.length === 0 && (
              <p className="events-empty mono">No signal data yet.</p>
            )}
            {signalData.map((row, i) => (
              <SignalCard key={row.repo_name} row={row} />
            ))}
          </div>
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">ACTIVITY_MIX_24H</h2>
          <div className="events-mix">
            {eventMixData.length === 0 && (
              <p className="events-empty mono">No event mix data yet.</p>
            )}
            {eventMixData.map((row) => (
              <EventMixRow key={`${row.repo_name}-${row.event_type}-${row.action}`} row={row} />
            ))}
          </div>
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">
            TIMELINE
            {filterEventTypes.length > 0 && (
              <span className="mono events-filter-label">
                filtered: {filterEventTypes.map((t) => t.replace("Event", "")).join(", ")}
              </span>
            )}
            {filterLoading && <span className="mono events-filter-loading">loading…</span>}
          </h2>
          <EventTimeline
            rows={timeline}
            eventTypeFilter={filterEventTypes.length > 0 ? filterEventTypes : undefined}
            onFilterLoading={setFilterLoading}
          />
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">VOLUME_BY_REPO_24H</h2>
          <div className="events-volume">
            {volume.length === 0 && (
              <p className="events-empty mono">No volume data yet.</p>
            )}
            {volume.slice(0, 30).map((row, i) => (
              <VolumeBar key={`${row.repo_name}-${row.event_type}-${i}`} row={row} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
