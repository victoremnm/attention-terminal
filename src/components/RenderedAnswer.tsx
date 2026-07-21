"use client";

import type { CandlesPayload, DigestPayload, DivergencePayload, MatrixPayload, MorphingCardPayload, RenderPayload, RepoDrilldownPayload, TickerPayload, VerdictTile } from "@/lib/render-payload";
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
      <div className="repo-feed">
        <div className="repo-section-title mono">LATEST PUSH / PR EVENTS</div>
        {payload.feed.length ? payload.feed.map((item) => (
          <div key={`${item.at}-${item.actor}-${item.eventType}`} className="repo-feed-row">
            <span className="mono">{shortTime(item.at)}</span>
            <b>{item.actor}</b>
            <i className="mono">{item.eventType === "PushEvent" ? "push" : item.merged ? "merged PR" : item.action || "PR"}</i>
            <em className="mono">{item.commits ? `${item.commits} commits` : `${item.distinctCommits} distinct`}</em>
          </div>
        )) : <div className="repo-empty mono">no push or PR events in the latest 24h window</div>}
      </div>
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
