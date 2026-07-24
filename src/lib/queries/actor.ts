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
    WITH (SELECT max(created_at) FROM raw.github_events) AS high_water
    SELECT
      actor_login,
      toString(count()) AS events,
      toString(uniqExact(repo_name)) AS repos,
      toString(countIf(event_type = 'PushEvent')) AS pushes,
      toString(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
      toString(countIf(event_type = 'PullRequestEvent' AND pr_merged = 1)) AS prs_merged,
      toString(
        round(
          countIf(event_type = 'PullRequestEvent' AND pr_merged = 1) * 5 +
          countIf(event_type = 'PullRequestEvent' AND action = 'opened') * 3 +
          countIf(event_type = 'PushEvent') * 2 +
          count() * 1 +
          uniqExact(repo_name) * 2,
          1
        )
      ) AS score
    FROM raw.github_events
    WHERE created_at > high_water - INTERVAL 24 HOUR
      AND lower(actor_login) NOT LIKE '%[bot]%'
    GROUP BY actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `
      : `
    SELECT
      actor_login,
      toString(countMerge(events)) AS events,
      toString(uniqMerge(repos)) AS repos,
      toString(sum(pushes)) AS pushes,
      toString(sum(prs_opened)) AS prs_opened,
      toString(sum(prs_merged)) AS prs_merged,
      toString(
        round(
          sum(prs_merged) * 5 +
          sum(prs_opened) * 3 +
          sum(pushes) * 2 +
          countMerge(events) * 1 +
          uniqMerge(repos) * 2,
          1
        )
      ) AS score
    FROM gh_actor_daily
    WHERE day >= ${dailyWindow}
      AND lower(actor_login) NOT LIKE '%[bot]%'
    GROUP BY actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `;

  const botQuery =
    window === "24h"
      ? `
    WITH (SELECT max(created_at) FROM raw.github_events) AS high_water
    SELECT
      actor_login,
      toString(count()) AS events,
      toString(uniqExact(repo_name)) AS repos,
      toString(countIf(event_type = 'PushEvent')) AS pushes,
      toString(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
      toString(countIf(event_type = 'PullRequestEvent' AND pr_merged = 1)) AS prs_merged,
      toString(round(count(), 1)) AS score
    FROM raw.github_events
    WHERE created_at > high_water - INTERVAL 24 HOUR
      AND lower(actor_login) LIKE '%[bot]%'
    GROUP BY actor_login
    ORDER BY toFloat64(score) DESC
    LIMIT 10
  `
      : `
    SELECT
      actor_login,
      toString(countMerge(events)) AS events,
      toString(uniqMerge(repos)) AS repos,
      toString(sum(pushes)) AS pushes,
      toString(sum(prs_opened)) AS prs_opened,
      toString(sum(prs_merged)) AS prs_merged,
      toString(round(countMerge(events), 1)) AS score
    FROM gh_actor_daily
    WHERE day >= ${dailyWindow}
      AND lower(actor_login) LIKE '%[bot]%'
    GROUP BY actor_login
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
        actor_login AS actor,
        lower(actor_login) LIKE '%[bot]%' AS is_bot,
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
      if(en.has_stats = 1, en.merged_prs, p.mergedPrs) AS mergedPrs,
      m.bot_count AS bot_count,
      m.mega_pusher_count AS mega_pusher_count,
      m.kept_count AS kept_count
    FROM per_actor AS p
    CROSS JOIN meta AS m
    LEFT JOIN enriched AS en ON en.actor_login = p.actor
    WHERE NOT p.is_bot
      AND NOT (p.repos = 1 AND p.pushes >= {megaPushThreshold: UInt32})
    ORDER BY
      (en.has_stats = 1) DESC,
      (p.prs > 0 OR en.has_stats = 1) DESC,
      (if(en.has_stats = 1, en.merged_prs, p.mergedPrs) + 1.0) / (p.prs + 1.0) DESC,
      p.repos DESC,
      p.commits DESC
    LIMIT {limit: UInt32}
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
