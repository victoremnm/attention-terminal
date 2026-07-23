"use client";

import { useState, type ReactNode } from "react";
import type { CandlesPayload, DigestPayload, DivergencePayload, MatrixPayload, MorphingCardPayload, RenderPayload, RepoDrilldownPayload, RepoDrilldownActivity, RepoDrilldownPulse, RepoDrilldownTrend, TableColumn, TablePayload, TickerPayload, VerdictTile } from "@/lib/render-payload";
import { VERDICT_COLOR } from "@/lib/verdict-color";
import { AreaChart, CodeFrequencyChart, DualLine, HorizontalBarChart, Sparkline, VerticalBarChart } from "./charts";
import { MarkdownText } from "./MarkdownText";
import { SkinnyDeck } from "./SkinnyDeck";
import { copyToClipboard, exportAssetAsHTML, exportAssetAsMarkdown } from "@/lib/asset-export";

function CopyBtn({ payload }: { payload: RenderPayload }) {
  const [copiedFormat, setCopiedFormat] = useState<"markdown" | "html" | null>(null);

  async function handleCopy(format: "markdown" | "html") {
    try {
      const content = format === "markdown" ? exportAssetAsMarkdown(payload) : exportAssetAsHTML(payload);
      await copyToClipboard(content, format);
      setCopiedFormat(format);
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch {
      setCopiedFormat(null);
    }
  }

  return (
    <div className="asset-copy-bar">
      <button
        type="button"
        className={`asset-copy-btn${copiedFormat === "markdown" ? " copied" : ""}`}
        onClick={() => handleCopy("markdown")}
        aria-label="Copy as Markdown"
      >
        {copiedFormat === "markdown" ? "Copied MD!" : "Copy Markdown"}
      </button>
      <button
        type="button"
        className={`asset-copy-btn${copiedFormat === "html" ? " copied" : ""}`}
        onClick={() => handleCopy("html")}
        aria-label="Copy as HTML"
      >
        {copiedFormat === "html" ? "Copied HTML!" : "Copy HTML"}
      </button>
    </div>
  );
}

function CopyableAnswer({ payload, showCopy = true, children }: { payload: RenderPayload; showCopy?: boolean; children: React.ReactNode }) {
  return (
    <div className="agent-answer-wrapper">
      {showCopy && <CopyBtn payload={payload} />}
      {children}
    </div>
  );
}

function FreshnessBadge({ freshness }: { freshness?: string }) {
  if (!freshness) return null;
  return <span className="agent-freshness mono">{freshness}</span>;
}

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

function parseMetricValue(metric: string): number | null {
  if (!metric) return null;
  const lower = metric.toLowerCase();
  if (lower.includes("utc") || lower.includes("born") || lower.includes("ago")) {
    return null;
  }
  const cleaned = metric
    .replace(/\b\d+(?:\.\d+)?\s*(?:s|m|h|d|w|mo|y)\b/gi, " ")
    .replace(/\/(1h|24h|7d|30d)/gi, " ")
    .trim();
  const matches = cleaned.match(/(?<![\w.])[-+]?\d[\d,]*(?:\.\d+)?(?![\w.])/g);
  const token = matches?.at(-1);
  if (!token) return null;
  const num = Number(token.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function TickerAnswer({ payload }: { payload: TickerPayload }) {
  const barItems = payload.items
    .map((item) => {
      const val = parseMetricValue(item.metric);
      if (val === null) return null;
      return {
        label: item.name,
        value: val,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 6);

  return (
    <div className="agent-answer space-y-4">
      <div className="agent-answer-head mono">BREAKOUT TICKER <span>{payload.filter}</span></div>
      {barItems.length > 0 && <HorizontalBarChart items={barItems} title={`LEADERBOARD · ${payload.filter}`} />}
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

type MorphingCardRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Query rows often serialize numeric aggregates as strings (e.g. ClickHouse's
// UInt64 counts), so a plain `typeof === "number"` check misses valid metric
// candidates like { stories: "2202" }.
function isFiniteNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim().length > 0) return Number.isFinite(Number(value));
  return false;
}

function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function formatTableCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((item) => formatTableCell(item)).join(", ");
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function MorphingCardTable({
  rows,
  chartConfig,
}: {
  rows: MorphingCardRow[];
  chartConfig: MorphingCardPayload["chartConfig"];
}) {
  const config = chartConfig as Record<string, unknown>;
  const encoding = isRecord(config.encoding) ? config.encoding : undefined;
  const tooltip = Array.isArray(encoding?.tooltip) ? encoding.tooltip.filter(isRecord) : [];
  const firstRow = rows[0] ?? {};

  const columns = (
    tooltip.length
      ? tooltip
          .map((item) => {
            const field = typeof item.field === "string" ? item.field : "";
            if (!field) return null;
            return {
              field,
              label: typeof item.title === "string" && item.title.trim().length > 0 ? item.title : humanizeKey(field),
            };
          })
          .filter((column): column is { field: string; label: string } => column !== null)
      : Object.keys(firstRow).map((field) => ({ field, label: humanizeKey(field) }))
  ).slice(0, 6);

  if (columns.length === 0) {
    return <div className="repo-empty mono">no tabular values were provided for this chart</div>;
  }

  return (
    <div className="table-responsive">
      <table className="telemetry-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.field}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row, index) => (
            <tr key={`${index}-${columns[0]?.field ?? "row"}`}>
              {columns.map((column) => (
                <td key={column.field}>{formatTableCell(row[column.field])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
      <FreshnessBadge freshness={payload.freshness} />
    </div>
  );
}

function CandlesAnswer({ payload }: { payload: CandlesPayload }) {
  return (
    <div className="agent-answer">
      <div className="agent-answer-head mono">{payload.subject}</div>
      <VerdictBadge verdict={payload.verdict} />
      <AreaChart days={payload.days} values={payload.values} label={payload.caption} />
      <FreshnessBadge freshness={payload.freshness} />
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

type TrendCategoryKey = "stars" | "forks" | "releases" | "pr_merged" | "issue_opened";

interface TrendCategory {
  key: TrendCategoryKey;
  label: string;
  color: string;
}

const TREND_CATEGORIES: TrendCategory[] = [
  { key: "stars", label: "stars", color: "var(--amber)" },
  { key: "forks", label: "forks", color: "var(--blue)" },
  { key: "releases", label: "releases", color: "var(--emerald)" },
  { key: "pr_merged", label: "PR merges", color: "var(--cyan)" },
  { key: "issue_opened", label: "issues", color: "var(--mag)" },
];

function trendCategoryValue(row: RepoDrilldownTrend, key: TrendCategoryKey): number {
  if (key === "stars") return row.stars;
  if (key === "forks") return row.forks;
  return row.events.filter((ev) => ev.type === key).length;
}

function trendCategoryTitle(row: RepoDrilldownTrend, category: TrendCategory, value: number): string {
  if (category.key === "stars" || category.key === "forks") {
    return `${row.date}: ${value} ${category.label}`;
  }
  const details = row.events
    .filter((ev) => ev.type === category.key)
    .map((ev) => ev.label)
    .join("; ");
  return `${row.date} [${category.key}]: ${details}`;
}

function RepoTrendChart({ trends }: { trends: RepoDrilldownTrend[] }) {
  const [showStars, setShowStars] = useState(true);
  const [showForks, setShowForks] = useState(true);
  const [showReleases, setShowReleases] = useState(true);
  const [showPrs, setShowPrs] = useState(true);
  const [showIssues, setShowIssues] = useState(true);

  if (!trends || trends.length < 2) {
    return <div className="repo-empty mono">not enough trend data for a 30-day chart</div>;
  }

  const visibility: Record<TrendCategoryKey, boolean> = {
    stars: showStars,
    forks: showForks,
    releases: showReleases,
    pr_merged: showPrs,
    issue_opened: showIssues,
  };

  const allHidden = !showStars && !showForks && !showReleases && !showPrs && !showIssues;
  const resetAll = () => {
    setShowStars(true);
    setShowForks(true);
    setShowReleases(true);
    setShowPrs(true);
    setShowIssues(true);
  };

  const activeCategories = TREND_CATEGORIES.filter((c) => visibility[c.key]);

  const dayTotals = trends.map((row) =>
    activeCategories.reduce((sum, c) => sum + trendCategoryValue(row, c.key), 0)
  );
  const max = Math.max(...dayTotals, 1);

  const W = 640, H = 180, padL = 34, padR = 10, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const barGap = 2;
  const barWidth = Math.max(1, iw / trends.length - barGap);
  const barX = (i: number) => padL + (i / trends.length) * iw + barGap / 2;
  const labelStep = Math.max(1, Math.floor((trends.length - 1) / 4));

  const activeSummary = activeCategories.map((c) => c.label).join(", ") || "none";

  const TOGGLES = [
    { key: "stars" as const, isOn: showStars, setter: setShowStars },
    { key: "forks" as const, isOn: showForks, setter: setShowForks },
    { key: "releases" as const, isOn: showReleases, setter: setShowReleases },
    { key: "pr_merged" as const, isOn: showPrs, setter: setShowPrs },
    { key: "issue_opened" as const, isOn: showIssues, setter: setShowIssues },
  ];

  return (
    <figure className="chart repo-trend">
      <div className="trend-controls mono" role="group" aria-label="Trend chart series toggles">
        {TOGGLES.map(({ key, isOn, setter }) => {
          const category = TREND_CATEGORIES.find((c) => c.key === key)!;
          return (
            <button
              key={key}
              type="button"
              className={`trend-toggle ${isOn ? "active" : ""}`}
              aria-pressed={isOn}
              onClick={() => setter(!isOn)}
            >
              <i className="swatch" style={{ background: category.color }} /> {category.label}
            </button>
          );
        })}
        <button type="button" className="trend-reset" onClick={resetAll}>
          Reset
        </button>
      </div>

      {allHidden ? (
        <div className="repo-empty mono" style={{ padding: "2rem", textAlign: "center" }}>
          Every series is hidden. Toggle a series above to view data.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${trends.length}-day stacked activity chart (showing: ${activeSummary})`}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={padT + ih - ih * t} y2={padT + ih - ih * t} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={padT + ih - ih * t + 3} fontSize="9.5" fill="var(--muted)" textAnchor="end" className="mono">
                {Math.round(max * t)}
              </text>
            </g>
          ))}
          {trends.map((row, i) => i % labelStep === 0 || i === trends.length - 1 ? (
            <text
              key={row.date}
              x={Math.min(Math.max(barX(i) + barWidth / 2, padL + 14), W - padR - 14)}
              y={H - 6}
              fontSize="9.5"
              fill="var(--muted)"
              textAnchor="middle"
              className="mono"
            >
              {row.date.slice(5)}
            </text>
          ) : null)}
          {trends.map((row, i) => {
            let cumulative = 0;
            return activeCategories.map((category) => {
              const value = trendCategoryValue(row, category.key);
              if (value <= 0) return null;
              const segHeight = (value / max) * ih;
              const segY = padT + ih - cumulative - segHeight;
              cumulative += segHeight;
              return (
                <rect key={`${row.date}-${category.key}`} x={barX(i)} y={segY} width={barWidth} height={segHeight} fill={category.color}>
                  <title>{trendCategoryTitle(row, category, value)}</title>
                </rect>
              );
            });
          })}
        </svg>
      )}
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
              <div key={actor.actor} className={`repo-actor-row ${actor.isBot ? 'is-bot' : ''}`}>
                <div className="repo-actor-header">
                  <b>{actor.actor}</b>
                  {actor.isBot && <span className="actor-bot-badge">[bot]</span>}
                </div>
                <div className="repo-actor-metrics">
                  <span className="mono">{compact(actor.distinctCommits)} commits</span>
                  <span className="mono">{compact(actor.pushes)} pushes</span>
                  <span className="mono">{compact(actor.prsOpened)} PRs opened</span>
                  <span className="mono">{compact(actor.prsMerged)} merged</span>
                  {actor.issuesOpened > 0 && <span className="mono">{compact(actor.issuesOpened)} issues</span>}
                  {actor.releasesPublished > 0 && <span className="mono">{compact(actor.releasesPublished)} releases</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="repo-feed">
        <div className="repo-section-title mono">LATEST PUSH / PR / ISSUE EVENTS</div>
        {payload.feed.length ? payload.feed.map((item) => (
          <div key={`${item.at}-${item.actor}-${item.eventType}`} className="repo-feed-row">
            <span className="mono">{shortTime(item.at)}</span>
            <b>{item.actor}</b>
            <i className="mono">
              {item.eventType === "PushEvent" ? "push" : item.eventType === "IssuesEvent" ? "issue" : item.merged ? "merged PR" : item.action || "PR"}
            </i>
            {item.title && (item.eventType === "PullRequestEvent" || item.eventType === "IssuesEvent") && (
              <span className="repo-feed-title">{item.title.substring(0, 60)}</span>
            )}
            <em className="mono">
              {item.eventType === "PushEvent"
                ? item.distinctCommits > 0
                  ? `${item.distinctCommits} distinct`
                  : item.commits > 0
                  ? `${item.commits} commit${item.commits === 1 ? "" : "s"}`
                  : ""
                : item.labels && item.labels.length > 0
                ? item.labels.slice(0, 2).join(", ")
                : ""}
            </em>
          </div>
        )) : <div className="repo-empty mono">no push, PR, or issue events in the latest 24h window</div>}
      </div>
      {payload.trends && payload.trends.length > 0 && (
        <div className="repo-trends">
          <div className="repo-section-title mono">30-DAY TREND TIMELINE</div>
          <RepoTrendChart trends={payload.trends} />
        </div>
      )}
      {payload.codeFrequency && payload.codeFrequency.length > 0 && (
        <div className="repo-code-frequency">
          <div className="repo-section-title mono">CODE FREQUENCY</div>
          <CodeFrequencyChart data={payload.codeFrequency} />
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

// Adapter: turns a morphing-card's raw row objects + Vega-Lite-ish chartConfig
// into one of the existing SVG chart components (see ./charts). Returns null
// whenever the visualizationType/mark isn't chart-capable (yet) or the data
// is too sparse to plot — callers fall back to the MorphingCardTable in
// that case, they never crash. Supported set is intentionally minimal:
// Bar Chart, Line Graph, Area Chart. Everything else (Pie Chart, Treemap,
// Stacked Bar Chart, Scatterplot, ...) has no matching component and must
// keep rendering the table.
function buildMorphingChart(
  markType: string,
  visualizationType: MorphingCardPayload["visualizationType"],
  dataValues: MorphingCardRow[],
  config: Record<string, unknown>,
): ReactNode | null {
  if (dataValues.length < 2) return null;

  const firstRow = dataValues[0];
  const encoding = isRecord(config.encoding) ? config.encoding : undefined;
  const xEncoding = isRecord(encoding?.x) ? encoding.x : undefined;
  const yEncoding = isRecord(encoding?.y) ? encoding.y : undefined;

  const xField = typeof xEncoding?.field === "string" ? xEncoding.field : Object.keys(firstRow)[0];
  if (!xField) return null;

  const yField = typeof yEncoding?.field === "string"
    ? yEncoding.field
    : Object.keys(firstRow).find((key) => key !== xField && isFiniteNumeric(firstRow[key]));
  if (!yField) return null;

  const yTitle = typeof yEncoding?.title === "string" && yEncoding.title.trim().length > 0 ? yEncoding.title : yField;
  const isTemporal = xEncoding?.type === "temporal";
  const MAX_BARS = 15;

  let rows = dataValues.map((row) => ({ label: String(row[xField] ?? ""), value: Number(row[yField]) || 0 }));
  // Non-temporal (categorical) series with more rows than a bar chart can show
  // legibly get sorted to their most significant values and pruned -- a
  // 28-bar comparison of unrelated repo names is unreadable regardless of
  // scale. Temporal (date) series keep chronological order and every point.
  if (!isTemporal && rows.length > MAX_BARS) {
    rows = [...rows].sort((a, b) => b.value - a.value).slice(0, MAX_BARS);
  }
  const labels = rows.map((r) => r.label);
  const values = rows.map((r) => r.value);

  // Gate on the taxonomy visualizationType, not the raw Vega-Lite mark: Stacked
  // Bar Chart configs also use mark "bar" (Vega-Lite expresses stacking via
  // encoding, not a distinct mark type), so matching on markType alone would
  // misrender an unsupported taxonomy type as a simplified single-series chart.
  const isBar = visualizationType === "Bar Chart";
  const isLineOrArea = visualizationType === "Line Graph" || visualizationType === "Area Chart";

  if (isBar) {
    return (
      <HorizontalBarChart items={labels.map((label, i) => ({ label, value: values[i] }))} title={yTitle} />
    );
  }
  if (isLineOrArea) {
    return <AreaChart days={labels} values={values} label={yTitle} />;
  }
  return null;
}

function MorphingCardAnswer({ payload }: { payload: MorphingCardPayload }) {
  const config = payload.chartConfig as Record<string, unknown>;
  const title = typeof config.title === "string" && config.title.trim().length > 0 ? config.title : undefined;
  const markType = isRecord(config.mark) && typeof config.mark.type === "string" ? config.mark.type : payload.visualizationType.toLowerCase();
  const dataValues = isRecord(config.data) && Array.isArray(config.data.values)
    ? config.data.values.filter(isRecord)
    : [];
  const chart = buildMorphingChart(markType, payload.visualizationType, dataValues, config);

  if (payload.visualizationType === "Data Table") {
    return (
      <div className="agent-answer table-answer">
        <div className="agent-answer-head mono">
          DATA TABLE
          <span>{title ?? `${dataValues.length} rows`}</span>
        </div>
        {payload.summary && <div className="agent-caption"><MarkdownText text={payload.summary} /></div>}
        <MorphingCardTable rows={dataValues} chartConfig={payload.chartConfig} />
        {dataValues.length > 8 && <p className="mono muted" style={{ fontSize: 11, marginTop: 4, textAlign: "right" }}>showing 8 of {dataValues.length.toLocaleString()} rows</p>}
        {payload.query && (
          <details className="agent-query">
            <summary className="mono">
              query analytics · {payload.query.rowsRead.toLocaleString()} rows read · {payload.query.elapsedMs}ms
            </summary>
            <pre className="mono">{payload.query.sql}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="agent-answer morphing-card">
      <div className="agent-answer-head mono">
        {payload.visualizationType.toUpperCase()}
        <span>{title ?? `${dataValues.length} rows`}</span>
      </div>
      <div className="agent-caption">
        {payload.summary && <MarkdownText text={payload.summary} />}
        {!chart && (
          <p className="mono">
            previewing {markType} markup · {dataValues.length.toLocaleString()} rows shown while the visualization is prepared
          </p>
        )}
      </div>
      {chart ? (
        <>
          {chart}
          <details className="agent-query">
            <summary className="mono">data table · {dataValues.length.toLocaleString()} rows</summary>
            <MorphingCardTable rows={dataValues} chartConfig={payload.chartConfig} />
          </details>
        </>
      ) : (
        <MorphingCardTable rows={dataValues} chartConfig={payload.chartConfig} />
      )}
      {payload.query && (
        <details className="agent-query">
          <summary className="mono">
            query analytics · {payload.query.rowsRead.toLocaleString()} rows read · {payload.query.elapsedMs}ms
          </summary>
          <pre className="mono">{payload.query.sql}</pre>
        </details>
      )}
    </div>
  );
}

function TableAnswer({ payload }: { payload: TablePayload }) {
  const colAlign = (col: TableColumn): React.CSSProperties["textAlign"] => {
    if (col.type === "number") return "right";
    if (col.type === "date") return "center";
    return "left";
  };

  if (payload.rows.length === 0) {
    return (
      <div className="agent-answer table-answer">
        <div className="agent-answer-head mono">DATA TABLE</div>
        {payload.summary && <div className="agent-caption"><MarkdownText text={payload.summary} /></div>}
        <div className="repo-empty mono">no rows returned</div>
      </div>
    );
  }

  const showLimit = payload.rows.length > 20;
  const displayRows = payload.rows.slice(0, 20);

  return (
    <div className="agent-answer table-answer">
      <div className="agent-answer-head mono">
        DATA TABLE
        <span>{payload.columns.length} columns · {payload.rows.length.toLocaleString()} rows</span>
      </div>
      {payload.summary && <div className="agent-caption"><MarkdownText text={payload.summary} /></div>}
      <div className="table-responsive">
        <table className="telemetry-table">
          <thead>
            <tr>
              {payload.columns.map((col) => (
                <th key={col.key} style={{ textAlign: colAlign(col) }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {payload.columns.map((col) => {
                  const raw = row[col.key];
                  if (col.type === "link" && typeof raw === "string" && raw.startsWith("http")) {
                    return (
                      <td key={col.key} style={{ textAlign: colAlign(col) }}>
                        <a href={raw} target="_blank" rel="noreferrer">{raw}</a>
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} style={{ textAlign: colAlign(col) }}>
                      {formatTableCell(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {payload.totals && (
            <tfoot>
              <tr>
                {payload.columns.map((col) => (
                  <td key={col.key} style={{ textAlign: colAlign(col), fontWeight: 600, borderTop: "2px solid var(--line)" }}>
                    {col.type === "number" && typeof payload.totals![col.key] === "number"
                      ? payload.totals![col.key].toLocaleString()
                      : col.key === payload.columns[0]?.key
                      ? "Total"
                      : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {showLimit && <p className="mono muted" style={{ fontSize: 11, marginTop: 4, textAlign: "right" }}>showing 20 of {payload.rows.length.toLocaleString()} rows</p>}
      {payload.query && (
        <details className="agent-query">
          <summary className="mono">
            query analytics · {payload.query.rowsRead.toLocaleString()} rows read · {payload.query.elapsedMs}ms
          </summary>
          <pre className="mono">{payload.query.sql}</pre>
        </details>
      )}
    </div>
  );
}

export function RenderedAnswer({ payload, showCopy = true }: { payload: RenderPayload; showCopy?: boolean }) {
  let answer: React.ReactNode;
  if (payload.type === "digest") answer = <DigestAnswer payload={payload} />;
  else if (payload.type === "ticker") answer = <TickerAnswer payload={payload} />;
  else if (payload.type === "divergence") answer = <DivergenceAnswer payload={payload} />;
  else if (payload.type === "candles") answer = <CandlesAnswer payload={payload} />;
  else if (payload.type === "skinny-deck") answer = <SkinnyDeck payload={payload} />;
  else if (payload.type === "repo-drilldown") answer = <RepoDrilldownAnswer payload={payload} />;
  else if (payload.type === "morphing-card") answer = <MorphingCardAnswer payload={payload} />;
  else if (payload.type === "table") answer = <TableAnswer payload={payload} />;
  else answer = <MatrixAnswer payload={payload} />;

  return <CopyableAnswer payload={payload} showCopy={showCopy}>{answer}</CopyableAnswer>;
}
