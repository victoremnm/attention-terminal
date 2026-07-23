// Server-side only: imported exclusively from server components and route
// handlers. ClickHouse credentials never reach the client bundle.
import { unstable_cache } from "next/cache";
import { clickhouse, clickhouseInsert, ensureTablesExist, missingTables } from "./clickhouse";
import { fetchRepoRow } from "./github-repo";
import { analyzeAndStoreRepo } from "./repo-analysis";
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
  await ensureTablesExist(tables);
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

async function assembleTickerLanes(): Promise<TickerLanes> {
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
    // Read the pre-aggregated hourly table instead of grouping the raw event
    // firehose for every page request. The aggregate table does not retain
    // actor names, so the bot filter is intentionally limited to the lanes
    // that still read actor-level activity from gh_repo_activity_feed.
    q<{ name: string; forks: string; stars: string; pushes: string; prs: string; issues: string }>(
      `WITH per_repo_event AS (
         SELECT repo_name, event_type, countMerge(events) AS event_count
         FROM gh_repo_hourly
         WHERE hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR
           AND event_type IN ('ForkEvent', 'WatchEvent', 'PushEvent', 'PullRequestEvent', 'IssuesEvent')
         GROUP BY repo_name, event_type
       ),
       per_repo AS (
         SELECT
           repo_name,
           sumIf(event_count, event_type = 'ForkEvent') AS fork_count,
           sumIf(event_count, event_type = 'WatchEvent') AS star_count,
           sumIf(event_count, event_type = 'PushEvent') AS push_count,
           sumIf(event_count, event_type = 'PullRequestEvent') AS pr_count,
           sumIf(event_count, event_type = 'IssuesEvent') AS issue_count
         FROM per_repo_event
         GROUP BY repo_name
         HAVING fork_count > 0 AND push_count + pr_count + issue_count > 0
       )
       SELECT repo_name AS name,
              toString(fork_count) AS forks,
              toString(star_count) AS stars,
              toString(push_count) AS pushes,
              toString(pr_count) AS prs,
              toString(issue_count) AS issues
       FROM per_repo
       ORDER BY pr_count * 5 + issue_count * 3 + push_count * 2 + least(fork_count, 20) DESC,
                fork_count DESC
       LIMIT 20`,
      ["gh_repo_hourly"]
    ),
    q<{
      name: string;
      commit_total: string;
      push_count: string;
      pr_count: string;
      closed_pr_count: string;
      issue_count: string;
      fork_count: string;
      actor_count: string;
      events: string;
    }>(
      // The activity feed is a recent, denormalized slice of github_events.
      // It retains actor and commit fields needed for the bot/substance gate
      // without rereading the entire raw firehose on every page request.
      `SELECT repo_name AS name,
              sum(commits) AS commit_total,
              countIf(event_type = 'PushEvent') AS push_count,
              countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS pr_count,
              countIf(event_type = 'PullRequestEvent' AND action = 'closed') AS closed_pr_count,
              countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issue_count,
              countIf(event_type = 'ForkEvent') AS fork_count,
              uniqExactIf(actor_login, event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')) AS actor_count,
              sum(commits) + countIf(event_type = 'PushEvent')
                + countIf(event_type = 'PullRequestEvent' AND action = 'opened')
                + countIf(event_type = 'PullRequestEvent' AND action = 'closed')
                + countIf(event_type = 'IssuesEvent' AND action = 'opened') AS events
       FROM gh_repo_activity_feed
       WHERE created_at > (SELECT max(created_at) FROM gh_repo_activity_feed) - INTERVAL 24 HOUR
         AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent', 'ForkEvent')
         AND NOT actor_login ILIKE '%[bot]%'
       GROUP BY repo_name
       HAVING commit_total > 0 OR pr_count > 0 OR closed_pr_count > 0
       ORDER BY commit_total * 4 + closed_pr_count * 5 + pr_count * 3
                + least(push_count, commit_total) * 2 + actor_count * 2 DESC,
                commit_total DESC
       LIMIT 20`,
      ["gh_repo_activity_feed"]
    ),
    // Use the hourly aggregate for both sides of the surge ratio. It keeps
    // the recent star signal while avoiding a second 30-day raw scan. This
    // aggregate does not retain actor names, so bot filtering is unavailable
    // here; the result is still bounded to the same event type and windows.
    q<{ name: string; stars: string; surge: number; spark: number[] }>(
      `WITH recent AS (
         SELECT repo_name, sum(cnt) AS star_total,
                groupArray(8)(cnt) AS spark
         FROM (
           SELECT repo_name, toStartOfHour(hour) AS h, countMerge(events) AS cnt
           FROM gh_repo_hourly
           WHERE event_type = 'WatchEvent'
             AND hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR
           GROUP BY repo_name, h ORDER BY repo_name, h
         ) GROUP BY repo_name
       ),
       base AS (
         SELECT repo_name, sum(cnt) / 29 AS daily_avg
         FROM (
           SELECT repo_name, toDate(hour) AS day, countMerge(events) AS cnt
           FROM gh_repo_hourly
           WHERE event_type = 'WatchEvent'
             AND hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 30 DAY
             AND hour <= (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR
           GROUP BY repo_name, day
         )
         GROUP BY repo_name
       )
       SELECT r.repo_name AS name,
              toString(r.star_total) AS stars,
              round(r.star_total / greatest(any(b.daily_avg), 0.5), 1) AS surge,
              r.spark AS spark
       FROM recent r LEFT ANY JOIN base b ON r.repo_name = b.repo_name
       GROUP BY r.repo_name, r.star_total, r.spark
       ORDER BY r.star_total DESC LIMIT 20`,
      ["gh_repo_hourly"]
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
      const commits = valueOf(r.commit_total);
      const pushes = valueOf(r.push_count);
      // When the metric headlines pushes (no commits), don't repeat pushes in the
      // stats row — that repetition, plus the delta below, was the "same data
      // twice" the card showed. When the metric is commits, pushes is still a
      // distinct number worth keeping in stats.
      const metricIsPushes = commits === 0 && pushes > 0;
      const metric = commits > 0 ? `${r.commit_total} commits` : pushes > 0 ? `${r.push_count} pushes` : `${r.events} events`;
      return {
        kicker: "SHIPPING",
        name: r.name,
        metric,
        // No `delta`: it re-listed PRs/closed/issues/forks/actors, exactly the
        // dimensions the stats row breaks out, so the two rows were identical.
        stats: [
          ...(metricIsPushes ? [] : [stat("pushes", r.push_count, pushes > 0 ? "hot" : "muted")]),
          stat("PRs", r.pr_count),
          stat("closed", r.closed_pr_count),
          stat("issues", r.issue_count),
          stat("forks", r.fork_count),
          stat("actors", r.actor_count, "hot"),
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

// The homepage is force-dynamic, but the ranking payload does not need a new
// firehose scan for every visitor. Sharing it for one minute also prevents a
// burst of requests from running all five ClickHouse lanes concurrently.
const cachedTickerLanes = unstable_cache(assembleTickerLanes, ["ticker-lanes"], {
  revalidate: 60,
});

export async function tickerLanes(): Promise<TickerLanes> {
  // Direct integration tests do not provide Next's incremental cache. They
  // still execute every SQL statement, so bypass only the framework wrapper.
  if (process.env.NODE_ENV === "test") return assembleTickerLanes();
  return cachedTickerLanes();
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

interface RepoDrilldownActorSqlRow {
  actor: string;
  pushes: string;
  commits: string;
  distinct_commits: string;
  prs_opened: string;
  prs_merged: string;
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

interface RepoDrilldownAnalysisSqlRow {
  overview: string;
  tech_stack: string[];
  key_files: string[];
  architecture_summary: string;
  analyzed_at: string;
}

// REST-activity rows (issue #79 track #83). Fetched by the watchlist poller
// (issue #82) and read here for the drilldown's activity + trends sections.
interface RepoDrilldownCommitSqlRow {
  sha: string;
  author: string;
  author_date: string;
  message: string;
}

interface RepoDrilldownPrSqlRow {
  number: string;
  title: string;
  state: string;
  author: string;
  created_at: string;
  merged_at: string;
  closed_at: string;
  labels: string[];
}

interface RepoDrilldownReleaseSqlRow {
  tag: string;
  name: string;
  author: string;
  published_at: string;
  body: string;
}

interface RepoDrilldownIssueSqlRow {
  number: string;
  title: string;
  state: string;
  author: string;
  created_at: string;
  closed_at: string;
  labels: string[];
  comments: string;
}

// 30-day trend row: daily star/fork counts from gh_repo_daily, with any
// release/PR-merge/issue-open events that landed on that date.
interface RepoDrilldownTrendSqlRow {
  date: string;
  stars: string;
  forks: string;
  event_type: string; // 'release' | 'pr_merged' | 'issue_opened' | '' (no event)
  event_label: string;
  event_url: string;
}

// Pulse overview (issue #79): GitHub's /pulse page computed en-masse from the
// REST-activity tables. Three separate result shapes from three queries:
//   1. PR/issue count breakdown (single row)
//   2. Commit summary (single row: author count + commit count)
//   3. Top committers (multiple rows, one per author)
interface RepoDrilldownPulseCountSqlRow {
  prs_merged: string;
  prs_opened: string;
  prs_open: string;
  issues_closed: string;
  issues_opened: string;
  issues_open: string;
}

interface RepoDrilldownPulseCommitSummarySqlRow {
  commit_authors: string;
  commit_count: string;
}

interface RepoDrilldownPulseTopCommitterSqlRow {
  author: string;
  commits: string;
}

function repoQuerySql(...parts: Provenance[]) {
  return parts
    .map((part, index) => `-- repo drill-down query ${index + 1}\n${part.sql}`)
    .join("\n\n");
}

// Existence guard for on-demand gh_repo_metadata persistence (issue #56 review
// finding): only repos that actually appear in our github_events firehose are
// worth persisting - anything else would seed a metadata row for a repo we
// have no ongoing signal for, and that row would then qualify forever for
// pickRepos()'s stale-refresh bucket. `LIMIT 1` on a non-aggregate SELECT lets
// ClickHouse short-circuit as soon as one matching row is found, rather than
// scanning/counting every match. Not part of the drilldown's own displayed
// provenance - this is an internal guard, not user-facing query data.
async function repoSeenInGithubEvents(repoName: string): Promise<boolean> {
  const rs = await clickhouse.query({
    query: `SELECT 1 AS present FROM github_events WHERE repo_name = {repoName: String} LIMIT 1`,
    format: "JSONEachRow",
    query_params: { repoName },
  });
  const rows = await rs.json<{ present: number }>();
  return rows.length > 0;
}

async function hasSeededAggregates(): Promise<boolean> {
  try {
    const missing = await missingTables(["gh_repo_drilldown_hourly", "gh_repo_actor_hourly"]);
    if (missing.length > 0) return false;
    const rs = await clickhouse.query({
      query: `SELECT count() AS c FROM gh_repo_drilldown_hourly LIMIT 1`,
      format: "JSONEachRow",
      clickhouse_settings: { max_execution_time: 5 },
    });
    const rows = await rs.json<{ c: number | string }>();
    return Number(rows[0]?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

async function hasAnalysisTable(): Promise<boolean> {
  try {
    const missing = await missingTables(["gh_repo_analysis"]);
    return missing.length === 0;
  } catch {
    return false;
  }
}

async function hasActorActivityFeedTable(): Promise<boolean> {
  try {
    const missing = await missingTables(["gh_repo_actor_activity_feed"]);
    return missing.length === 0;
  } catch {
    return false;
  }
}

// Groups the trend UNION ALL rows (one row per day + one row per event) into
// a per-date timeline with annotated events. Days with no event have an empty
// `events` array. The trend chart renders star/fork lines + event markers.
function buildTrends(rows: RepoDrilldownTrendSqlRow[]): Array<{
  date: string;
  stars: number;
  forks: number;
  events: Array<{ type: "release" | "pr_merged" | "issue_opened"; label: string; url: string }>;
}> {
  const byDate = new Map<string, { stars: number; forks: number; events: Array<{ type: "release" | "pr_merged" | "issue_opened"; label: string; url: string }> }>();
  for (const row of rows) {
    let entry = byDate.get(row.date);
    if (!entry) {
      entry = { stars: 0, forks: 0, events: [] };
      byDate.set(row.date, entry);
    }
    // The UNION ALL emits stars/forks only on the gh_repo_daily rows; event
    // rows carry 0 for stars/forks. Take the max so the daily row wins.
    entry.stars = Math.max(entry.stars, Number(row.stars));
    entry.forks = Math.max(entry.forks, Number(row.forks));
    if (row.event_type && row.event_label && row.event_url) {
      entry.events.push({
        type: row.event_type as "release" | "pr_merged" | "issue_opened",
        label: row.event_label,
        url: row.event_url,
      });
    }
  }
  return Array.from(byDate.entries())
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function repoDrilldown(repoName: string): Promise<RepoDrilldownPayload> {
  const queryParams = { repoName };
  const [useAggregates, canQueryAnalysis, canQueryActorFeed] = await Promise.all([
    hasSeededAggregates(),
    hasAnalysisTable(),
    hasActorActivityFeedTable(),
  ]);

  const metadataQuery = q<RepoDrilldownMetadataSqlRow>(
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
  );

  const kpiQuery = useAggregates
    ? q<RepoDrilldownKpiSqlRow>(
        `WITH (SELECT max(hour) FROM gh_repo_drilldown_hourly) AS high_water
         SELECT
           toString(sum(pushes)) AS pushes,
           toString(sum(commits)) AS commits,
           toString(sum(distinct_commits)) AS distinct_commits,
           toString(sum(forks)) AS forks,
           toString(sum(stars)) AS stars,
           toString(sum(issues_opened)) AS issues_opened,
           toString(sum(prs_opened)) AS prs_opened,
           toString(sum(prs_merged)) AS prs_merged,
           toString(uniqMerge(actors)) AS actors
         FROM gh_repo_drilldown_hourly
         WHERE repo_name = {repoName: String}
           AND hour > high_water - INTERVAL 24 HOUR`,
        ["gh_repo_drilldown_hourly"],
        queryParams
      )
    : q<RepoDrilldownKpiSqlRow>(
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
      );

  const velocityQuery = useAggregates
    ? q<RepoDrilldownVelocitySqlRow>(
        `WITH (SELECT max(hour) FROM gh_repo_drilldown_hourly) AS high_water
         SELECT
           toString(bucket_hour) AS hour,
           toString(pushes) AS pushes,
           toString(commits) AS commits,
           toString(forks) AS forks,
           toString(stars) AS stars,
           toString(issues_opened) AS issues_opened,
           toString(prs_opened) AS prs_opened
         FROM (
           SELECT
             hour AS bucket_hour,
             sum(pushes) AS pushes,
             sum(commits) AS commits,
             sum(forks) AS forks,
             sum(stars) AS stars,
             sum(issues_opened) AS issues_opened,
             sum(prs_opened) AS prs_opened
           FROM gh_repo_drilldown_hourly
           WHERE repo_name = {repoName: String}
             AND hour > high_water - INTERVAL 24 HOUR
           GROUP BY bucket_hour
         )
         ORDER BY bucket_hour`,
        ["gh_repo_drilldown_hourly"],
        queryParams
      )
    : q<RepoDrilldownVelocitySqlRow>(
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
      );

  const actorsQuery = useAggregates
    ? q<RepoDrilldownActorSqlRow>(
        `WITH (SELECT max(hour) FROM gh_repo_drilldown_hourly) AS high_water
         SELECT
           actor,
           toString(push_total) AS pushes,
           toString(commit_total) AS commits,
           toString(distinct_commit_total) AS distinct_commits,
           toString(pr_opened_total) AS prs_opened,
           toString(pr_merged_total) AS prs_merged
         FROM (
           SELECT
              actor_login AS actor,
              sum(pushes) AS push_total,
              sum(commits) AS commit_total,
              sum(distinct_commits) AS distinct_commit_total,
              sum(prs_opened) AS pr_opened_total,
              sum(prs_merged) AS pr_merged_total,
              (commit_total * 3) + (distinct_commit_total * 2) + (pr_opened_total * 3) + (pr_merged_total * 5) + least(push_total, commit_total) AS activity_score
            FROM gh_repo_actor_hourly
            WHERE repo_name = {repoName: String}
              AND hour > high_water - INTERVAL 24 HOUR
            GROUP BY actor_login
            HAVING commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0
          )
          ORDER BY activity_score DESC, actor
          LIMIT 8`,
        ["gh_repo_actor_hourly", "gh_repo_drilldown_hourly"],
        queryParams
      )
    : q<RepoDrilldownActorSqlRow>(
        `WITH (SELECT max(created_at) FROM github_events) AS high_water
         SELECT
           actor,
           toString(push_total) AS pushes,
           toString(commit_total) AS commits,
           toString(distinct_commit_total) AS distinct_commits,
           toString(pr_opened_total) AS prs_opened,
           toString(pr_merged_total) AS prs_merged
         FROM (
           SELECT
             actor_login AS actor,
             countIf(event_type = 'PushEvent') AS push_total,
             sum(commit_count) AS commit_total,
             sum(distinct_commit_count) AS distinct_commit_total,
             countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS pr_opened_total,
             countIf(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1) AS pr_merged_total,
             (commit_total * 3) + (distinct_commit_total * 2) + (pr_opened_total * 3) + (pr_merged_total * 5) + least(push_total, commit_total) AS activity_score
           FROM github_events
           WHERE repo_name = {repoName: String}
             AND created_at > high_water - INTERVAL 24 HOUR
             AND event_type IN ('PushEvent', 'PullRequestEvent')
           GROUP BY actor_login
           HAVING commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0
         )
         ORDER BY activity_score DESC, actor
         LIMIT 8`,
        ["github_events"],
        queryParams
      );

  const feedQuery =
    useAggregates && canQueryActorFeed
      ? q<RepoDrilldownFeedSqlRow>(
          `WITH (SELECT max(hour) FROM gh_repo_drilldown_hourly) AS high_water
           SELECT
             toString(created_at) AS at,
             actor_login AS actor,
             event_type,
             action,
             toString(commits) AS commits,
             toString(distinct_commits) AS distinct_commits,
             pr_merged AS merged
           FROM gh_repo_actor_activity_feed FINAL
           WHERE repo_name = {repoName: String}
             AND created_at > high_water - INTERVAL 24 HOUR
           ORDER BY created_at DESC
           LIMIT 12`,
          ["gh_repo_actor_activity_feed", "gh_repo_drilldown_hourly"],
          queryParams
        )
      : q<RepoDrilldownFeedSqlRow>(
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
        );

  const analysisQuery = canQueryAnalysis
    ? q<RepoDrilldownAnalysisSqlRow>(
        `SELECT
           overview,
           tech_stack,
           key_files,
           architecture_summary,
           toString(analyzed_at) AS analyzed_at
         FROM gh_repo_analysis FINAL
         WHERE repo_name = {repoName: String}
         LIMIT 1`,
        ["gh_repo_analysis"],
        queryParams
      )
    : Promise.resolve({
        rows: [] as RepoDrilldownAnalysisSqlRow[],
        provenance: { sql: "-- gh_repo_analysis unmigrated", elapsedMs: 0, rowsRead: 0, tables: [] },
      });

  // --- REST-activity queries (issue #79 track #83) -------------------------
  // 7-day window for the activity lists. Graceful degradation: if the
  // poller (#82) hasn't run yet, these return empty and the payload omits
  // `activity`/`trends` (see the return shaping below). These don't need the
  // `useAggregates` conditional — they read from the new REST tables directly.
  const commitsQuery = q<RepoDrilldownCommitSqlRow>(
    `SELECT sha, author, toString(author_date) AS author_date, message
     FROM (
       SELECT sha, author, author_date, message
       FROM gh_repo_commits FINAL
       WHERE repo_name = {repoName: String} AND author_date >= now() - INTERVAL 7 DAY
       ORDER BY author_date DESC LIMIT 10
     )`,
    ["gh_repo_commits"],
    queryParams
  );
  const prsQuery = q<RepoDrilldownPrSqlRow>(
    `SELECT toString(number) AS number, title, state, author,
            toString(created_at) AS created_at,
            toString(merged_at) AS merged_at,
            toString(closed_at) AS closed_at,
            labels
     FROM (
       SELECT number, title, state, author, created_at, merged_at, closed_at, labels
       FROM gh_repo_prs FINAL
       WHERE repo_name = {repoName: String}
         AND (created_at >= now() - INTERVAL 7 DAY
              OR merged_at >= now() - INTERVAL 7 DAY
              OR closed_at >= now() - INTERVAL 7 DAY)
       ORDER BY created_at DESC LIMIT 10
     )`,
    ["gh_repo_prs"],
    queryParams
  );
  const releasesQuery = q<RepoDrilldownReleaseSqlRow>(
    `SELECT tag, name, author, toString(published_at) AS published_at, body
     FROM (
       SELECT tag, name, author, published_at, body
       FROM gh_repo_releases FINAL
       WHERE repo_name = {repoName: String}
         AND published_at >= now() - INTERVAL 7 DAY
       ORDER BY published_at DESC LIMIT 10
     )`,
    ["gh_repo_releases"],
    queryParams
  );
  const issuesQuery = q<RepoDrilldownIssueSqlRow>(
    `SELECT toString(number) AS number, title, state, author,
            toString(created_at) AS created_at,
            toString(closed_at) AS closed_at,
            labels, toString(comments) AS comments
     FROM (
       SELECT number, title, state, author, created_at, closed_at, labels, comments
       FROM gh_repo_issues FINAL
       WHERE repo_name = {repoName: String} AND created_at >= now() - INTERVAL 7 DAY
       ORDER BY created_at DESC LIMIT 10
     )`,
    ["gh_repo_issues"],
    queryParams
  );
  // 30-day trend timeline: daily stars/forks from gh_repo_daily, with any
  // release / PR-merge / issue-open events that landed on that date. The
  // UNION ALL pattern lets us annotate days that had content events without
  // a JOIN (releases/PRs/issues are sparse — most days have no event).
  // All branches cast to explicit types so ClickHouse doesn't reject the
  // UNION ALL on type mismatches (Date vs DateTime, UInt64 vs UInt8, etc.).
  const trendsQuery = q<RepoDrilldownTrendSqlRow>(
    `SELECT
       toString(day) AS date,
       toString(stars) AS stars,
       toString(forks) AS forks,
       event_type,
       event_label,
       event_url
     FROM (
       SELECT
         toDate(day) AS day,
         toUInt64(sum(stars)) AS stars,
         toUInt64(sum(forks)) AS forks,
         '' AS event_type,
         '' AS event_label,
         '' AS event_url
       FROM gh_repo_daily
       WHERE repo_name = {repoName: String} AND day >= today() - 30
       GROUP BY day
       UNION ALL
       SELECT
         toDate(published_at) AS day,
         toUInt64(0) AS stars,
         toUInt64(0) AS forks,
         'release' AS event_type,
         concat('release ', tag) AS event_label,
         concat('https://github.com/', {repoName: String}, '/releases/tag/', tag) AS event_url
       FROM gh_repo_releases FINAL
       WHERE repo_name = {repoName: String} AND published_at >= today() - 30
       UNION ALL
       SELECT
         toDate(merged_at) AS day,
         toUInt64(0) AS stars,
         toUInt64(0) AS forks,
         'pr_merged' AS event_type,
         concat('#', toString(number), ' ', title) AS event_label,
         concat('https://github.com/', {repoName: String}, '/pull/', toString(number)) AS event_url
       FROM gh_repo_prs FINAL
       WHERE repo_name = {repoName: String} AND merged_at >= today() - 30
       UNION ALL
       SELECT
         toDate(created_at) AS day,
         toUInt64(0) AS stars,
         toUInt64(0) AS forks,
         'issue_opened' AS event_type,
         concat('#', toString(number), ' ', title) AS event_label,
         concat('https://github.com/', {repoName: String}, '/issues/', toString(number)) AS event_url
       FROM gh_repo_issues FINAL
       WHERE repo_name = {repoName: String} AND created_at >= today() - 30
     )
     ORDER BY date ASC`,
    ["gh_repo_daily", "gh_repo_releases", "gh_repo_prs", "gh_repo_issues"],
    queryParams
  );

  // --- Pulse overview queries (issue #79) -----------------------------------
  // GitHub's /pulse page computed en-masse from the REST-activity tables.
  // 7-day window matches the activity lists. Three queries: PR/issue counts,
  // commit summary, top committers. All degrade to zero/empty when the
  // poller hasn't populated the tables.
  const pulseWindowDays = 7;
  const pulseSinceClause = `>= now() - INTERVAL ${pulseWindowDays} DAY`;

  const pulseCountsQuery = q<RepoDrilldownPulseCountSqlRow>(
    `SELECT
       toString(countIf(merged_at ${pulseSinceClause})) AS prs_merged,
       toString(countIf(created_at ${pulseSinceClause})) AS prs_opened,
       toString(countIf(state = 'open')) AS prs_open,
       toString(countIf(closed_at ${pulseSinceClause})) AS issues_closed,
       toString(countIf(created_at ${pulseSinceClause})) AS issues_opened,
       toString(countIf(state = 'open')) AS issues_open
     FROM (
       SELECT number, created_at, merged_at, closed_at, state FROM gh_repo_prs FINAL WHERE repo_name = {repoName: String}
       UNION ALL
       SELECT number, created_at, toDate('1970-01-01 00:00:00') AS merged_at, closed_at, state FROM gh_repo_issues FINAL WHERE repo_name = {repoName: String}
     )`,
    ["gh_repo_prs", "gh_repo_issues"],
    queryParams
  );

  const pulseCommitSummaryQuery = q<RepoDrilldownPulseCommitSummarySqlRow>(
    `SELECT
       toString(uniqExact(author)) AS commit_authors,
       toString(count()) AS commit_count
     FROM gh_repo_commits FINAL
     WHERE repo_name = {repoName: String} AND author_date ${pulseSinceClause}`,
    ["gh_repo_commits"],
    queryParams
  );

  const pulseTopCommittersQuery = q<RepoDrilldownPulseTopCommitterSqlRow>(
    `SELECT author, toString(count()) AS commits
     FROM gh_repo_commits FINAL
     WHERE repo_name = {repoName: String} AND author_date ${pulseSinceClause}
     GROUP BY author
     ORDER BY commits DESC
     LIMIT 8`,
    ["gh_repo_commits"],
    queryParams
  );

  const [metadata, kpis, velocity, actors, feed, analysisResult, commitsR, prsR, releasesR, issuesR, trendsR, pulseCountsR, pulseCommitSummaryR, pulseTopCommittersR] = await Promise.all([
    metadataQuery,
    kpiQuery,
    velocityQuery,
    actorsQuery,
    feedQuery,
    analysisQuery,
    commitsQuery,
    prsQuery,
    releasesQuery,
    issuesQuery,
    trendsQuery,
    pulseCountsQuery,
    pulseCommitSummaryQuery,
    pulseTopCommittersQuery,
  ]);

  let meta = metadata.rows[0];
  let analysisRow = analysisResult.rows[0];
  const totals = kpis.rows[0];
  const provenances = [
    metadata.provenance,
    kpis.provenance,
    velocity.provenance,
    actors.provenance,
    feed.provenance,
    analysisResult.provenance,
    commitsR.provenance,
    prsR.provenance,
    releasesR.provenance,
    issuesR.provenance,
    trendsR.provenance,
    pulseCountsR.provenance,
    pulseCommitSummaryR.provenance,
    pulseTopCommittersR.provenance,
  ];

  if (!meta && process.env.GITHUB_TOKEN) {
    try {
      const fetched = await fetchRepoRow(repoName, { fast: true });
      if (fetched) {
        meta = {
          description: fetched.description,
          language: fetched.language,
          topics: fetched.topics,
          github_stars: String(fetched.github_stars),
          github_forks: String(fetched.github_forks),
          open_issues: String(fetched.open_issues),
        };

        try {
          const seenInFirehose = await repoSeenInGithubEvents(repoName);
          if (seenInFirehose) {
            await clickhouseInsert.insert({
              table: "gh_repo_metadata",
              values: [fetched],
              format: "JSONEachRow",
            });
          }
        } catch (insertError) {
          console.error("[repoDrilldown] on-demand gh_repo_metadata persistence failed", {
            repoName,
            error: insertError,
          });
        }
      }
    } catch (fetchError) {
      console.error("[repoDrilldown] on-demand GitHub fetch failed", { repoName, error: fetchError });
    }
  }

  if (!analysisRow) {
    try {
      const generated = await analyzeAndStoreRepo(
        repoName,
        meta?.language,
        meta?.topics,
        { fast: true }
      );
      if (generated) {
        analysisRow = {
          overview: generated.overview,
          tech_stack: generated.tech_stack,
          key_files: generated.key_files,
          architecture_summary: generated.architecture_summary,
          analyzed_at: generated.analyzed_at,
        };
      }
    } catch (analysisError) {
      console.error("[repoDrilldown] on-demand repo analysis failed", { repoName, error: analysisError });
    }
  }

  const analysisPayload = analysisRow
    ? {
        overview: analysisRow.overview,
        techStack: analysisRow.tech_stack ?? [],
        keyFiles: analysisRow.key_files ?? [],
        architectureSummary: analysisRow.architecture_summary,
        analyzedAt: analysisRow.analyzed_at,
      }
    : undefined;

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
    topActors24h: actors.rows.map((row) => ({
      actor: row.actor,
      pushes: Number(row.pushes),
      commits: Number(row.commits),
      distinctCommits: Number(row.distinct_commits),
      prsOpened: Number(row.prs_opened),
      prsMerged: Number(row.prs_merged),
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
    analysis: analysisPayload,
    // REST-activity enrichment (issue #79 track #83). Omitted when the poller
    // (#82) hasn't populated the tables yet — graceful degradation to v1.
    activity:
      commitsR.rows.length || prsR.rows.length || releasesR.rows.length || issuesR.rows.length
        ? {
            commits: commitsR.rows.map((row) => ({
              sha: row.sha,
              author: row.author,
              authorDate: row.author_date,
              message: row.message,
            })),
            prs: prsR.rows.map((row) => ({
              number: Number(row.number),
              title: row.title,
              state: row.state,
              author: row.author,
              createdAt: row.created_at,
              mergedAt: row.merged_at,
              closedAt: row.closed_at,
              labels: row.labels ?? [],
            })),
            releases: releasesR.rows.map((row) => ({
              tag: row.tag,
              name: row.name,
              author: row.author,
              publishedAt: row.published_at,
              body: row.body,
            })),
            issues: issuesR.rows.map((row) => ({
              number: Number(row.number),
              title: row.title,
              state: row.state,
              author: row.author,
              createdAt: row.created_at,
              closedAt: row.closed_at,
              labels: row.labels ?? [],
              comments: Number(row.comments),
            })),
          }
        : undefined,
    // 30-day trend timeline with annotated content events. Omitted when the
    // trends query returns no rows (poller hasn't run OR repo has no 30d
    // firehose signal).
    trends: trendsR.rows.length
      ? buildTrends(trendsR.rows)
      : undefined,
    // Pulse overview (issue #79): GitHub's /pulse page computed en-masse from
    // the REST-activity tables. Omitted when the poller hasn't populated the
    // tables yet (all counts zero + no top committers).
    pulse: (pulseCommitSummaryR.rows.length || pulseTopCommittersR.rows.length)
      ? (() => {
          const pc = pulseCountsR.rows[0];
          const cs = pulseCommitSummaryR.rows[0];
          const prsMerged = Number(pc?.prs_merged ?? 0);
          const prsOpened = Number(pc?.prs_opened ?? 0);
          const prsOpen = Number(pc?.prs_open ?? 0);
          const issuesClosed = Number(pc?.issues_closed ?? 0);
          const issuesOpened = Number(pc?.issues_opened ?? 0);
          const issuesOpen = Number(pc?.issues_open ?? 0);
          return {
            windowDays: 7,
            prsMerged,
            prsOpened,
            prsOpen,
            prsActive: prsMerged + prsOpened + prsOpen,
            issuesClosed,
            issuesOpened,
            issuesOpen,
            issuesActive: issuesClosed + issuesOpened + issuesOpen,
            commitAuthors: Number(cs?.commit_authors ?? 0),
            commitCount: Number(cs?.commit_count ?? 0),
            topCommitters: pulseTopCommittersR.rows.map((row) => ({
              author: row.author,
              commits: Number(row.commits),
            })),
          };
        })()
      : undefined,
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
  // Day-ordered per-day event counts across the window - drives the row
  // sparkline on /trending. Windows shorter than 2 days yield <2 points
  // (Sparkline renders nothing then, which the table handles gracefully).
  spark: number[];
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
  // UInt64 array -> HTTP JSON returns each element as a string.
  spark: string[];
}

// Repo activity + metadata for one of the fixed windows, ranked by event volume.
// `gh_repo_metadata` is joined FINAL (ReplacingMergeTree - ungrouped parts can
// hold stale duplicate rows pre-merge, same reasoning as `hackernews FINAL`).
export async function repoActivityWindow(window: RepoWindow, limit = 20): Promise<QueryResult<RepoWindowRow[]>> {
  // Two-level aggregation: the inner query rolls each repo up per day (so we can
  // emit an ordered per-day event array for the sparkline), the outer collapses
  // days into the window total. Additive metrics (events/pushes/.../prs) sum
  // across days; `actors` is a uniq HLL state, so we carry it with
  // uniqMergeState per day and union it with uniqMerge in the outer query -
  // summing per-day uniqs would double-count anyone active on multiple days.
  const sql = `
    SELECT
      repo_name,
      any(owner) AS owner,
      any(description) AS description,
      any(language) AS language,
      any(topics) AS topics,
      any(github_stars) AS github_stars,
      sum(day_events) AS events,
      uniqMerge(actors_state) AS actors,
      sum(day_pushes) AS pushes,
      sum(day_commits) AS commits,
      sum(day_stars) AS stars,
      sum(day_forks) AS forks,
      sum(day_prs_opened) AS prs_opened,
      sum(day_prs_merged) AS prs_merged,
      arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((day, day_events)))) AS spark
    FROM (
      SELECT
        d.repo_name AS repo_name,
        d.day AS day,
        any(m.owner) AS owner,
        any(m.description) AS description,
        any(m.language) AS language,
        any(m.topics) AS topics,
        any(m.github_stars) AS github_stars,
        countMerge(d.events) AS day_events,
        uniqMergeState(d.actors) AS actors_state,
        sum(d.pushes) AS day_pushes,
        sum(d.commits) AS day_commits,
        sum(d.stars) AS day_stars,
        sum(d.forks) AS day_forks,
        sum(d.prs_opened) AS day_prs_opened,
        sum(d.prs_merged) AS day_prs_merged
      FROM gh_repo_daily AS d
      LEFT JOIN gh_repo_metadata AS m FINAL ON m.repo_name = d.repo_name
      WHERE ${repoWindowClause(window)}
      GROUP BY d.repo_name, d.day
    )
    GROUP BY repo_name
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
    spark: (r.spark ?? []).map(Number),
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
