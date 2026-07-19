// Server-side only: imported exclusively from server components and route
// handlers. ClickHouse credentials never reach the client bundle.
import { clickhouse } from "./clickhouse";

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
