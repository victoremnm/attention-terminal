// Server-side only: active contribution discovery rankings (Issue #138/#140).
// Support for ranking modes: top_forks, top_pushes (filtering zero-commit pushes via commits > 0),
// top_commits, pr_velocity (prs_opened + prs_merged), and active_builders (uniqExact(actor_login)).
import { q, toQueryResult, type QueryResult } from "./queries";

export type ActiveContributionWindow = "1d" | "7d" | "30d";

export type ActiveContributionSort =
  | "top_forks"
  | "top_pushes"
  | "top_commits"
  | "pr_velocity"
  | "active_builders"
  | "commits"
  | "pushes";

export const ACTIVE_CONTRIBUTION_WINDOW_DAYS: Record<ActiveContributionWindow, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
};

export const ACTIVE_CONTRIBUTION_SORT_SQL: Record<ActiveContributionSort, string> = {
  top_forks: "fork_total",
  top_pushes: "substantive_push_bucket_total",
  top_commits: "distinct_commit_total",
  pr_velocity: "(pr_opened_total + pr_merged_total)",
  active_builders: "builder_total",
  commits: "distinct_commit_total",
  pushes: "substantive_push_bucket_total",
};

export const ACTIVE_CONTRIBUTION_MAX_LIMIT = 100;

export interface ActiveContributionRow {
  repoName: string;
  commits: number;
  distinctCommits: number;
  pushes: number;
  substantivePushBuckets: number;
  pushers: number;
  humanPushers: number;
  botPushers: number;
  prsOpened: number;
  prsMerged: number;
  forks: number;
  prVelocity: number;
  activeBuilders: number;
  activityScore: number;
  branchScope: "unknown";
  dependencyUpdateAttribution: "unknown";
}

export interface ActiveContributionSqlRow {
  repo_name: string;
  commits: string;
  distinct_commits: string;
  pushes: string;
  substantive_push_buckets: string;
  pushers: string;
  human_pushers: string;
  bot_pushers: string;
  prs_opened: string;
  prs_merged: string;
  forks: string;
  pr_velocity: string;
  active_builders: string;
  activity_score: string;
  branch_scope: "unknown";
  dependency_update_attribution: "unknown";
}

export interface ActiveContributionResult extends QueryResult<ActiveContributionRow[]> {
  window: ActiveContributionWindow;
  sort: ActiveContributionSort;
  limit: number;
  notes: string[];
}

function activeContributionLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVE_CONTRIBUTION_MAX_LIMIT) {
    throw new RangeError(`active contribution limit must be an integer between 1 and ${ACTIVE_CONTRIBUTION_MAX_LIMIT}`);
  }
  return limit;
}

export async function activeContributionRanking(
  window: ActiveContributionWindow,
  sort: ActiveContributionSort = "top_commits",
  limit = 40
): Promise<ActiveContributionResult> {
  const days = ACTIVE_CONTRIBUTION_WINDOW_DAYS[window];
  if (!days) throw new RangeError(`unsupported active contribution window: ${window}`);
  if (!Object.prototype.hasOwnProperty.call(ACTIVE_CONTRIBUTION_SORT_SQL, sort)) {
    throw new RangeError(`unsupported active contribution sort: ${sort}`);
  }
  const boundedLimit = activeContributionLimit(limit);
  const sortSql = ACTIVE_CONTRIBUTION_SORT_SQL[sort];
  const eligibilitySql =
    sort === "top_pushes" || sort === "pushes"
      ? "substantive_push_bucket_total > 0"
      : sort === "top_forks"
        ? "fork_total > 0"
        : sort === "pr_velocity"
          ? "(pr_opened_total + pr_merged_total) > 0"
          : sort === "active_builders"
            ? "builder_total > 0"
            : "commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0";

  const forkJoinSql =
    sort === "top_forks"
      ? `LEFT JOIN (
          SELECT repo_name, sum(forks) AS fork_total
          FROM gh_repo_daily
          WHERE day >= today() - ${days}
          GROUP BY repo_name
        ) f ON f.repo_name = bucket.repo_name`
      : "";
  const forkSelectSql = sort === "top_forks" ? "coalesce(any(f.fork_total), toUInt64(0))" : "toUInt64(0)";
  const targetTables = sort === "top_forks" ? ["gh_repo_actor_hourly", "gh_repo_daily"] : ["gh_repo_actor_hourly"];

  const sql = `
    WITH (SELECT max(hour) FROM gh_repo_actor_hourly) AS high_water
    SELECT
      repo_name,
      toString(commit_total) AS commits,
      toString(distinct_commit_total) AS distinct_commits,
      toString(push_total) AS pushes,
      toString(substantive_push_bucket_total) AS substantive_push_buckets,
      toString(pusher_total) AS pushers,
      toString(human_pusher_total) AS human_pushers,
      toString(bot_pusher_total) AS bot_pushers,
      toString(pr_opened_total) AS prs_opened,
      toString(pr_merged_total) AS prs_merged,
      toString(fork_total) AS forks,
      toString(pr_opened_total + pr_merged_total) AS pr_velocity,
      toString(builder_total) AS active_builders,
      toString(
        (distinct_commit_total * 4)
        + (commit_total * 2)
        + (substantive_push_bucket_total * 3)
        + (pr_opened_total * 2)
        + (pr_merged_total * 5)
      ) AS activity_score,
      'unknown' AS branch_scope,
      'unknown' AS dependency_update_attribution
    FROM (
      SELECT
        bucket.repo_name AS repo_name,
        sum(bucket.commits) AS commit_total,
        sum(bucket.distinct_commits) AS distinct_commit_total,
        sum(bucket.pushes) AS push_total,
        sum(toUInt64(bucket.pushes > 0 AND bucket.commits > 0)) AS substantive_push_bucket_total,
        uniqExact(bucket.actor_login) AS builder_total,
        uniqExactIf(bucket.actor_login, bucket.pushes > 0) AS pusher_total,
        uniqExactIf(bucket.actor_login, bucket.pushes > 0 AND lower(bucket.actor_login) NOT LIKE '%[bot]%') AS human_pusher_total,
        uniqExactIf(bucket.actor_login, bucket.pushes > 0 AND lower(bucket.actor_login) LIKE '%[bot]%') AS bot_pusher_total,
        sum(bucket.prs_opened) AS pr_opened_total,
        sum(bucket.prs_merged) AS pr_merged_total,
        ${forkSelectSql} AS fork_total
      FROM (
        SELECT repo_name, actor_login, pushes, commits, distinct_commits, prs_opened, prs_merged
        FROM gh_repo_actor_hourly
        WHERE hour > high_water - INTERVAL ${days} DAY
      ) AS bucket
      ${forkJoinSql}
      GROUP BY repo_name
      -- Empty pushes and push-only PR noise do not qualify for push mode.
      HAVING ${eligibilitySql}
    )
    ORDER BY ${sortSql} DESC, activity_score DESC, repo_name ASC
    LIMIT {limit: UInt32}
  `.trim();

  const { rows, provenance } = await q<ActiveContributionSqlRow>(
    sql,
    targetTables,
    { limit: boundedLimit }
  );

  const data = rows.map((row) => ({
    repoName: row.repo_name,
    commits: Number(row.commits),
    distinctCommits: Number(row.distinct_commits),
    pushes: Number(row.pushes),
    substantivePushBuckets: Number(row.substantive_push_buckets),
    pushers: Number(row.pushers),
    humanPushers: Number(row.human_pushers),
    botPushers: Number(row.bot_pushers),
    prsOpened: Number(row.prs_opened),
    prsMerged: Number(row.prs_merged),
    forks: Number(row.forks ?? 0),
    prVelocity: Number(row.pr_velocity ?? 0),
    activeBuilders: Number(row.active_builders ?? 0),
    activityScore: Number(row.activity_score),
    branchScope: row.branch_scope,
    dependencyUpdateAttribution: row.dependency_update_attribution,
  }));

  return {
    ...toQueryResult(data, provenance),
    window,
    sort,
    limit: boundedLimit,
    notes: [
      sort === "top_pushes" || sort === "pushes"
        ? "Push ranking requires substantive_push_bucket_total > 0; raw push volume never makes a repo eligible."
        : sort === "top_forks"
          ? "Fork ranking orders by aggregated forks."
          : sort === "pr_velocity"
            ? "PR Velocity combines PRs opened and PRs merged."
            : sort === "active_builders"
              ? "Active builders ranks by unique contributor count (uniqExact(actor_login))."
              : "Commit ranking excludes rows with no commits and no PR activity.",
      "branchScope is unknown because gh_repo_actor_hourly does not retain push ref/default-branch fields; main-branch filtering is not claimed.",
      "The global ranking filters hour against ORDER BY (repo_name, hour, actor_login); this is bounded by time but hour-only filtering cannot use the rollup key prefix for full pruning.",
      "dependencyUpdateAttribution is unknown because the source rollup does not retain dependency-update attribution.",
    ],
  };
}
