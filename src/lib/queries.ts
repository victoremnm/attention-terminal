// Server-side only: imported exclusively from server components and route
// handlers. ClickHouse credentials never reach the client bundle.
import { clickhouse } from "./clickhouse";
import type { DevPoint } from "./render-payload";

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
       GROUP BY repo_name ORDER BY at DESC LIMIT 8`,
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
           LIMIT 8
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
       LIMIT 8`,
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
       GROUP BY name ORDER BY sum(r.stars) DESC LIMIT 8`,
      ["github_events"]
    ),
    q<{ id: number; name: string; score: number; velocity: number }>(
      `SELECT id, title AS name, score,
              round(score / greatest((now() - time) / 3600, 0.5), 1) AS velocity
       FROM hackernews FINAL
       WHERE type = 'story' AND time > now() - INTERVAL 6 HOUR
         AND score >= 10 AND deleted = 0 AND dead = 0
       ORDER BY velocity DESC LIMIT 8`,
      ["hackernews"]
    ),
  ]);

  return {
    newRepos: repos.rows.map((r) => ({
      kicker: "NEW REPO",
      name: r.name,
      metric: "born " + r.at.slice(11, 16) + " UTC",
      href: `https://github.com/${r.name}`,
    })),
    topForked: forks.rows.map((r) => ({
      kicker: "FORKED 24H",
      name: r.name,
      metric: `+${r.forks} new forks`,
      delta: activityDelta([
        ["stars", r.stars],
        ["pushes", r.pushes],
        ["PRs", r.prs],
        ["issues", r.issues],
      ]) ?? "latest feed day",
      stats: [
        stat("new forks", r.forks, "hot"),
        stat("stars", r.stars),
        stat("PRs", r.prs),
        stat("issues", r.issues),
      ],
      href: `https://github.com/${r.name}`,
    })),
    shippingVelocity: shipping.rows.map((r) => {
      const commits = valueOf(r.commits);
      const pushes = valueOf(r.pushes);
      const metric = commits > 0 ? `${r.commits} commits` : pushes > 0 ? `${r.pushes} pushes` : `${r.events} events`;
      return {
        kicker: "SHIPPING",
        name: r.name,
        metric,
        delta: activityDelta([
          ["PRs", r.prs],
          ["closed", r.closed_prs],
          ["issues", r.issues],
          ["forks", r.forks],
          ["actors", r.actors],
        ]) ?? `${r.events} events`,
        stats: [
          stat("pushes", r.pushes, pushes > 0 ? "hot" : "muted"),
          stat("PRs", r.prs),
          stat("closed", r.closed_prs),
          stat("issues", r.issues),
          stat("forks", r.forks),
          stat("actors", r.actors),
        ],
        href: `https://github.com/${r.name}`,
      };
    }),
    starBreakouts: stars.rows.map((r) => ({
      kicker: "STARS 24H",
      name: r.name,
      metric: `+${r.stars} stars`,
      delta: `x${r.surge} vs 30d avg`,
      stats: [
        stat("stars", r.stars, "hot"),
        stat("vs 30d avg", `x${r.surge}`),
      ],
      spark: r.spark,
      href: `https://github.com/${r.name}`,
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
function devScatterSql() {
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
    )
    SELECT
      p.actor AS actor,
      p.pushes AS pushes,
      p.repos AS repos,
      p.commits AS commits,
      p.prs AS prs,
      p.mergedPrs AS mergedPrs,
      m.bot_count AS bot_count,
      m.mega_pusher_count AS mega_pusher_count,
      m.kept_count AS kept_count
    FROM per_actor AS p
    CROSS JOIN meta AS m
    WHERE NOT p.is_bot
      AND NOT (p.repos = 1 AND p.pushes >= {megaPushThreshold: UInt32})
    -- Rank by merged-PR signal. Zero-PR actors would score a spurious 1.0 from
    -- (mergedPrs+1)/(prs+1), so gate them below anyone with real PR activity
    -- rather than letting push-only accounts tie a 100% merge-rate contributor.
    ORDER BY (p.prs > 0) DESC, (p.mergedPrs + 1.0) / (p.prs + 1.0) DESC, p.repos DESC, p.commits DESC
    LIMIT {limit: UInt32}
  `.trim();
}

export async function devScatter(window: DevScatterWindow, limit = 40): Promise<DevScatterResult> {
  const days = DEV_SCATTER_WINDOW_DAYS[window];
  const megaPushThreshold = MEGA_PUSHER_THRESHOLD[window];

  // ISSUE #41 CHANGE: table provenance now points at the rollup, not the raw
  // firehose table - the view-SQL flip should show what was actually queried.
  const { rows, provenance } = await q<DevScatterSqlRow>(devScatterSql(), ["gh_actor_daily"], {
    days,
    megaPushThreshold,
    limit,
  });

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
