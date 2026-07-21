// Server-side only: imported exclusively from server components and route
// handlers. ClickHouse credentials never reach the client bundle.
import { clickhouse } from "./clickhouse";
import type { DevPoint, RepoDrilldownPayload } from "./render-payload";

// Every query returns its provenance so the SQL-flip card back can show the
// exact statement, timing, and rows read - no black boxes.
export interface Provenance {
  sql: string;
  elapsedMs: number;
  rowsRead?: number;
  tables: string[];
}

export async function q<T>(
  sql: string,
  tables: string[],
  query_params?: Record<string, unknown>
): Promise<{ rows: T[]; provenance: Provenance }> {
  const t0 = Date.now();
  const rs = await clickhouse.query({ query: sql, format: "JSONEachRow", query_params });
  const rows = await rs.json<T>();
  const elapsedMs = Date.now() - t0;
  let rowsRead: number | undefined;
  try {
    const summary = (rs as unknown as { response_headers?: Record<string, string | string[]> })
      .response_headers?.["x-clickhouse-summary"];
    if (summary) rowsRead = Number(JSON.parse(String(summary)).read_rows);
  } catch {
    // provenance stays partial; never block the answer on it
  }
  return { rows, provenance: { sql: sql.trim(), elapsedMs, rowsRead, tables } };
}

// Flat read-stats contract for card-producing read fns (issue #25, AGENT-FLEET-PLAN.md
// §4.3): `sql` is the exact statement issued (from `q`'s provenance, never a
// reconstruction), `rowsRead`/`elapsedMs` come straight off the ClickHouse response
// summary. This is what powers the Daily Skinny card's flip-to-view-SQL affordance.
export interface QueryResult<T> {
  data: T;
  sql: string;
  rowsRead: number;
  elapsedMs: number;
}

function toQueryResult<T>(data: T, provenance: Provenance): QueryResult<T> {
  return { data, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}

export interface TickerCard {
  kicker: string;
  name: string;
  metric: string;
  delta?: string;
  stats?: Array<{ label: string; value: string; tone?: "hot" | "muted" }>;
  spark?: number[];
  href?: string;
  repoName?: string;
}

export interface TickerLanes {
  newRepos: TickerCard[];
  topForked: TickerCard[];
  shippingVelocity: TickerCard[];
  starBreakouts: TickerCard[];
  risingStories: TickerCard[];
  provenance: Provenance[];
  fetchedAt: string;
}

function valueOf(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

function stat(label: string, value: string | number, tone?: "hot" | "muted") {
  return { label, value: String(value), ...(tone ? { tone } : {}) };
}

function activityDelta(parts: Array<[string, string | number]>) {
  const visible = parts
    .filter(([, value]) => valueOf(value) > 0)
    .map(([label, value]) => `${value} ${label}`);
  return visible.length ? visible.join(" · ") : undefined;
}

export async function tickerLanes(): Promise<TickerLanes> {
  const [repos, forks, shipping, stars, stories] = await Promise.all([
    q<{ name: string; at: string }>(
      // Window anchored to the feed's own high-water mark, not wall clock -
      // GH Archive is hourly and may lag during catch-up; the freshness strip
      // tells the user exactly how far behind the feed is.
      `SELECT repo_name AS name, max(created_at) AS at
       FROM github_events
       WHERE event_type = 'CreateEvent'
         AND ref_type = 'repository'
         AND created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 6 HOUR
       GROUP BY repo_name ORDER BY at DESC LIMIT 20`,
      ["github_events"]
    ),
    q<{ name: string; forks: string; stars: string; pushes: string; prs: string; issues: string }>(
      `WITH
         (SELECT max(created_at) FROM github_events) AS high_water,
         top_forks AS (
           SELECT repo_name, count() AS forks_24h
           FROM github_events
           WHERE event_type = 'ForkEvent'
             AND created_at > high_water - INTERVAL 24 HOUR
           GROUP BY repo_name
           ORDER BY forks_24h DESC
           LIMIT 20
         )
       SELECT
         f.repo_name AS name,
         toString(f.forks_24h) AS forks,
         toString(coalesce(any(m.stars_24h), 0)) AS stars,
         toString(coalesce(any(m.pushes_24h), 0)) AS pushes,
         toString(coalesce(any(m.prs_24h), 0)) AS prs,
         toString(coalesce(any(m.issues_24h), 0)) AS issues
       FROM top_forks f
       LEFT ANY JOIN (
         SELECT
           repo_name,
           countIf(event_type = 'WatchEvent') AS stars_24h,
           countIf(event_type = 'PushEvent') AS pushes_24h,
           countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS prs_24h,
           countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issues_24h
         FROM github_events
         WHERE event_type IN ('WatchEvent', 'PushEvent', 'PullRequestEvent', 'IssuesEvent')
           AND created_at > high_water - INTERVAL 24 HOUR
           AND repo_name IN (SELECT repo_name FROM top_forks)
         GROUP BY repo_name
       ) m ON f.repo_name = m.repo_name
       GROUP BY name, forks
       ORDER BY toUInt64(forks) DESC`,
      ["github_events"]
    ),
    q<{
      name: string;
      commits: string;
      pushes: string;
      prs: string;
      closed_prs: string;
      issues: string;
      forks: string;
      actors: string;
      events: string;
    }>(
      `SELECT repo_name AS name,
              sum(commit_count) AS commits,
              countIf(event_type = 'PushEvent') AS pushes,
              countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS prs,
              countIf(event_type = 'PullRequestEvent' AND action = 'closed') AS closed_prs,
              countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issues,
              countIf(event_type = 'ForkEvent') AS forks,
              uniqExact(actor_login) AS actors,
              count() AS events
       FROM github_events
       WHERE created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent', 'ForkEvent')
       GROUP BY repo_name
       HAVING pushes + commits + prs + closed_prs + issues + forks > 0
       ORDER BY prs * 4 + closed_prs * 3 + issues * 2 + forks * 3 + least(pushes, 10) + actors * 2 DESC,
                events DESC
       LIMIT 20`,
      ["github_events"]
    ),
    q<{ name: string; stars: string; surge: number; spark: number[] }>(
      `WITH recent AS (
         SELECT repo_name, sum(cnt) AS stars,
                groupArray(8)(cnt) AS spark
         FROM (
           SELECT repo_name, toStartOfHour(created_at) AS h, count() AS cnt
           FROM github_events
           WHERE event_type = 'WatchEvent'
             AND created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 24 HOUR
           GROUP BY repo_name, h ORDER BY repo_name, h
         ) GROUP BY repo_name
       ),
       base AS (
         SELECT repo_name, count() / 29 AS daily_avg
         FROM github_events
         WHERE event_type = 'WatchEvent'
           AND created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 30 DAY
           AND created_at <= (SELECT max(created_at) FROM github_events) - INTERVAL 24 HOUR
         GROUP BY repo_name
       )
       SELECT r.repo_name AS name,
              toString(sum(r.stars)) AS stars,
              round(sum(r.stars) / greatest(any(b.daily_avg), 0.5), 1) AS surge,
              any(r.spark) AS spark
       FROM recent r LEFT ANY JOIN base b ON r.repo_name = b.repo_name
       GROUP BY name ORDER BY sum(r.stars) DESC LIMIT 20`,
      ["github_events"]
    ),
    q<{ id: number; name: string; score: number; velocity: number }>(
      `SELECT id, title AS name, score,
              round(score / greatest((now() - time) / 3600, 0.5), 1) AS velocity
       FROM hackernews FINAL
       WHERE type = 'story' AND time > now() - INTERVAL 6 HOUR
         AND score >= 10 AND deleted = 0 AND dead = 0
       ORDER BY velocity DESC LIMIT 20`,
      ["hackernews"]
    ),
  ]);

  return {
    newRepos: repos.rows.map((r) => ({
      kicker: "NEW REPO",
      name: r.name,
      metric: "born " + r.at.slice(11, 16) + " UTC",
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    topForked: forks.rows.map((r) => ({
      kicker: "FORKED 24H",
      name: r.name,
      metric: `+${r.forks} new forks`,
      // No `delta`: it re-listed stars/pushes/PRs/issues, which the stats row
      // below already breaks out — the two rows rendered the same numbers twice.
      // stats carries the supporting dimensions (never `new forks` again, since
      // that IS the metric); pushes moved here from the old delta for resolution.
      stats: [
        stat("stars", r.stars, "hot"),
        stat("pushes", r.pushes),
        stat("PRs", r.prs),
        stat("issues", r.issues),
      ],
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    shippingVelocity: shipping.rows.map((r) => {
      const commits = valueOf(r.commits);
      const pushes = valueOf(r.pushes);
      // When the metric headlines pushes (no commits), don't repeat pushes in the
      // stats row — that repetition, plus the delta below, was the "same data
      // twice" the card showed. When the metric is commits, pushes is still a
      // distinct number worth keeping in stats.
      const metricIsPushes = commits === 0 && pushes > 0;
      const metric = commits > 0 ? `${r.commits} commits` : pushes > 0 ? `${r.pushes} pushes` : `${r.events} events`;
      return {
        kicker: "SHIPPING",
        name: r.name,
        metric,
        // No `delta`: it re-listed PRs/closed/issues/forks/actors, exactly the
        // dimensions the stats row breaks out, so the two rows were identical.
        stats: [
          ...(metricIsPushes ? [] : [stat("pushes", r.pushes, pushes > 0 ? "hot" : "muted")]),
          stat("PRs", r.prs),
          stat("closed", r.closed_prs),
          stat("issues", r.issues),
          stat("forks", r.forks),
          stat("actors", r.actors, "hot"),
        ],
        href: `https://github.com/${r.name}`,
        repoName: r.name,
      };
    }),
    starBreakouts: stars.rows.map((r) => ({
      kicker: "STARS 24H",
      name: r.name,
      metric: `+${r.stars} stars`,
      delta: `x${r.surge} vs 30d avg`,
      // No `stats` here: unlike topForked/shippingVelocity (whose stats break out
      // extra dimensions), the only two numbers are stars and surge, already shown
      // by metric/delta. A stats array re-encoding them made every card render the
      // same line twice ("+14 stars" then "14 stars").
      spark: r.spark,
      href: `https://github.com/${r.name}`,
      repoName: r.name,
    })),
    risingStories: stories.rows.map((r) => ({
      kicker: "RISING",
      name: r.name,
      metric: `${r.velocity} pts/hr`,
      delta: `${r.score} pts`,
      href: `https://news.ycombinator.com/item?id=${r.id}`,
    })),
    provenance: [repos.provenance, forks.provenance, shipping.provenance, stars.provenance, stories.provenance],
    fetchedAt: new Date().toISOString(),
  };
}

interface RepoDrilldownMetadataSqlRow {
  description: string;
  language: string;
  topics: string[];
  github_stars: string;
  github_forks: string;
  open_issues: string;
}

interface RepoDrilldownKpiSqlRow {
  pushes: string;
  commits: string;
  distinct_commits: string;
  forks: string;
  stars: string;
  issues_opened: string;
  prs_opened: string;
  prs_merged: string;
  actors: string;
}

interface RepoDrilldownVelocitySqlRow {
  hour: string;
  pushes: string;
  commits: string;
  forks: string;
  stars: string;
  issues_opened: string;
  prs_opened: string;
}

interface RepoDrilldownFeedSqlRow {
  at: string;
  actor: string;
  event_type: string;
  action: string;
  commits: string;
  distinct_commits: string;
  merged: number | string;
}

function repoQuerySql(...parts: Provenance[]) {
  return parts
    .map((part, index) => `-- repo drill-down query ${index + 1}\n${part.sql}`)
    .join("\n\n");
}

export async function repoDrilldown(repoName: string): Promise<RepoDrilldownPayload> {
  const queryParams = { repoName };
  const [metadata, kpis, velocity, feed] = await Promise.all([
    q<RepoDrilldownMetadataSqlRow>(
      `SELECT
         description,
         language,
         topics,
         toString(github_stars) AS github_stars,
         toString(github_forks) AS github_forks,
         toString(open_issues) AS open_issues
       FROM gh_repo_metadata FINAL
       WHERE repo_name = {repoName: String}
       LIMIT 1`,
      ["gh_repo_metadata"],
      queryParams
    ),
    q<RepoDrilldownKpiSqlRow>(
      `WITH (SELECT max(created_at) FROM github_events) AS high_water
       SELECT
         toString(countIf(event_type = 'PushEvent')) AS pushes,
         toString(sum(commit_count)) AS commits,
         toString(sum(distinct_commit_count)) AS distinct_commits,
         toString(countIf(event_type = 'ForkEvent')) AS forks,
         toString(countIf(event_type = 'WatchEvent')) AS stars,
         toString(countIf(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
         toString(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
         toString(countIf(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
         toString(uniqExact(actor_login)) AS actors
       FROM github_events
       WHERE repo_name = {repoName: String}
         AND created_at > high_water - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')`,
      ["github_events"],
      queryParams
    ),
    q<RepoDrilldownVelocitySqlRow>(
      `WITH (SELECT max(created_at) FROM github_events) AS high_water
       SELECT
         toString(toStartOfHour(created_at)) AS hour,
         toString(countIf(event_type = 'PushEvent')) AS pushes,
         toString(sum(commit_count)) AS commits,
         toString(countIf(event_type = 'ForkEvent')) AS forks,
         toString(countIf(event_type = 'WatchEvent')) AS stars,
         toString(countIf(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
         toString(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened
       FROM github_events
       WHERE repo_name = {repoName: String}
         AND created_at > high_water - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
       GROUP BY hour
       ORDER BY hour`,
      ["github_events"],
      queryParams
    ),
    q<RepoDrilldownFeedSqlRow>(
      `WITH (SELECT max(created_at) FROM github_events) AS high_water
       SELECT
         toString(created_at) AS at,
         actor_login AS actor,
         event_type,
         action,
         toString(commit_count) AS commits,
         toString(distinct_commit_count) AS distinct_commits,
         pr_merged AS merged
       FROM github_events
       WHERE repo_name = {repoName: String}
         AND created_at > high_water - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'PullRequestEvent')
       ORDER BY created_at DESC
       LIMIT 12`,
      ["github_events"],
      queryParams
    ),
  ]);

  const meta = metadata.rows[0];
  const totals = kpis.rows[0];
  const provenances = [metadata.provenance, kpis.provenance, velocity.provenance, feed.provenance];

  return {
    type: "repo-drilldown",
    repoName,
    generatedAt: new Date().toISOString(),
    metadata: {
      description: meta?.description ?? "",
      language: meta?.language ?? "",
      topics: meta?.topics ?? [],
      githubStars: Number(meta?.github_stars ?? 0),
      githubForks: Number(meta?.github_forks ?? 0),
      openIssues: Number(meta?.open_issues ?? 0),
    },
    kpis24h: {
      pushes: Number(totals?.pushes ?? 0),
      commits: Number(totals?.commits ?? 0),
      distinctCommits: Number(totals?.distinct_commits ?? 0),
      forks: Number(totals?.forks ?? 0),
      stars: Number(totals?.stars ?? 0),
      issuesOpened: Number(totals?.issues_opened ?? 0),
      prsOpened: Number(totals?.prs_opened ?? 0),
      prsMerged: Number(totals?.prs_merged ?? 0),
      actors: Number(totals?.actors ?? 0),
    },
    velocity: velocity.rows.map((row) => ({
      hour: row.hour,
      pushes: Number(row.pushes),
      commits: Number(row.commits),
      forks: Number(row.forks),
      stars: Number(row.stars),
      issuesOpened: Number(row.issues_opened),
      prsOpened: Number(row.prs_opened),
    })),
    feed: feed.rows.map((row) => ({
      at: row.at,
      actor: row.actor,
      eventType: row.event_type === "PullRequestEvent" ? "PullRequestEvent" : "PushEvent",
      action: row.action || (row.event_type === "PushEvent" ? "pushed" : "updated"),
      commits: Number(row.commits),
      distinctCommits: Number(row.distinct_commits),
      merged: Number(row.merged) === 1,
    })),
    query: {
      sql: repoQuerySql(...provenances),
      rowsRead: provenances.reduce((sum, provenance) => sum + (provenance.rowsRead ?? 0), 0),
      elapsedMs: provenances.reduce((sum, provenance) => sum + provenance.elapsedMs, 0),
    },
  };
}

export interface DailySeries {
  days: string[];
  provenance: Provenance;
}

export async function divergence(subject: string) {
  // subject is a hardcoded constant (no user input reaches SQL yet)
  const { rows, provenance } = await q<{ day: string; talk: string; code: string }>(
    `SELECT day, sumIf(c, src = 'hn') AS talk, sumIf(c, src = 'gh') AS code
     FROM (
       SELECT toDate(time) AS day, count() AS c, 'hn' AS src
       FROM hackernews FINAL
       WHERE type = 'story' AND hasToken(lower(title), '${subject}')
         AND time > now() - INTERVAL 30 DAY AND deleted = 0 AND dead = 0
       GROUP BY day
       UNION ALL
       SELECT toDate(created_at) AS day, count() AS c, 'gh' AS src
       FROM github_events
       WHERE repo_name ILIKE '%${subject}%' AND created_at > now() - INTERVAL 30 DAY
       GROUP BY day
     )
     GROUP BY day ORDER BY day`,
    ["hackernews", "github_events"]
  );
  // zero-fill 30 days
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: string[] = [];
  const talk: number[] = [];
  const code: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(d);
    talk.push(Number(byDay.get(d)?.talk ?? 0));
    code.push(Number(byDay.get(d)?.code ?? 0));
  }
  return { days, talk, code, provenance };
}

export async function pulse(subject: string) {
  const { rows, provenance } = await q<{ day: string; stories: string; points: string }>(
    `SELECT toDate(time) AS day, count() AS stories, sum(score) AS points
     FROM hackernews FINAL
     WHERE type = 'story' AND hasToken(lower(title), '${subject}')
       AND time > now() - INTERVAL 30 DAY AND deleted = 0 AND dead = 0
     GROUP BY day ORDER BY day`,
    ["hackernews"]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: string[] = [];
  const stories: number[] = [];
  const points: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(d);
    stories.push(Number(byDay.get(d)?.stories ?? 0));
    points.push(Number(byDay.get(d)?.points ?? 0));
  }
  return { days, stories, points, provenance };
}

export async function freshness() {
  const { rows } = await q<{ hn_lag_s: number; gh_chunk: string }>(
    `SELECT
       (SELECT toUInt32(now() - max(time)) FROM hackernews) AS hn_lag_s,
       (SELECT max(chunk_key) FROM ingest_log WHERE source = 'gharchive') AS gh_chunk`,
    ["hackernews", "ingest_log"]
  );
  return rows[0] ?? { hn_lag_s: -1, gh_chunk: "unknown" };
}

// --- gh_repo_metadata read layer (issue #25, AGENT-FLEET-PLAN.md §4.1/§4.4) ---
//
// `_l1d/_l7d/_l30d/_ltd` are time filters over `gh_repo_daily` JOIN'd to
// `gh_repo_metadata USING (repo_name)` - plain WHERE clauses over the existing
// tables, never new DB objects (goose owns all DDL; see migrations/20260720000009).

export type RepoWindow = "1d" | "7d" | "30d" | "td";

const REPO_WINDOW_DAYS: Record<RepoWindow, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  // github_events (and therefore gh_repo_daily) only retains ~30 days of history
  // (CLAUDE.md); "life to date" is expressed as a generous day count so every
  // window keeps the same `day >= today() - N` shape rather than special-casing
  // an unbounded filter.
  td: 36_500,
};

function repoWindowClause(window: RepoWindow) {
  return `day >= today() - ${REPO_WINDOW_DAYS[window]}`;
}

export interface RepoWindowRow {
  repo_name: string;
  owner: string;
  description: string;
  language: string;
  topics: string[];
  github_stars: number;
  events: number;
  actors: number;
  pushes: number;
  commits: number;
  stars: number;
  forks: number;
  prsOpened: number;
  prsMerged: number;
}

interface RepoWindowSqlRow {
  repo_name: string;
  owner: string;
  description: string;
  language: string;
  topics: string[];
  github_stars: string;
  events: string;
  actors: string;
  pushes: string;
  commits: string;
  stars: string;
  forks: string;
  prs_opened: string;
  prs_merged: string;
}

// Repo activity + metadata for one of the fixed windows, ranked by event volume.
// `gh_repo_metadata` is joined FINAL (ReplacingMergeTree - ungrouped parts can
// hold stale duplicate rows pre-merge, same reasoning as `hackernews FINAL`).
export async function repoActivityWindow(window: RepoWindow, limit = 20): Promise<QueryResult<RepoWindowRow[]>> {
  const sql = `
    SELECT
      d.repo_name AS repo_name,
      any(m.owner) AS owner,
      any(m.description) AS description,
      any(m.language) AS language,
      any(m.topics) AS topics,
      any(m.github_stars) AS github_stars,
      countMerge(d.events) AS events,
      uniqMerge(d.actors) AS actors,
      sum(d.pushes) AS pushes,
      sum(d.commits) AS commits,
      sum(d.stars) AS stars,
      sum(d.forks) AS forks,
      sum(d.prs_opened) AS prs_opened,
      sum(d.prs_merged) AS prs_merged
    FROM gh_repo_daily AS d
    LEFT JOIN gh_repo_metadata FINAL AS m ON m.repo_name = d.repo_name
    WHERE ${repoWindowClause(window)}
    GROUP BY d.repo_name
    ORDER BY events DESC
    LIMIT {limit: UInt32}
  `.trim();

  const { rows, provenance } = await q<RepoWindowSqlRow>(sql, ["gh_repo_daily", "gh_repo_metadata"], { limit });

  const data: RepoWindowRow[] = rows.map((r) => ({
    repo_name: r.repo_name,
    owner: r.owner,
    description: r.description,
    language: r.language,
    topics: r.topics ?? [],
    github_stars: Number(r.github_stars),
    events: Number(r.events),
    actors: Number(r.actors),
    pushes: Number(r.pushes),
    commits: Number(r.commits),
    stars: Number(r.stars),
    forks: Number(r.forks),
    prsOpened: Number(r.prs_opened),
    prsMerged: Number(r.prs_merged),
  }));

  return toQueryResult(data, provenance);
}

// Named convenience wrappers for the four windows named in the contract.
export const repoActivityL1d = (limit?: number) => repoActivityWindow("1d", limit);
export const repoActivityL7d = (limit?: number) => repoActivityWindow("7d", limit);
export const repoActivityL30d = (limit?: number) => repoActivityWindow("30d", limit);
export const repoActivityLtd = (limit?: number) => repoActivityWindow("td", limit);

// --- DevScatter read fn (issue #25) - the "real builders" data source ---
//
// Per-actor push/PR aggregates over github_events, filtered for human signal:
//   - excludes `[bot]`-pattern accounts outright
//   - excludes single-repo mega-pushers (script-spam, e.g. `bolividob` at 46k
//     pushes / 1 repo - see CLAUDE.md gotcha notes / AGENT-FLEET-PLAN.md §2.2)
//   - ranks by merged-PR rate + repo spread, not raw push volume
// Both exclusion counts are computed inside the single SQL statement returned
// as `sql`, so the disclosed `note` is never a JS-side reconstruction.
//
// Issue #40: LEFT JOINs `gh_actor_pr_stats` (GitHub-REST-enriched merged-PR
// counts, populated by the refreshActorPrStats Trigger.dev job) so the
// merge-rate ranking has real signal instead of the ~empty firehose
// sum(pr_merged) (CLAUDE.md gotcha #4). See devScatterSql()'s "issue #40"
// marked block for the exact JOIN/ranking edit.

export type DevScatterWindow = "7d" | "30d";

const DEV_SCATTER_WINDOW_DAYS: Record<DevScatterWindow, number> = { "7d": 7, "30d": 30 };

// Push-count threshold (on a single repo) past which an account is treated as
// a script-spam mega-pusher rather than a human contributor. Scaled with the
// window so the 30d cut isn't just 4x as forgiving as the 7d cut.
const MEGA_PUSHER_THRESHOLD: Record<DevScatterWindow, number> = { "7d": 150, "30d": 400 };

export interface DevScatterResult extends QueryResult<DevPoint[]> {
  note?: string; // discloses dropped bot/spam rows - no silent caps
  keptCount: number; // total actors that cleared the filter (data is the top-N slice of this)
}

interface DevScatterSqlRow {
  actor: string;
  pushes: string;
  repos: string;
  commits: string;
  prs: string;
  mergedPrs: string;
  bot_count: string;
  mega_pusher_count: string;
  kept_count: string;
}

// --- ISSUE #41 CHANGE (data-warehouse agent) -------------------------------
// Swapped the raw github_events scan (398,890,473 rows / ~7.9s measured live)
// for the gh_actor_daily rollup (migration
// migrations/20260720000012_gh_actor_daily_rollup.sql), an AggregatingMergeTree
// keyed by (day, actor_login) fed by a MV, read here with `-Merge` combinators -
// same pattern as repoActivityWindow() above / gh_repo_daily.
//
// Only the FROM-source and per-actor aggregation changed: raw
// countIf/sum/uniqExact over window_events became sum/uniqMerge over
// gh_actor_daily's pre-aggregated states. The bot/mega-pusher filtering
// predicates, the `meta` exclusion-count shape, the final ORDER BY ranking
// formula, and the DevScatterResult/DevScatterSqlRow contracts are all
// untouched byte-for-byte from before this change.
//
// Issue #40 (merged-PR signal enrichment) touches this same function's
// mergedPrs computation/ranking in parallel. If #40 lands first: reconcile by
// keeping this rollup FROM-source swap (gh_actor_daily instead of
// github_events) and re-applying #40's JOIN/ranking edit on top of the
// `per_actor`/`meta` CTEs below - the CTE names and output columns are
// unchanged so a JOIN onto `per_actor` should still apply cleanly.
// ---------------------------------------------------------------------------
// `mergedCol` selects the window-scoped enriched merged-PR count
// (gh_actor_pr_stats.merged_prs_7d | merged_prs_30d) matching the scatter's own
// p.prs denominator window - see the enriched CTE below and issue #40 / PR #43.
function devScatterSql(mergedCol: "merged_prs_7d" | "merged_prs_30d") {
  return `
    WITH actor_days AS (
      SELECT
        actor_login,
        uniqMerge(repos) AS repos,
        sum(pushes) AS pushes,
        sum(commits) AS commits,
        sum(prs_opened) AS prs,
        sum(prs_merged) AS mergedPrs
      FROM gh_actor_daily
      -- Anchored to the rollup's own high-water day, not wall clock, so the
      -- window self-heals after ingestion lag - same reasoning as the
      -- max(created_at) anchor this replaces (CLAUDE.md gotcha notes).
      WHERE day > (SELECT max(day) FROM gh_actor_daily) - {days: UInt32}
        AND actor_login != ''
      GROUP BY actor_login
    ),
    per_actor AS (
      SELECT
        actor_login AS actor,
        actor_login ILIKE '%[bot]%' AS is_bot,
        pushes,
        repos,
        commits,
        prs,
        mergedPrs
      FROM actor_days
    ),
    meta AS (
      SELECT
        countIf(is_bot) AS bot_count,
        countIf(NOT is_bot AND repos = 1 AND pushes >= {megaPushThreshold: UInt32}) AS mega_pusher_count,
        countIf(NOT is_bot AND NOT (repos = 1 AND pushes >= {megaPushThreshold: UInt32})) AS kept_count
      FROM per_actor
    ),
    -- Issue #40: GitHub-REST-enriched merged-PR counts (gh_actor_pr_stats,
    -- migration 20260721000012), fed by the refreshActorPrStats Trigger.dev job.
    -- ReplacingMergeTree(fetched_at) ORDER BY actor_login, so FINAL already
    -- collapses to one row per actor. ${mergedCol} is the count merged within
    -- THIS scatter's window, so dividing it by the window's p.prs (below) yields
    -- a bounded merge rate instead of a lifetime-count-over-window blowup.
    enriched AS (
      SELECT actor_login, ${mergedCol} AS merged_prs, 1 AS has_stats
      FROM gh_actor_pr_stats FINAL
    )
    SELECT
      p.actor AS actor,
      p.pushes AS pushes,
      p.repos AS repos,
      p.commits AS commits,
      p.prs AS prs,
      -- BEGIN issue #40 JOIN/ranking change (reconcile with issue #41 if it
      -- also touches this SELECT/ORDER BY): prefer the enriched merged-PR
      -- count over the firehose-derived sum(pr_merged), which is push-dominated
      -- and sparse (CLAUDE.md gotcha #4). en.has_stats = 1 is how we detect a
      -- real join match, since ClickHouse defaults unmatched LEFT JOIN columns
      -- to 0/empty rather than NULL.
      if(en.has_stats = 1, en.merged_prs, p.mergedPrs) AS mergedPrs,
      m.bot_count AS bot_count,
      m.mega_pusher_count AS mega_pusher_count,
      m.kept_count AS kept_count
    FROM per_actor AS p
    CROSS JOIN meta AS m
    LEFT JOIN enriched AS en ON en.actor_login = p.actor
    WHERE NOT p.is_bot
      AND NOT (p.repos = 1 AND p.pushes >= {megaPushThreshold: UInt32})
    -- Rank by merged-PR signal, real GitHub-REST data first. Zero-PR actors
    -- would score a spurious 1.0 from (mergedPrs+1)/(prs+1), so gate them below
    -- anyone with real PR activity rather than letting push-only accounts tie
    -- a 100% merge-rate contributor. Enriched actors (en.has_stats = 1) rank
    -- ahead of firehose-only actors since their merged-PR count is real, not a
    -- push-dominated proxy.
    ORDER BY
      (en.has_stats = 1) DESC,
      (p.prs > 0 OR en.has_stats = 1) DESC,
      (if(en.has_stats = 1, en.merged_prs, p.mergedPrs) + 1.0) / (p.prs + 1.0) DESC,
      p.repos DESC,
      p.commits DESC
    -- END issue #40 JOIN/ranking change
    LIMIT {limit: UInt32}
  `.trim();
}

export async function devScatter(window: DevScatterWindow, limit = 40): Promise<DevScatterResult> {
  const days = DEV_SCATTER_WINDOW_DAYS[window];
  const megaPushThreshold = MEGA_PUSHER_THRESHOLD[window];
  // Read the enriched merged-PR count scoped to this window, so it matches the
  // p.prs denominator the ranking divides it by (issue #40 / PR #43 review).
  const mergedCol = window === "7d" ? "merged_prs_7d" : "merged_prs_30d";

  // Provenance reconciles issue #41 + #40: the query no longer scans the raw
  // github_events firehose at all. It reads the gh_actor_daily rollup (#41's
  // FROM-source swap, via the actor_days CTE) and LEFT JOINs gh_actor_pr_stats
  // for the GitHub-REST-enriched merged-PR counts (#40, via the enriched CTE).
  const { rows, provenance } = await q<DevScatterSqlRow>(
    devScatterSql(mergedCol),
    ["gh_actor_daily", "gh_actor_pr_stats"],
    { days, megaPushThreshold, limit }
  );

  const data: DevPoint[] = rows.map((r) => ({
    actor: r.actor,
    pushes: Number(r.pushes),
    repos: Number(r.repos),
    commits: Number(r.commits),
    prs: Number(r.prs),
    mergedPrs: Number(r.mergedPrs),
  }));

  const botCount = Number(rows[0]?.bot_count ?? 0);
  const megaPusherCount = Number(rows[0]?.mega_pusher_count ?? 0);
  const dropped: string[] = [];
  if (botCount > 0) dropped.push(`${botCount} \`[bot]\`-pattern account${botCount === 1 ? "" : "s"}`);
  if (megaPusherCount > 0) {
    dropped.push(
      `${megaPusherCount} single-repo mega-pusher${megaPusherCount === 1 ? "" : "s"} (>=${megaPushThreshold} pushes to one repo)`
    );
  }
  const note = dropped.length ? `Excluded ${dropped.join(" and ")} from the ${window} window.` : undefined;
  const keptCount = Number(rows[0]?.kept_count ?? data.length);

  return { ...toQueryResult(data, provenance), note, keptCount };
}
