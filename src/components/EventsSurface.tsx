import { SurfaceNav } from "@/components/SurfaceNav";
import {
  eventTimelineFeed,
  eventVolumeFeed,
  firehoseStats,
  firehoseRepoSignal,
  type EventTimelineRow,
  type EventVolumeRow,
  type FirehoseStatsRow,
  type FirehoseRepoSignalRow,
} from "@/lib/queries";

function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
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
  return (
    <span
      className="mono"
      style={{
        color: colors[type] ?? "var(--muted)",
        fontSize: "10px",
        letterSpacing: ".08em",
      }}
    >
      {type.replace("Event", "")}
    </span>
  );
}

function TimelineItem({ row }: { row: EventTimelineRow }) {
  const ts = row.created_at ? new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="events-timeline-item">
      <span className="mono events-timeline-time">{ts}</span>
      <EventTypeBadge type={row.event_type} />
      <span className="events-timeline-actor">{row.actor_login}</span>
      <span className="events-timeline-summary">{row.payload_summary}</span>
      <span className="mono events-timeline-repo">{row.repo_name}</span>
    </div>
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
      <div className="signal-metrics">
        {Number(row.pushes) > 0 && <span className="mono signal-metric">⊞ {row.pushes}</span>}
        {Number(row.stars) > 0 && <span className="mono signal-metric">★ {row.stars}</span>}
        {Number(row.forks) > 0 && <span className="mono signal-metric">⑂ {row.forks}</span>}
        {Number(row.prs_opened) > 0 && <span className="mono signal-metric">PR+{row.prs_opened}</span>}
        {Number(row.prs_closed) > 0 && <span className="mono signal-metric">PR-{row.prs_closed}</span>}
        {Number(row.issues_opened) > 0 && <span className="mono signal-metric">I+{row.issues_opened}</span>}
        {Number(row.issues_closed) > 0 && <span className="mono signal-metric">I-{row.issues_closed}</span>}
        {Number(row.releases) > 0 && <span className="mono signal-metric">● {row.releases}</span>}
      </div>
    </div>
  );
}

export async function EventsSurface() {
  const [timeline, volume, statsResult, signalResult] = await Promise.all([
    eventTimelineFeed(50),
    eventVolumeFeed(),
    firehoseStats(),
    firehoseRepoSignal(24, 20),
  ]);

  const stats = statsResult.data[0] ?? {
    total_events: "0",
    total_repos: "0",
    total_actors: "0",
    latest_event: "",
  };

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
          <h2 className="events-section-title mono">REPO_SIGNALS_24H</h2>
          <div className="events-signal-grid">
            {signalResult.data.length === 0 && (
              <p className="events-empty mono">No signal data yet.</p>
            )}
            {signalResult.data.map((row, i) => (
              <SignalCard key={row.repo_name} row={row} />
            ))}
          </div>
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">TIMELINE</h2>
          <div className="events-timeline">
            {timeline.data.length === 0 && (
              <p className="events-empty mono">No events ingested yet. The firehose task runs at :05 past every hour.</p>
            )}
            {timeline.data.map((row, i) => (
              <TimelineItem key={`${row.created_at}-${row.repo_name}-${i}`} row={row} />
            ))}
          </div>
        </section>

        <section className="events-section">
          <h2 className="events-section-title mono">VOLUME_BY_REPO_24H</h2>
          <div className="events-volume">
            {volume.data.length === 0 && (
              <p className="events-empty mono">No volume data yet.</p>
            )}
            {volume.data.slice(0, 30).map((row, i) => (
              <VolumeBar key={`${row.repo_name}-${row.event_type}-${i}`} row={row} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
