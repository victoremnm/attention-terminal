import type { DevPoint } from "../render-payload";
import { q, toQueryResult } from "./core";
import type { DevScatterResult, DevScatterWindow } from "./types";

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
      LEFT JOIN (
    SELECT actor_login, argMax(actor_type, fetched_at) AS actor_type
    FROM gh_actor_classification
    GROUP BY actor_login
  ) cls ON cls.actor_login = ad.actor_login
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
