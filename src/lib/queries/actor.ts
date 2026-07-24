import type { DevPoint } from "../render-payload";
import { q, toQueryResult } from "./core";
import type { ActorLeaderboard, ActorLeaderboardRow, DevScatterResult, DevScatterWindow } from "./types";

type ActorLeaderboardSqlRow = {
  actor_login: string;
  events: string;
  repos: string;
  pushes: string;
  prs_opened: string;
  prs_merged: string;
  score: string;
};

export async function actorLeaderboard(window: "24h" | "7d" = "24h"): Promise<ActorLeaderboard> {
  const dailyWindow = window === "24h" ? "today() - 1" : "today() - 7";
  const humanQuery =
    window === "24h"
      ? `
    WITH (SELECT coalesce(max(hour), toStartOfHour(now())) FROM gh_repo_hourly) AS high_water
    SELECT
      e.actor_login,
      toString(count()) AS events,
      toString(uniqExact(e.repo_name)) AS repos,
      toString(countIf(e.event_type = 'PushEvent')) AS pushes,
      toString(countIf(e.event_type = 'PullRequestEvent' AND e.action = 'opened')) AS prs_opened,
      toString(countIf(e.event_type = 'PullRequestEvent' AND e.pr_merged = 1)) AS prs_merged,
      toString(
        round(
          countIf(e.event_type = 'PullRequestEvent' AND e.pr_merged = 1) * 5 +
          countIf(e.event_type = 'PullRequestEvent' AND e.action = 'opened') * 3 +
          countIf(e.event_type = 'PushEvent') * 2 +
          count() * 1 +
          uniqExact(e.repo_name) * 2,
          1
        )
      ) AS score
    FROM raw.github_events AS e
    LEFT JOIN gh_actor_classification cls ON cls.actor_login = e.actor_login
    WHERE e.created_at > high_water - INTERVAL 24 HOUR
      AND coalesce(cls.actor_type, '') != 'Bot' AND (cls.actor_type IS NOT NULL OR lower(e.actor_login) NOT LIKE '%[bot]%')
    GROUP BY e.actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `
      : `
    SELECT
      d.actor_login,
      toString(countMerge(d.events)) AS events,
      toString(uniqMerge(d.repos)) AS repos,
      toString(sum(d.pushes)) AS pushes,
      toString(sum(d.prs_opened)) AS prs_opened,
      toString(sum(d.prs_merged)) AS prs_merged,
      toString(
        round(
          sum(d.prs_merged) * 5 +
          sum(d.prs_opened) * 3 +
          sum(d.pushes) * 2 +
          countMerge(d.events) * 1 +
          uniqMerge(d.repos) * 2,
          1
        )
      ) AS score
    FROM gh_actor_daily AS d
    LEFT JOIN gh_actor_classification cls ON cls.actor_login = d.actor_login
    WHERE d.day >= ${dailyWindow}
      AND coalesce(cls.actor_type, '') != 'Bot' AND (cls.actor_type IS NOT NULL OR lower(d.actor_login) NOT LIKE '%[bot]%')
    GROUP BY d.actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `;

  const botQuery =
    window === "24h"
      ? `
    WITH (SELECT coalesce(max(hour), toStartOfHour(now())) FROM gh_repo_hourly) AS high_water
    SELECT
      e.actor_login,
      toString(count()) AS events,
      toString(uniqExact(e.repo_name)) AS repos,
      toString(countIf(e.event_type = 'PushEvent')) AS pushes,
      toString(countIf(e.event_type = 'PullRequestEvent' AND e.action = 'opened')) AS prs_opened,
      toString(countIf(e.event_type = 'PullRequestEvent' AND e.pr_merged = 1)) AS prs_merged,
      toString(round(count(), 1)) AS score
    FROM raw.github_events AS e
    LEFT JOIN gh_actor_classification cls ON cls.actor_login = e.actor_login
    WHERE e.created_at > high_water - INTERVAL 24 HOUR
      AND (cls.actor_type = 'Bot' OR lower(e.actor_login) LIKE '%[bot]%')
    GROUP BY e.actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `
      : `
    SELECT
      d.actor_login,
      toString(countMerge(d.events)) AS events,
      toString(uniqMerge(d.repos)) AS repos,
      toString(sum(d.pushes)) AS pushes,
      toString(sum(d.prs_opened)) AS prs_opened,
      toString(sum(d.prs_merged)) AS prs_merged,
      toString(round(countMerge(d.events), 1)) AS score
    FROM gh_actor_daily AS d
    LEFT JOIN gh_actor_classification cls ON cls.actor_login = d.actor_login
    WHERE d.day >= ${dailyWindow}
      AND (cls.actor_type = 'Bot' OR lower(d.actor_login) LIKE '%[bot]%')
    GROUP BY d.actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `;

  const [humans, bots] = await Promise.all([
    q<ActorLeaderboardSqlRow>(humanQuery, window === "24h" ? ["raw.github_events"] : ["gh_actor_daily"]),
    q<ActorLeaderboardSqlRow>(botQuery, window === "24h" ? ["raw.github_events"] : ["gh_actor_daily"]),
  ]);

  const mapRow = (row: ActorLeaderboardSqlRow): ActorLeaderboardRow => ({
    actor_login: row.actor_login,
    events: Number(row.events),
    repos: Number(row.repos),
    pushes: Number(row.pushes),
    prs_opened: Number(row.prs_opened),
    prs_merged: Number(row.prs_merged),
    score: Number(row.score),
  });

  return {
    humans: humans.rows.map(mapRow),
    bots: bots.rows.map(mapRow),
    provenance: [humans.provenance, bots.provenance],
  };
}

const DEV_SCATTER_WINDOW_DAYS: Record<DevScatterWindow, number> = { "7d": 7, "30d": 30 };
const MEGA_PUSHER_THRESHOLD: Record<DevScatterWindow, number> = { "7d": 150, "30d": 400 };

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
      WHERE day > (SELECT max(day) FROM gh_actor_daily) - {days: UInt32}
        AND actor_login != ''
      GROUP BY actor_login
    ),
    per_actor AS (
      SELECT
        ad.actor_login AS actor,
        coalesce(cls.actor_type, '') = 'Bot' OR lower(ad.actor_login) LIKE '%[bot]%' AS is_bot,
        ad.pushes,
        ad.repos,
        ad.commits,
        ad.prs,
        ad.mergedPrs
      FROM actor_days AS ad
      LEFT JOIN gh_actor_classification cls ON cls.actor_login = ad.actor_login
    ),
    meta AS (
      SELECT
        countIf(is_bot) AS bot_count,
        countIf(NOT is_bot AND repos = 1 AND pushes >= {megaPushThreshold: UInt32}) AS mega_pusher_count,
        countIf(NOT is_bot AND NOT (repos = 1 AND pushes >= {megaPushThreshold: UInt32})) AS kept_count
      FROM per_actor
    ),
    filtered AS (
      SELECT actor, pushes, repos, commits, prs, mergedPrs
      FROM per_actor
      WHERE NOT is_bot
        AND NOT (repos = 1 AND pushes >= {megaPushThreshold: UInt32})
    ),
    enriched AS (
      SELECT actor_login, ${mergedCol} AS merged_prs, 1 AS has_stats
      FROM gh_actor_pr_stats FINAL
    ),
    ranked AS (
      SELECT
        f.actor AS actor,
        f.pushes AS pushes,
        f.repos AS repos,
        f.commits AS commits,
        f.prs AS prs,
        if(en.has_stats = 1, en.merged_prs, f.mergedPrs) AS mergedPrs
      FROM filtered AS f
      LEFT JOIN enriched AS en ON en.actor_login = f.actor
      ORDER BY
        (en.has_stats = 1) DESC,
        (f.prs > 0 OR en.has_stats = 1) DESC,
        (if(en.has_stats = 1, en.merged_prs, f.mergedPrs) + 1.0) / (f.prs + 1.0) DESC,
        f.repos DESC,
        f.commits DESC
      LIMIT {limit: UInt32}
    )
    SELECT
      r.actor AS actor,
      r.pushes AS pushes,
      r.repos AS repos,
      r.commits AS commits,
      r.prs AS prs,
      r.mergedPrs AS mergedPrs,
      m.bot_count AS bot_count,
      m.mega_pusher_count AS mega_pusher_count,
      m.kept_count AS kept_count
    FROM ranked AS r
    CROSS JOIN meta AS m
  `.trim();
}

export async function devScatter(window: DevScatterWindow, limit = 40): Promise<DevScatterResult> {
  const days = DEV_SCATTER_WINDOW_DAYS[window];
  const megaPushThreshold = MEGA_PUSHER_THRESHOLD[window];
  const mergedCol = window === "7d" ? "merged_prs_7d" : "merged_prs_30d";

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
