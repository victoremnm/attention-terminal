"use client";

import { useMemo, useState } from "react";
import type { TimelapseWindowRow, TimelapseSummaryRow, TimelapseEventRow } from "@/lib/queries";

const THEME_COLORS: Record<string, string> = {
  "active-development": "var(--green)",
  "code-review": "var(--blue)",
  "issue-tracking": "var(--red)",
  "issue-resolution": "var(--purple)",
  release: "var(--orange)",
  "community-growth": "var(--gold)",
  collaborative: "var(--cyan)",
  branching: "var(--cyan)",
  cleanup: "var(--muted)",
};

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

function formatHour(start: string): string {
  if (!start) return "";
  const d = new Date(start.replace(" ", "T") + "Z");
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    hour12: true,
  });
}

function ThemeBadge({ theme }: { theme: string }) {
  return (
    <span
      className="timelapse-theme-badge mono"
      style={{ borderColor: THEME_COLORS[theme] ?? "var(--line-soft)", color: THEME_COLORS[theme] ?? "var(--muted)" }}
    >
      {theme}
    </span>
  );
}

function WindowCard({
  window: w,
  events,
  onToggle,
  isOpen,
}: {
  window: TimelapseWindowRow;
  events: TimelapseEventRow[];
  onToggle: () => void;
  isOpen: boolean;
}) {
  const count = Number(w.event_count);
  return (
    <div className={`timelapse-window ${isOpen ? "timelapse-window--open" : ""}`}>
      <button className="timelapse-window-head" onClick={onToggle} type="button">
        <div className="timelapse-window-meta">
          <span className="mono timelapse-window-hour">{formatHour(w.window_start)}</span>
          <span className="mono timelapse-window-count">{count.toLocaleString()} events</span>
        </div>
        <p className="timelapse-commentary">{w.commentary}</p>
        <div className="timelapse-themes">
          {(w.themes ?? []).map((t) => (
            <ThemeBadge key={t} theme={t} />
          ))}
        </div>
      </button>
      {isOpen && (
        <div className="timelapse-events-panel">
          {(w.key_events ?? []).map((ke, i) => (
            <div key={i} className="timelapse-key-event mono">
              {ke}
            </div>
          ))}
          {events.length > 0 && (
            <div className="timelapse-event-list">
              {events.map((ev) => (
                <div key={ev.event_id} className="timelapse-event-row">
                  <span
                    className="mono timelapse-event-type"
                    style={{ color: TYPE_COLORS[ev.event_type] ?? "var(--muted)" }}
                  >
                    {ev.event_type.replace("Event", "")}
                  </span>
                  <span className="timelapse-event-actor">{ev.actor_login}</span>
                  <span className="timelapse-event-title mono">
                    {ev.title ? `#${ev.number} ${ev.title}` : ev.payload_summary || ev.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TimelapseSurfaceProps {
  windows: TimelapseWindowRow[];
  summary: TimelapseSummaryRow;
  events: TimelapseEventRow[];
  repoName: string;
}

export function TimelapseSurface({ windows, summary, events, repoName }: TimelapseSurfaceProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const totalEvents = Number(summary.total_events);
  const totalWindows = Number(summary.total_windows);
  const totalContributors = Number(summary.unique_contributors);

  const eventByWindow = useMemo(() => {
    const grouped: Record<string, TimelapseEventRow[]> = {};
    for (const ev of events) {
      const windowKey = ev.created_at.slice(0, 13) + ":00:00";
      (grouped[windowKey] ??= []).push(ev);
    }
    return grouped;
  }, [events]);

  return (
    <main className="timelapse-shell">
      <header className="timelapse-head">
        <div>
          <h2 className="timelapse-repo-name">{repoName}</h2>
          <p className="mono timelapse-subtitle">REPO TIMELAPSE · LAST 24 H</p>
        </div>
        <a
          href={`https://github.com/${repoName}`}
          target="_blank"
          rel="noreferrer"
          className="mono timelapse-gh-link"
        >
          GitHub
        </a>
      </header>

      <div className="timelapse-summary-grid">
        <div className="timelapse-stat-card">
          <span className="timelapse-stat-value">{totalWindows}</span>
          <span className="timelapse-stat-label mono">WINDOWS</span>
        </div>
        <div className="timelapse-stat-card">
          <span className="timelapse-stat-value">{totalEvents.toLocaleString()}</span>
          <span className="timelapse-stat-label mono">EVENTS</span>
        </div>
        <div className="timelapse-stat-card">
          <span className="timelapse-stat-value">{totalContributors.toLocaleString()}</span>
          <span className="timelapse-stat-label mono">CONTRIBUTORS</span>
        </div>
      </div>

      <section className="timelapse-timeline">
        {windows.length === 0 && (
          <p className="muted timelapse-empty">No timelapse data yet — the next hourly generator run will populate this.</p>
        )}
        {windows.map((w, i) => (
            <WindowCard
              key={w.window_start}
              window={w}
              events={eventByWindow[w.window_start] ?? []}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
      </section>
    </main>
  );
}
