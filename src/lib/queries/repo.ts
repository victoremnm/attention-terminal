import { clickhouse, clickhouseInsert, missingTables } from "../clickhouse";
import { fetchCodeFrequency, fetchRepoRow, type CodeFrequencyRow } from "../github-repo";
import { analyzeAndStoreRepo } from "../repo-analysis";
import type { RepoDrilldownPayload } from "../render-payload";
import {
  normalizeRepoActivityOptions,
  type RepoActivityOptions,
  type RepoActivitySort,
  type RepoWindow,
} from "../repo-activity-query";
import { q, toQueryResult } from "./core";
import type {
  Provenance,
  RepoActivityResult,
  RepoWindowRow,
} from "./types";

interface RepoDrilldownMetadataSqlRow {
  description: string;
  language: string;
  topics: string[];
  github_stars: string;
  github_forks: string;
  open_issues: string;
}

interface RepoDrilldownHourlySqlRow {
  is_total: number | string;
  hour: string;
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

interface RepoDrilldownCommitSqlRow {
  sha: string;
  author: string;
  author_date: string;
  message: string;
  is_recent: number | string;
  is_top_committer: number | string;
  commit_count: string;
  commit_authors: string;
  author_commits: string;
}

interface RepoDrilldownActorSqlRow {
  actor: string;
  pushes: string;
  commits: string;
  distinct_commits: string;
  prs_opened: string;
  prs_merged: string;
  issues_opened: string;
  releases_count: string;
  is_bot: number | string;
}

interface RepoDrilldownFeedSqlRow {
  at: string;
  actor: string;
  event_type: string;
  action: string;
  commits: string;
  distinct_commits: string;
  merged: number | string;
  title?: string;
  labels?: string[];
}

interface RepoDrilldownAnalysisSqlRow {
  overview: string;
  tech_stack: string[];
  key_files: string[];
  architecture_summary: string;
  analyzed_at: string;
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

interface RepoDrilldownTrendSqlRow {
  date: string;
  stars: string;
  forks: string;
  event_type: string;
  event_label: string;
  event_url: string;
  release_tag: string;
  release_name: string;
  release_author: string;
  release_published_at: string;
  release_body: string;
  release_in_activity: number | string;
}

interface RepoDrilldownPulseCountSqlRow {
  prs_merged: string;
  prs_opened: string;
  prs_open: string;
  issues_closed: string;
  issues_opened: string;
  issues_open: string;
}

interface RepoDrilldownHighWaterSqlRow {
  high_water: string;
}

interface QueryRequest {
  tablesReady: Promise<void>;
}

function repoQuerySql(...parts: Provenance[]) {
  return parts
    .map((part, index) => `-- repo drill-down query ${index + 1}\n${part.sql}`)
    .join("\n\n");
}

async function repoSeenInGithubEvents(repoName: string): Promise<boolean> {
  const rs = await clickhouse.query({
    query: `SELECT 1 AS present FROM raw.github_events WHERE repo_name = {repoName: String} LIMIT 1`,
    format: "JSONEachRow",
    query_params: { repoName },
  });
  const rows = await rs.json<{ present: number }>();
  return rows.length > 0;
}

const REPO_DRILLDOWN_TABLES = [
  "gh_repo_metadata",
  "raw.github_events",
  "gh_repo_drilldown_hourly",
  "gh_repo_actor_hourly",
  "gh_repo_activity_feed",
  "gh_repo_actor_activity_feed",
  "gh_repo_analysis",
  "gh_repo_commits",
  "gh_repo_prs",
  "gh_repo_releases",
  "gh_repo_issues",
  "gh_repo_daily",
] as const;

async function hasSeededAggregates(missing: ReadonlySet<string>): Promise<boolean> {
  if (
    missing.has("gh_repo_drilldown_hourly") ||
    missing.has("gh_repo_actor_hourly") ||
    missing.has("gh_repo_activity_feed")
  ) {
    return false;
  }
  try {
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

function requestReadiness(missing: ReadonlySet<string>, tables: string[]): QueryRequest {
  const missingRequired = tables.filter((table) => missing.has(table));
  return {
    tablesReady:
      missingRequired.length === 0
        ? Promise.resolve()
        : Promise.reject(
            new Error(
              `Missing ClickHouse table(s): ${missingRequired.join(", ")}. Run the migration or update the query to a known table.`
            )
          ),
  };
}

function isTotalHourlyRow(row: RepoDrilldownHourlySqlRow) {
  return Number(row.is_total) === 1;
}

function isFlagged(value: number | string) {
  return Number(value) === 1;
}

function sortNewestFirst<T extends { author_date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => (a.author_date < b.author_date ? 1 : a.author_date > b.author_date ? -1 : 0));
}

function releaseActivityRows(rows: RepoDrilldownTrendSqlRow[]) {
  return rows
    .filter((row) => isFlagged(row.release_in_activity))
    .sort((a, b) =>
      a.release_published_at < b.release_published_at
        ? 1
        : a.release_published_at > b.release_published_at
          ? -1
          : 0
    );
}

function requiredRepoDrilldownTables(
  useAggregates: boolean,
  canQueryAnalysis: boolean,
  canQueryActorFeed: boolean
) {
  return [
    "gh_repo_metadata",
    "gh_repo_commits",
    "gh_repo_prs",
    "gh_repo_releases",
    "gh_repo_issues",
    "gh_repo_daily",
    "raw.github_events",
    ...(useAggregates ? ["gh_repo_drilldown_hourly", "gh_repo_actor_hourly"] : []),
    ...(useAggregates && canQueryActorFeed ? ["gh_repo_actor_activity_feed"] : []),
    ...(canQueryAnalysis ? ["gh_repo_analysis"] : []),
  ];
}

function repoHighWaterSql(useAggregates: boolean) {
  return useAggregates
    ? `SELECT toString(max(hour)) AS high_water FROM gh_repo_drilldown_hourly`
    : `SELECT toString(max(created_at)) AS high_water FROM raw.github_events`;
}

function repoHighWaterTable(useAggregates: boolean) {
  return useAggregates ? "gh_repo_drilldown_hourly" : "raw.github_events";
}

function highWaterValue(result: { rows: RepoDrilldownHighWaterSqlRow[] }) {
  return result.rows[0]?.high_water ?? "1970-01-01 00:00:00";
}

function commitRowsForActivity(rows: RepoDrilldownCommitSqlRow[]) {
  return sortNewestFirst(rows.filter((row) => isFlagged(row.is_recent)));
}

function topCommitterRows(rows: RepoDrilldownCommitSqlRow[]) {
  return rows
    .filter((row) => isFlagged(row.is_top_committer))
    .sort((a, b) => {
      const countDiff = Number(b.author_commits) - Number(a.author_commits);
      return countDiff || a.author.localeCompare(b.author);
    });
}

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
  const missing = new Set(await missingTables([...REPO_DRILLDOWN_TABLES]));
  const useAggregates = await hasSeededAggregates(missing);
  const canQueryAnalysis = !missing.has("gh_repo_analysis");
  const canQueryActorFeed = !missing.has("gh_repo_actor_activity_feed");
  const request = requestReadiness(
    missing,
    requiredRepoDrilldownTables(useAggregates, canQueryAnalysis, canQueryActorFeed)
  );

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
    queryParams,
    request
  );

  const highWaterQuery = q<RepoDrilldownHighWaterSqlRow>(
    repoHighWaterSql(useAggregates),
    [repoHighWaterTable(useAggregates)],
    undefined,
    request
  );
  const highWater = highWaterQuery.then(highWaterValue);

  const kpiVelocityQuery = highWater.then((anchor) =>
    q<RepoDrilldownHourlySqlRow>(
      useAggregates
        ? `SELECT
             toUInt8(grouping(bucket_hour)) AS is_total,
             toString(bucket_hour) AS hour,
             toString(sum(pushes)) AS pushes,
             toString(sum(commits)) AS commits,
             toString(sum(distinct_commits)) AS distinct_commits,
             toString(sum(forks)) AS forks,
             toString(sum(stars)) AS stars,
             toString(sum(issues_opened)) AS issues_opened,
             toString(sum(prs_opened)) AS prs_opened,
             toString(sum(prs_merged)) AS prs_merged,
             toString(uniqMerge(actors)) AS actors
           FROM (
             SELECT
               hour AS bucket_hour,
               pushes,
               commits,
               distinct_commits,
               forks,
               stars,
               issues_opened,
               prs_opened,
               prs_merged,
               actors
             FROM gh_repo_drilldown_hourly
             WHERE repo_name = {repoName: String}
               AND hour > {highWater: DateTime} - INTERVAL 24 HOUR
           )
           GROUP BY bucket_hour WITH ROLLUP
           ORDER BY is_total, hour`
        : `SELECT
             toUInt8(grouping(bucket_hour)) AS is_total,
             toString(bucket_hour) AS hour,
             toString(countIf(event_type = 'PushEvent')) AS pushes,
             toString(sum(commit_count)) AS commits,
             toString(sum(distinct_commit_count)) AS distinct_commits,
             toString(countIf(event_type = 'ForkEvent')) AS forks,
             toString(countIf(event_type = 'WatchEvent')) AS stars,
             toString(countIf(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
             toString(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
             toString(countIf(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
             toString(uniqExact(actor_login)) AS actors
           FROM (
             SELECT
               toStartOfHour(created_at) AS bucket_hour,
               event_type,
               action,
               commit_count,
               distinct_commit_count,
               pr_merged,
               actor_login
             FROM raw.github_events
             WHERE repo_name = {repoName: String}
               AND created_at > {highWater: DateTime} - INTERVAL 24 HOUR
               AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
           )
           GROUP BY bucket_hour WITH ROLLUP
           ORDER BY is_total, hour`,
        [useAggregates ? "gh_repo_drilldown_hourly" : "raw.github_events"],
      { ...queryParams, highWater: anchor },
      request
    )
  );

  const actorsQuery = useAggregates
    ? highWater.then((anchor) => q<RepoDrilldownActorSqlRow>(
        `WITH actor_totals AS (
           SELECT
             actor_login AS actor,
             sum(pushes) AS push_total,
             sum(commits) AS commit_total,
             sum(distinct_commits) AS distinct_commit_total,
             sum(prs_opened) AS pr_opened_total,
             sum(prs_merged) AS pr_merged_total,
             sum(issues_opened) AS issues_opened_total
           FROM gh_repo_actor_hourly
           WHERE repo_name = {repoName: String}
             AND hour > {highWater: DateTime} - INTERVAL 24 HOUR
           GROUP BY actor_login
         ),
         release_totals AS (
           SELECT author AS actor, count() AS releases_total
           FROM gh_repo_releases FINAL
           WHERE repo_name = {repoName: String}
             AND published_at > {highWater: DateTime} - INTERVAL 24 HOUR
           GROUP BY author
         )
         SELECT
           actor,
           toString(push_total) AS pushes,
           toString(commit_total) AS commits,
           toString(distinct_commit_total) AS distinct_commits,
           toString(pr_opened_total) AS prs_opened,
           toString(pr_merged_total) AS prs_merged,
           toString(issues_opened_total) AS issues_opened,
           toString(releases_total) AS releases_count,
           actor ILIKE '%[bot]%' AS is_bot
         FROM (
           SELECT
             coalesce(at.actor, rt.actor) AS actor,
             coalesce(at.push_total, 0) AS push_total,
             coalesce(at.commit_total, 0) AS commit_total,
             coalesce(at.distinct_commit_total, 0) AS distinct_commit_total,
             coalesce(at.pr_opened_total, 0) AS pr_opened_total,
             coalesce(at.pr_merged_total, 0) AS pr_merged_total,
             coalesce(at.issues_opened_total, 0) AS issues_opened_total,
             coalesce(rt.releases_total, 0) AS releases_total,
             (coalesce(at.commit_total, 0) * 3) + (coalesce(at.distinct_commit_total, 0) * 2)
               + (coalesce(at.pr_opened_total, 0) * 3) + (coalesce(at.pr_merged_total, 0) * 5)
               + least(coalesce(at.push_total, 0), coalesce(at.commit_total, 0))
               + (coalesce(rt.releases_total, 0) * 4) AS activity_score
           FROM actor_totals AS at
           FULL OUTER JOIN release_totals AS rt ON at.actor = rt.actor
         )
         WHERE commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0 OR issues_opened_total > 0 OR releases_total > 0
         ORDER BY activity_score DESC, actor
         LIMIT 8`,
        ["gh_repo_actor_hourly", "gh_repo_releases"],
        { ...queryParams, highWater: anchor },
        request
      ))
    : highWater.then((anchor) => q<RepoDrilldownActorSqlRow>(
        `WITH actor_totals AS (
           SELECT
             actor_login AS actor,
             countIf(event_type = 'PushEvent') AS push_total,
             sum(commit_count) AS commit_total,
             sum(distinct_commit_count) AS distinct_commit_total,
             countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS pr_opened_total,
             countIf(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1) AS pr_merged_total,
             countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issues_opened_total
           FROM raw.github_events
           WHERE repo_name = {repoName: String}
             AND created_at > {highWater: DateTime} - INTERVAL 24 HOUR
             AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')
           GROUP BY actor_login
         ),
         release_totals AS (
           SELECT author AS actor, count() AS releases_total
           FROM gh_repo_releases FINAL
           WHERE repo_name = {repoName: String}
             AND published_at > {highWater: DateTime} - INTERVAL 24 HOUR
           GROUP BY author
         )
         SELECT
           actor,
           toString(push_total) AS pushes,
           toString(commit_total) AS commits,
           toString(distinct_commit_total) AS distinct_commits,
           toString(pr_opened_total) AS prs_opened,
           toString(pr_merged_total) AS prs_merged,
           toString(issues_opened_total) AS issues_opened,
           toString(releases_total) AS releases_count,
           actor ILIKE '%[bot]%' AS is_bot
         FROM (
           SELECT
             coalesce(at.actor, rt.actor) AS actor,
             coalesce(at.push_total, 0) AS push_total,
             coalesce(at.commit_total, 0) AS commit_total,
             coalesce(at.distinct_commit_total, 0) AS distinct_commit_total,
             coalesce(at.pr_opened_total, 0) AS pr_opened_total,
             coalesce(at.pr_merged_total, 0) AS pr_merged_total,
             coalesce(at.issues_opened_total, 0) AS issues_opened_total,
             coalesce(rt.releases_total, 0) AS releases_total,
             (coalesce(at.commit_total, 0) * 3) + (coalesce(at.distinct_commit_total, 0) * 2)
               + (coalesce(at.pr_opened_total, 0) * 3) + (coalesce(at.pr_merged_total, 0) * 5)
               + least(coalesce(at.push_total, 0), coalesce(at.commit_total, 0))
               + (coalesce(rt.releases_total, 0) * 4) AS activity_score
           FROM actor_totals AS at
           FULL OUTER JOIN release_totals AS rt ON at.actor = rt.actor
         )
         WHERE commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0 OR issues_opened_total > 0 OR releases_total > 0
         ORDER BY activity_score DESC, actor
         LIMIT 8`,
        ["raw.github_events", "gh_repo_releases"],
        { ...queryParams, highWater: anchor },
        request
      ));

  const feedQuery = highWater.then((anchor) =>
    useAggregates && canQueryActorFeed
      ? q<RepoDrilldownFeedSqlRow>(
          `SELECT
             toString(created_at) AS at,
             actor_login AS actor,
             event_type,
             action,
             toString(commits) AS commits,
             toString(distinct_commits) AS distinct_commits,
             pr_merged AS merged,
             title,
             labels
           FROM gh_repo_actor_activity_feed FINAL
           WHERE repo_name = {repoName: String}
             AND created_at > {highWater: DateTime} - INTERVAL 24 HOUR
           ORDER BY created_at DESC
           LIMIT 12`,
          ["gh_repo_actor_activity_feed"],
          { ...queryParams, highWater: anchor },
          request
        )
      : useAggregates && !missing.has("gh_repo_activity_feed")
        ? q<RepoDrilldownFeedSqlRow>(
            `SELECT
               toString(created_at) AS at,
               actor_login AS actor,
               event_type,
               action,
               toString(commits) AS commits,
               toString(distinct_commits) AS distinct_commits,
               pr_merged AS merged,
               title,
               labels
             FROM gh_repo_activity_feed
             WHERE repo_name = {repoName: String}
               AND created_at > {highWater: DateTime} - INTERVAL 24 HOUR
             ORDER BY created_at DESC
             LIMIT 12`,
            ["gh_repo_activity_feed"],
            { ...queryParams, highWater: anchor },
            request
          )
        : q<RepoDrilldownFeedSqlRow>(
            `SELECT
               toString(created_at) AS at,
               actor_login AS actor,
               event_type,
               action,
               toString(commit_count) AS commits,
               toString(distinct_commit_count) AS distinct_commits,
               pr_merged AS merged,
               title,
               labels
             FROM raw.github_events
             WHERE repo_name = {repoName: String}
               AND created_at > {highWater: DateTime} - INTERVAL 24 HOUR
               AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')
             ORDER BY created_at DESC
             LIMIT 12`,
            ["raw.github_events"],
            { ...queryParams, highWater: anchor },
            request
          )
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
        queryParams,
        request
      )
    : Promise.resolve({
        rows: [] as RepoDrilldownAnalysisSqlRow[],
        provenance: { sql: "-- gh_repo_analysis unmigrated", elapsedMs: 0, rowsRead: 0, tables: [] },
      });

  const commitsQuery = q<RepoDrilldownCommitSqlRow>(
    `SELECT
       sha,
       author,
       toString(author_date) AS author_date,
       message,
       toUInt8(recent_rank <= 10) AS is_recent,
       toUInt8(author_rank = 1 AND committer_rank <= 8) AS is_top_committer,
       toString(commit_count) AS commit_count,
       toString(commit_authors) AS commit_authors,
       toString(author_commits) AS author_commits
     FROM (
       SELECT
         *,
         row_number() OVER (ORDER BY author_date DESC) AS recent_rank,
         row_number() OVER (PARTITION BY author ORDER BY author_date DESC) AS author_rank,
         dense_rank() OVER (ORDER BY author_commits DESC, author ASC) AS committer_rank
       FROM (
         SELECT
           sha,
           author,
           author_date,
           message,
           count() OVER () AS commit_count,
           uniqExact(author) OVER () AS commit_authors,
           count() OVER (PARTITION BY author) AS author_commits
         FROM gh_repo_commits FINAL
         WHERE repo_name = {repoName: String} AND author_date >= now() - INTERVAL 7 DAY
       )
     )
     WHERE recent_rank <= 10 OR (author_rank = 1 AND committer_rank <= 8)`,
    ["gh_repo_commits"],
    queryParams,
    request
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
    queryParams,
    request
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
    queryParams,
    request
  );

  const trendsQuery = q<RepoDrilldownTrendSqlRow>(
    `SELECT
       toString(day) AS date,
       toString(stars) AS stars,
       toString(forks) AS forks,
       event_type,
       event_label,
       event_url,
       release_tag,
       release_name,
       release_author,
       release_published_at,
       release_body,
       release_in_activity
     FROM (
       SELECT
         toDate(day) AS day,
         toUInt64(sum(stars)) AS stars,
         toUInt64(sum(forks)) AS forks,
         '' AS event_type,
         '' AS event_label,
         '' AS event_url,
         '' AS release_tag,
         '' AS release_name,
         '' AS release_author,
         '' AS release_published_at,
         '' AS release_body,
         toUInt8(0) AS release_in_activity
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
         concat('https://github.com/', {repoName: String}, '/releases/tag/', tag) AS event_url,
         tag AS release_tag,
         if(in_activity_window AND activity_rank <= 10, name, '') AS release_name,
         if(in_activity_window AND activity_rank <= 10, author, '') AS release_author,
         toString(published_at) AS release_published_at,
         if(in_activity_window AND activity_rank <= 10, body, '') AS release_body,
         toUInt8(in_activity_window AND activity_rank <= 10) AS release_in_activity
       FROM (
         SELECT
           tag,
           name,
           author,
           published_at,
           body,
           published_at >= now() - INTERVAL 7 DAY AS in_activity_window,
           row_number() OVER (
             PARTITION BY published_at >= now() - INTERVAL 7 DAY
             ORDER BY published_at DESC
           ) AS activity_rank
         FROM gh_repo_releases FINAL
         WHERE repo_name = {repoName: String} AND published_at >= today() - 30
       )
       UNION ALL
       SELECT
         toDate(merged_at) AS day,
         toUInt64(0) AS stars,
         toUInt64(0) AS forks,
         'pr_merged' AS event_type,
         concat('#', toString(number), ' ', title) AS event_label,
         concat('https://github.com/', {repoName: String}, '/pull/', toString(number)) AS event_url,
         '' AS release_tag,
         '' AS release_name,
         '' AS release_author,
         '' AS release_published_at,
         '' AS release_body,
         toUInt8(0) AS release_in_activity
       FROM gh_repo_prs FINAL
       WHERE repo_name = {repoName: String} AND merged_at >= today() - 30
       UNION ALL
       SELECT
         toDate(created_at) AS day,
         toUInt64(0) AS stars,
         toUInt64(0) AS forks,
         'issue_opened' AS event_type,
         concat('#', toString(number), ' ', title) AS event_label,
         concat('https://github.com/', {repoName: String}, '/issues/', toString(number)) AS event_url,
         '' AS release_tag,
         '' AS release_name,
         '' AS release_author,
         '' AS release_published_at,
         '' AS release_body,
         toUInt8(0) AS release_in_activity
       FROM gh_repo_issues FINAL
       WHERE repo_name = {repoName: String} AND created_at >= today() - 30
     )
     ORDER BY date ASC`,
    ["gh_repo_daily", "gh_repo_releases", "gh_repo_prs", "gh_repo_issues"],
    queryParams,
    request
  );

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
    queryParams,
    request
  );

  const [metadata, highWaterR, hourlyR, actors, feed, analysisResult, commitsR, prsR, issuesR, trendsR, pulseCountsR] = await Promise.all([
    metadataQuery,
    highWaterQuery,
    kpiVelocityQuery,
    actorsQuery,
    feedQuery,
    analysisQuery,
    commitsQuery,
    prsQuery,
    issuesQuery,
    trendsQuery,
    pulseCountsQuery,
  ]);

  let meta = metadata.rows[0];
  let analysisRow = analysisResult.rows[0];
  const totals = hourlyR.rows.find(isTotalHourlyRow);
  const velocityRows = hourlyR.rows.filter((row) => !isTotalHourlyRow(row));
  const commitActivityRows = commitRowsForActivity(commitsR.rows);
  const topCommitterActivityRows = topCommitterRows(commitsR.rows);
  const releaseRows = releaseActivityRows(trendsR.rows);
  const provenances = [
    metadata.provenance,
    highWaterR.provenance,
    hourlyR.provenance,
    actors.provenance,
    feed.provenance,
    analysisResult.provenance,
    commitsR.provenance,
    prsR.provenance,
    issuesR.provenance,
    trendsR.provenance,
    pulseCountsR.provenance,
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

  let codeFrequency: CodeFrequencyRow[] = [];
  try {
    codeFrequency = await fetchCodeFrequency(repoName, { fast: true });
  } catch (codeFreqError) {
    console.error("[repoDrilldown] code frequency fetch failed", { repoName, error: codeFreqError });
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
    velocity: velocityRows.map((row) => ({
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
      issuesOpened: Number(row.issues_opened),
      releasesPublished: Number(row.releases_count),
      isBot: Number(row.is_bot) === 1,
    })),
    feed: feed.rows.map((row) => ({
      at: row.at,
      actor: row.actor,
      eventType: (row.event_type as "PushEvent" | "PullRequestEvent" | "IssuesEvent"),
      action: row.action || (row.event_type === "PushEvent" ? "pushed" : "updated"),
      commits: Number(row.commits),
      distinctCommits: Number(row.distinct_commits),
      merged: Number(row.merged) === 1,
      ...(row.title ? { title: row.title } : {}),
      ...(row.labels ? { labels: row.labels } : {}),
    })),
    analysis: analysisPayload,
    activity:
      commitActivityRows.length || prsR.rows.length || releaseRows.length || issuesR.rows.length
        ? {
            commits: commitActivityRows.map((row) => ({
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
            releases: releaseRows.map((row) => ({
              tag: row.release_tag,
              name: row.release_name,
              author: row.release_author,
              publishedAt: row.release_published_at,
              body: row.release_body,
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
    trends: trendsR.rows.length
      ? buildTrends(trendsR.rows)
      : undefined,
    pulse: (pulseCountsR.rows.length || commitsR.rows.length)
      ? (() => {
          const pc = pulseCountsR.rows[0];
          const cs = commitsR.rows[0];
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
            topCommitters: topCommitterActivityRows.map((row) => ({
              author: row.author,
              commits: Number(row.author_commits),
            })),
          };
        })()
      : undefined,
    codeFrequency: codeFrequency.length > 0 ? codeFrequency : undefined,
    query: {
      sql: repoQuerySql(...provenances),
      rowsRead: provenances.reduce((sum, provenance) => sum + (provenance.rowsRead ?? 0), 0),
      elapsedMs: provenances.reduce((sum, provenance) => sum + provenance.elapsedMs, 0),
    },
  };
}

const REPO_WINDOW_DAYS: Record<RepoWindow, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  td: 36_500,
};

function repoWindowClause(window: RepoWindow) {
  return `day >= today() - ${REPO_WINDOW_DAYS[window]}`;
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
  spark: string[];
}

const REPO_ACTIVITY_SORT_SQL: Record<RepoActivitySort, string> = {
  events: "events",
  actors: "actors",
  pushes: "pushes",
  commits: "commits",
  stars: "stars",
  forks: "forks",
  prsOpened: "prs_opened",
  prsMerged: "prs_merged",
};

export async function repoActivityWindow(
  window: RepoWindow,
  input: RepoActivityOptions | number = {}
): Promise<RepoActivityResult> {
  const options = normalizeRepoActivityOptions(input);
  const sortSql = REPO_ACTIVITY_SORT_SQL[options.sort];
  const sql = `
    WITH latest_metadata AS (
      SELECT
        repo_name,
        argMax(owner, fetched_at) AS owner,
        argMax(description, fetched_at) AS description,
        argMax(language, fetched_at) AS language,
        argMax(topics, fetched_at) AS topics,
        argMax(github_stars, fetched_at) AS github_stars
      FROM gh_repo_metadata
      GROUP BY repo_name
    ),
    filtered_metadata AS (
      SELECT
        repo_name,
        owner,
        description,
        language,
        topics,
        github_stars
      FROM latest_metadata
      WHERE {search: String} = ''
         OR positionCaseInsensitiveUTF8(
              concat(repo_name, ' ', owner, ' ', description, ' ', language, ' ', arrayStringConcat(topics, ' ')),
              {search: String}
            ) > 0
    ),
    daily AS (
      SELECT
        d.repo_name AS repo_name,
        d.day AS day,
        countMerge(d.events) AS day_events,
        uniqMergeState(d.actors) AS actors_state,
        sum(d.pushes) AS day_pushes,
        sum(d.commits) AS day_commits,
        sum(d.stars) AS day_stars,
        sum(d.forks) AS day_forks,
        sum(d.prs_opened) AS day_prs_opened,
        sum(d.prs_merged) AS day_prs_merged
      FROM gh_repo_daily AS d
      WHERE ${repoWindowClause(window)}
      GROUP BY d.repo_name, d.day
    )
    SELECT
      d.repo_name,
      any(m.owner) AS owner,
      any(m.description) AS description,
      any(m.language) AS language,
      any(m.topics) AS topics,
      any(m.github_stars) AS github_stars,
      sum(d.day_events) AS events,
      uniqMerge(d.actors_state) AS actors,
      sum(d.day_pushes) AS pushes,
      sum(d.day_commits) AS commits,
      sum(d.day_stars) AS stars,
      sum(d.day_forks) AS forks,
      sum(d.day_prs_opened) AS prs_opened,
      sum(d.day_prs_merged) AS prs_merged,
      arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((d.day, d.day_events)))) AS spark
    FROM daily AS d
    ANY LEFT JOIN filtered_metadata AS m ON m.repo_name = d.repo_name
    WHERE {search: String} = '' OR m.repo_name != ''
    GROUP BY d.repo_name
    ORDER BY ${sortSql} ${options.direction}, repo_name ASC
    LIMIT {limit: UInt32} OFFSET {offset: UInt32}
  `.trim();

  const { rows, provenance } = await q<RepoWindowSqlRow>(sql, ["gh_repo_daily", "gh_repo_metadata"], {
    limit: options.limit,
    offset: options.offset,
    search: options.search,
  });

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

  return {
    ...toQueryResult(data, provenance),
    proof: {
      queryId: "repo_activity_window",
      params: options,
      sourceTables: ["gh_repo_daily", "gh_repo_metadata"],
    },
  };
}

export const repoActivityL1d = (limit?: number) => repoActivityWindow("1d", limit);
export const repoActivityL7d = (limit?: number) => repoActivityWindow("7d", limit);
export const repoActivityL30d = (limit?: number) => repoActivityWindow("30d", limit);
export const repoActivityLtd = (limit?: number) => repoActivityWindow("td", limit);
