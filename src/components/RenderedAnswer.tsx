"use client";

import type { CandlesPayload, DigestPayload, DivergencePayload, MatrixPayload, MorphingCardPayload, RenderPayload, RepoDrilldownPayload, RepoDrilldownActivity, RepoDrilldownPulse, RepoDrilldownTrend, TickerPayload, VerdictTile } from "@/lib/render-payload";
import { VERDICT_COLOR } from "@/lib/verdict-color";
import { AreaChart, DualLine, Sparkline } from "./charts";
import { SkinnyDeck } from "./SkinnyDeck";

function VerdictBadge({ verdict }: { verdict: VerdictTile }) {
  return (
    <div className="agent-verdict mono" title={verdict.rule}>
      <b style={{ color: VERDICT_COLOR[verdict.state] }}>{verdict.state}</b>
      <span>{verdict.metric} {verdict.metricLabel}</span>
      {verdict.detail && <i>{verdict.detail}</i>}
    </div>
  );
}

function DigestAnswer({ payload }: { payload: DigestPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">
        THE DAILY SKINNY
        <span>{payload.clusters.length} clusters · floor {payload.noiseFloor.toFixed(2)}</span>
      </div>
      <div className="agent-digest-list">
        {payload.clusters.map((cluster) => (
          <article key={cluster.id} className="agent-digest-row">
            <div className="mono agent-digest-verdict" style={{ color: VERDICT_COLOR[cluster.verdict] }}>{cluster.verdict}</div>
            <Sparkline data={cluster.spark} color={VERDICT_COLOR[cluster.verdict]} w={74} h={22} />
            <div>
              <h3>
                <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.subject}</a>
              </h3>
              <p>{cluster.skinny}</p>
              <span className="mono">
                <a href={cluster.links.hn} target="_blank" rel="noreferrer">{cluster.sources.hnThreads} HN</a>
                {" · "}{cluster.sources.comments} cmts{" · "}
                <a href={cluster.links.github} target="_blank" rel="noreferrer">{cluster.sources.ghStars24h} stars · {cluster.sources.repos} repos</a>
              </span>
            </div>
            <div className="mono agent-share">{Math.round(cluster.talkShare * 100)}% talk</div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TickerAnswer({ payload }: { payload: TickerPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">BREAKOUT TICKER <span>{payload.filter}</span></div>
      <div className="agent-ticker-grid">
        {payload.items.map((item, index) => (
          <a key={`${item.name}-${index}`} className="agent-ticker-card" href={item.href} target={item.href ? "_blank" : undefined} rel="noreferrer">
            <span className="mono">{item.kicker}</span>
            <b>{item.name}</b>
            <i className="mono">{item.metric}</i>
            {item.delta && <small className="mono">{item.delta}</small>}
            {item.stats && (
              <span className="agent-ticker-stats mono">
                {item.stats.filter((stat) => stat.value !== "0").slice(0, 4).map((stat) => (
                  <em key={`${stat.label}-${stat.value}`} data-tone={stat.tone}>
                    {stat.value} {stat.label}
                  </em>
                ))}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function DivergenceAnswer({ payload }: { payload: DivergencePayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">{payload.subject}</div>
      <VerdictBadge verdict={payload.verdict} />
      <DualLine days={payload.days} a={payload.talk} b={payload.code} aLabel="talk · HN" bLabel="code · GH" />
      <p className="agent-caption">{payload.caption}</p>
    </div>
  );
}

function CandlesAnswer({ payload }: { payload: CandlesPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">{payload.subject}</div>
      <VerdictBadge verdict={payload.verdict} />
      <AreaChart days={payload.days} values={payload.values} label={payload.caption} />
    </div>
  );
}

function MatrixAnswer({ payload }: { payload: MatrixPayload }) {
  const maxVolume = Math.max(...payload.topics.map((topic) => topic.volume), 1);
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">MOMENTUM MATRIX <span>{payload.topics.length} topics</span></div>
      <div className="agent-matrix">
        {payload.topics.map((topic) => (
          <div key={topic.name} className="agent-matrix-topic">
            <b>{topic.name}</b>
            <span className="mono">velocity {topic.velocity.toFixed(1)} · {Math.round(topic.ghShare * 100)}% code</span>
            <i style={{ width: `${Math.max(8, (topic.volume / maxVolume) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}


function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortTime(value: string) {
  if (value.includes("T")) return value.slice(11, 16);
  if (value.includes(" ")) return value.slice(11, 16);
  return value.slice(0, 5);
}

function RepoVelocityChart({ payload }: { payload: RepoDrilldownPayload }) {
  const W = 640, H = 210, padL = 34, padR = 10, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const rows = payload.velocity;

  if (rows.length < 2) {
    return <div className="repo-empty mono">not enough hourly data for a velocity chart</div>;
  }

  const series = [
    { key: "pushes", label: "pushes", color: "var(--cyan)", values: rows.map((row) => row.pushes) },
    { key: "commits", label: "commits", color: "var(--mag)", values: rows.map((row) => row.commits) },
    { key: "stars", label: "stars", color: "var(--amber)", values: rows.map((row) => row.stars) },
  ];
  const max = Math.max(...series.flatMap((item) => item.values), 1);
  const x = (i: number) => padL + (i / (rows.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = (values: number[]) => values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const labelStep = Math.max(1, Math.floor((rows.length - 1) / 3));

  return (
    <figure className="chart repo-velocity">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${payload.repoName} hourly velocity over the latest 24 hours`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 6} y={y(max * t) + 3} fontSize="9.5" fill="var(--muted)" textAnchor="end" className="mono">
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {rows.map((row, i) => i % labelStep === 0 || i === rows.length - 1 ? (
          <text key={row.hour} x={x(i)} y={H - 6} fontSize="9.5" fill="var(--muted)" textAnchor="middle" className="mono">
            {shortTime(row.hour)}
          </text>
        ) : null)}
        {series.map((item) => (
          <polyline key={item.key} points={line(item.values)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" />
        ))}
      </svg>
      <figcaption className="legend">
        {series.map((item) => (
          <span key={item.key}><i className="swatch" style={{ background: item.color }} /> {item.label}</span>
        ))}
        <span className="muted">latest GH Archive 24h window</span>
      </figcaption>
    </figure>
  );
}

function RepoTrendChart({ trends }: { trends: RepoDrilldownTrend[] }) {
  const W = 640, H = 180, padL = 34, padR = 10, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  if (trends.length < 2) {
    return <div className="repo-empty mono">not enough trend data for a 30-day chart</div>;
  }
  const stars = trends.map((t) => t.stars);
  const forks = trends.map((t) => t.forks);
  const max = Math.max(...stars, ...forks, 1);
  const x = (i: number) => padL + (i / (trends.length - 1)) * iw;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = (values: number[]) => values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const labelStep = Math.max(1, Math.floor((trends.length - 1) / 4));
  const eventMarker = (type: RepoDrilldownTrend["events"][number]["type"]) =>
    type === "release" ? "▲" : type === "pr_merged" ? "●" : "◆";
  const eventColor = (type: RepoDrilldownTrend["events"][number]["type"]) =>
    type === "release" ? "var(--amber)" : type === "pr_merged" ? "var(--cyan)" : "var(--mag)";

  return (
    <figure className="chart repo-trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${trends.length}-day trend timeline with release, PR-merge, and issue-open event markers`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 6} y={y(max * t) + 3} fontSize="9.5" fill="var(--muted)" textAnchor="end" className="mono">
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {trends.map((row, i) => i % labelStep === 0 || i === trends.length - 1 ? (
          <text key={row.date} x={x(i)} y={H - 6} fontSize="9.5" fill="var(--muted)" textAnchor="middle" className="mono">
            {row.date.slice(5)}
          </text>
        ) : null)}
        <polyline points={line(stars)} fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={line(forks)} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />
        {trends.map((row, i) => row.events.map((ev, j) => (
          <text
            key={`${row.date}-${ev.type}-${j}`}
            x={x(i)}
            y={padT + 10 + j * 11}
            fontSize="11"
            fill={eventColor(ev.type)}
            textAnchor="middle"
            className="mono"
          >
            {eventMarker(ev.type)}
          </text>
        )))}
      </svg>
      <figcaption className="legend">
        <span><i className="swatch" style={{ background: "var(--amber)" }} /> stars</span>
        <span><i className="swatch" style={{ background: "var(--cyan)" }} /> forks</span>
        <span className="muted">▲ release · ● PR merged · ◆ issue opened</span>
      </figcaption>
    </figure>
  );
}

function RepoActivityLists({ activity, repoName }: { activity: RepoDrilldownActivity; repoName: string }) {
  const hasAny = activity.commits.length || activity.prs.length || activity.releases.length || activity.issues.length;
  if (!hasAny) return null;
  const gh = (path: string) => `https://github.com/${repoName}/${path}`;
  return (
    <div className="repo-activity">
      <div className="repo-section-title mono">RECENT ACTIVITY · 7 DAYS</div>
      {activity.commits.length > 0 && (
        <div className="repo-activity-list">
          <b className="mono repo-activity-label">COMMITS</b>
          {activity.commits.map((c) => (
            <a key={c.sha} className="repo-activity-row mono" href={gh(`commit/${c.sha}`)} target="_blank" rel="noreferrer">
              <span className="repo-activity-sha">{c.sha.slice(0, 7)}</span>
              <span className="repo-activity-date">{c.authorDate.slice(0, 10)}</span>
              <span className="repo-activity-author">{c.author}</span>
              <span className="repo-activity-text">{c.message}</span>
            </a>
          ))}
        </div>
      )}
      {activity.prs.length > 0 && (
        <div className="repo-activity-list">
          <b className="mono repo-activity-label">PULL REQUESTS</b>
          {activity.prs.map((p) => (
            <a key={p.number} className="repo-activity-row mono" href={gh(`pull/${p.number}`)} target="_blank" rel="noreferrer">
              <span className="repo-activity-num">#{p.number}</span>
              <span className="repo-activity-state" data-state={p.state}>{p.state}</span>
              <span className="repo-activity-author">{p.author}</span>
              <span className="repo-activity-text">{p.title}</span>
            </a>
          ))}
        </div>
      )}
      {activity.releases.length > 0 && (
        <div className="repo-activity-list">
          <b className="mono repo-activity-label">RELEASES</b>
          {activity.releases.map((r) => (
            <a key={r.tag} className="repo-activity-row mono" href={gh(`releases/tag/${r.tag}`)} target="_blank" rel="noreferrer">
              <span className="repo-activity-tag">▲ {r.tag}</span>
              <span className="repo-activity-date">{r.publishedAt.slice(0, 10)}</span>
              <span className="repo-activity-author">{r.author}</span>
              <span className="repo-activity-text">{r.name || r.tag}</span>
            </a>
          ))}
        </div>
      )}
      {activity.issues.length > 0 && (
        <div className="repo-activity-list">
          <b className="mono repo-activity-label">ISSUES</b>
          {activity.issues.map((i) => (
            <a key={i.number} className="repo-activity-row mono" href={gh(`issues/${i.number}`)} target="_blank" rel="noreferrer">
              <span className="repo-activity-num">#{i.number}</span>
              <span className="repo-activity-state" data-state={i.state}>{i.state}</span>
              <span className="repo-activity-author">{i.author}</span>
              <span className="repo-activity-text">{i.title}</span>
              <span className="repo-activity-comments">{i.comments}c</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function RepoPulseOverview({ pulse }: { pulse: RepoDrilldownPulse }) {
  const hasData = pulse.prsActive || pulse.issuesActive || pulse.commitCount || pulse.topCommitters.length;
  if (!hasData) return null;
  // Top committers bar chart (Pulse's "Top committers" viz)
  const maxCommits = Math.max(...pulse.topCommitters.map((c) => c.commits), 1);
  return (
    <div className="repo-pulse">
      <div className="repo-section-title mono">PULSE · {pulse.windowDays}D OVERVIEW</div>
      <div className="repo-pulse-stats">
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.prsMerged)}</b>
          <span className="mono">PRs merged</span>
        </div>
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.prsOpened)}</b>
          <span className="mono">PRs opened</span>
        </div>
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.prsOpen)}</b>
          <span className="mono">PRs open</span>
        </div>
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.issuesClosed)}</b>
          <span className="mono">issues closed</span>
        </div>
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.issuesOpened)}</b>
          <span className="mono">issues opened</span>
        </div>
        <div className="repo-pulse-stat">
          <b className="mono">{compact(pulse.issuesOpen)}</b>
          <span className="mono">issues open</span>
        </div>
      </div>
      {pulse.commitCount > 0 && (
        <p className="repo-pulse-summary mono">
          <b>{pulse.commitAuthors}</b> author{pulse.commitAuthors === 1 ? "" : "s"} pushed <b>{compact(pulse.commitCount)}</b> commit{pulse.commitCount === 1 ? "" : "s"}
        </p>
      )}
      {pulse.topCommitters.length > 0 && (
        <div className="repo-pulse-committers">
          <div className="repo-pulse-subtitle mono">TOP COMMITTERS</div>
          {pulse.topCommitters.map((c) => (
            <div key={c.author} className="repo-pulse-committer-row">
              <span className="repo-pulse-committer-name">{c.author}</span>
              <div className="repo-pulse-committer-bar">
                <div className="repo-pulse-committer-fill" style={{ width: `${(c.commits / maxCommits) * 100}%` }} />
              </div>
              <span className="repo-pulse-committer-count mono">{compact(c.commits)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepoDrilldownAnswer({ payload }: { payload: RepoDrilldownPayload }) {
  const kpis = [
    ["pushes", payload.kpis24h.pushes],
    ["commits", payload.kpis24h.commits],
    ["actors", payload.kpis24h.actors],
    ["stars", payload.kpis24h.stars],
    ["forks", payload.kpis24h.forks],
    ["PRs", payload.kpis24h.prsOpened],
    ["merged", payload.kpis24h.prsMerged],
    ["issues", payload.kpis24h.issuesOpened],
  ] as const;
  const metaStats = [
    payload.metadata.language || "unknown language",
    `${compact(payload.metadata.githubStars)} total stars`,
    `${compact(payload.metadata.githubForks)} forks`,
    `${compact(payload.metadata.openIssues)} open issues`,
  ];

  return (
    <div className="agent-answer repo-drilldown">
      <div className="agent-answer-head mono">
        REPO DRILL-DOWN
        <span>{new Date(payload.generatedAt).toISOString().slice(11, 19)} UTC</span>
      </div>
      <header className="repo-drilldown-head">
        <div>
          <h3>{payload.repoName}</h3>
          <p>{payload.metadata.description || "No repository description has been enriched yet."}</p>
        </div>
        <a href={`https://github.com/${payload.repoName}`} target="_blank" rel="noreferrer" className="repo-gh-link mono">GitHub</a>
      </header>
      <div className="repo-meta mono">
        {metaStats.map((item) => <span key={item}>{item}</span>)}
      </div>
      {payload.metadata.topics.length > 0 && (
        <div className="repo-topics mono">
          {payload.metadata.topics.slice(0, 8).map((topic) => <span key={topic}>{topic}</span>)}
        </div>
      )}
      <div className="repo-kpis">
        {kpis.map(([label, value]) => (
          <div key={label} className="repo-kpi">
            <b className="mono">{compact(value)}</b>
            <span className="mono">{label} 24h</span>
          </div>
        ))}
      </div>
      <RepoVelocityChart payload={payload} />
      {payload.analysis && (
        <div className="repo-analysis">
          <div className="repo-section-title mono">CODEBASE INTELLIGENCE</div>
          <p className="repo-analysis-overview">{payload.analysis.overview}</p>
          <div className="repo-analysis-grid">
            <div>
              <b className="mono">ARCHITECTURE</b>
              <p>{payload.analysis.architectureSummary}</p>
            </div>
            {payload.analysis.keyFiles.length > 0 && (
              <div>
                <b className="mono">KEY FILES</b>
                <ul className="mono">
                  {payload.analysis.keyFiles.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {payload.analysis.techStack.length > 0 && (
            <div className="repo-analysis-stack mono">
              <span className="label">DETECTED STACK:</span>
              {payload.analysis.techStack.map((tech) => (
                <span key={tech} className="tech-badge">{tech}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {payload.topActors24h.length > 0 && (
        <div className="repo-actors">
          <div className="repo-section-title mono">TOP CONTRIBUTORS 24H</div>
          <div className="repo-actor-grid">
            {payload.topActors24h.map((actor) => (
              <div key={actor.actor} className="repo-actor-row">
                <b>{actor.actor}</b>
                <span className="mono">{compact(actor.commits)} commits</span>
                <span className="mono">{compact(actor.pushes)} pushes</span>
                <span className="mono">{compact(actor.prsMerged)} merged</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="repo-feed">
        <div className="repo-section-title mono">LATEST PUSH / PR EVENTS</div>
        {payload.feed.length ? payload.feed.map((item) => (
          <div key={`${item.at}-${item.actor}-${item.eventType}`} className="repo-feed-row">
            <span className="mono">{shortTime(item.at)}</span>
            <b>{item.actor}</b>
            <i className="mono">{item.eventType === "PushEvent" ? "push" : item.merged ? "merged PR" : item.action || "PR"}</i>
            <em className="mono">
              {item.eventType === "PushEvent"
                ? item.distinctCommits > 0
                  ? `${item.distinctCommits} distinct`
                  : item.commits > 0
                  ? `${item.commits} commit${item.commits === 1 ? "" : "s"}`
                  : ""
                : ""}
            </em>
          </div>
        )) : <div className="repo-empty mono">no push or PR events in the latest 24h window</div>}
      </div>
      {payload.trends && payload.trends.length > 0 && (
        <div className="repo-trends">
          <div className="repo-section-title mono">30-DAY TREND TIMELINE</div>
          <RepoTrendChart trends={payload.trends} />
        </div>
      )}
      {payload.pulse && <RepoPulseOverview pulse={payload.pulse} />}
      {payload.activity && <RepoActivityLists activity={payload.activity} repoName={payload.repoName} />}
      <details className="agent-query repo-sql">
        <summary className="mono">view SQL · {payload.query.rowsRead.toLocaleString()} rows · {payload.query.elapsedMs}ms</summary>
        <pre className="mono">{payload.query.sql}</pre>
      </details>
    </div>
  );
}

function MorphingCardAnswer({ payload }: { payload: MorphingCardPayload }) {
  return (
    <div className="agent-answer morphing-card">
      <div className="agent-answer-head mono">
        {payload.visualizationType.toUpperCase()}
      </div>
      <div className="agent-chart-placeholder" style={{ padding: '1rem', background: '#f5f5f5', color: '#000', margin: '1rem 0' }}>
        {payload.summary && <p style={{ marginBottom: '0.5rem' }}>{payload.summary}</p>}
        <i>[Morphing Canvas for {payload.visualizationType}]</i>
      </div>
    </div>
  );
}

export function RenderedAnswer({ payload }: { payload: RenderPayload }) {
  if (payload.type === "digest") return <DigestAnswer payload={payload} />;
  if (payload.type === "ticker") return <TickerAnswer payload={payload} />;
  if (payload.type === "divergence") return <DivergenceAnswer payload={payload} />;
  if (payload.type === "candles") return <CandlesAnswer payload={payload} />;
  if (payload.type === "skinny-deck") return <SkinnyDeck payload={payload} />;
  if (payload.type === "repo-drilldown") return <RepoDrilldownAnswer payload={payload} />;
  if (payload.type === "morphing-card") return <MorphingCardAnswer payload={payload} />;
  return <MatrixAnswer payload={payload} />;
}
