import { q } from "./core";
import type { QueryResult } from "./types";

const EVENT_VOLUME_TABLES = ["curated.event_volume_hourly"];
const EVENT_TIMELINE_TABLES = ["curated.event_timeline"];
const EVENT_VOLUME_BY_DAY_TABLES = ["curated.event_volume_daily"];
const STATS_TABLES = ["curated.event_volume_hourly"];
const SIGNAL_TABLES = ["curated.firehose_repo_signal_hourly"];
const EVENT_MIX_TABLES = ["curated.firehose_event_type_action_hourly"];

export interface EventVolumeRow {
  repo_name: string;
  event_type: string;
  event_count: string;
  actor_count: string;
}

export interface EventTimelineRow {
  created_at: string;
  repo_name: string;
  actor_login: string;
  actor_avatar: string;
  event_type: string;
  action: string;
  title: string | null;
  number: string;
  payload_summary: string;
}

export interface EventVolumeByDayRow {
  date: string;
  event_type: string;
  event_count: string;
  actor_count: string;
}

export interface FirehoseStatsRow {
  total_events: string;
  total_repos: string;
  total_actors: string;
  latest_event: string;
}

export interface FirehoseRepoSignalRow {
  repo_name: string;
  pushes: string;
  forks: string;
  stars: string;
  prs_opened: string;
  prs_closed: string;
  issues_opened: string;
  issues_closed: string;
  releases: string;
  branches_created: string;
  branches_deleted: string;
  events: string;
  actors: string;
}

export interface FirehoseEventMixRow {
  repo_name: string;
  event_type: string;
  action: string;
  event_count: string;
  actor_count: string;
}

const EMPTY_STATS: FirehoseStatsRow = {
  total_events: "0",
  total_repos: "0",
  total_actors: "0",
  latest_event: "",
};

async function safeQ<T>(
  sql: string,
  tables: string[],
  query_params?: Record<string, unknown>
): Promise<{ rows: T[]; sql: string; elapsedMs: number }> {
  try {
    const { rows, provenance } = await q<T>(sql, tables, query_params);
    return { rows, sql: provenance.sql, elapsedMs: provenance.elapsedMs };
  } catch {
    return { rows: [], sql: sql.trim(), elapsedMs: 0 };
  }
}

export async function eventVolumeFeed(): Promise<QueryResult<EventVolumeRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<EventVolumeRow>(
    `
    SELECT
      repo_name,
      event_type,
      toString(countMerge(events)) AS event_count,
      toString(uniqMerge(actors)) AS actor_count
    FROM curated.event_volume_hourly
    WHERE hour > now() - INTERVAL 24 HOUR
    GROUP BY repo_name, event_type
    ORDER BY toUInt64(event_count) DESC
    LIMIT 50
    `,
    EVENT_VOLUME_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function eventTimelineFeed(limit = 50): Promise<QueryResult<EventTimelineRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<EventTimelineRow>(
    `
    SELECT
      toString(created_at) AS created_at,
      repo_name,
      actor_login,
      actor_avatar,
      event_type,
      action,
      title,
      toString(number) AS number,
      payload_summary
    FROM curated.event_timeline
    ORDER BY created_at DESC
    LIMIT ${limit}
    `,
    EVENT_TIMELINE_TABLES
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function eventVolumeByDay(
  repoName: string,
  days = 30
): Promise<QueryResult<EventVolumeByDayRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<EventVolumeByDayRow>(
    `
    SELECT
      toString(day) AS date,
      event_type,
      toString(countMerge(events)) AS event_count,
      toString(uniqMerge(actors)) AS actor_count
    FROM curated.event_volume_daily
    WHERE repo_name = {repoName: String}
      AND day >= today() - ${days}
    GROUP BY day, event_type
    ORDER BY day ASC
    `,
    EVENT_VOLUME_BY_DAY_TABLES,
    { repoName }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function firehoseStats(): Promise<QueryResult<FirehoseStatsRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<FirehoseStatsRow>(
    `
    SELECT
      toString(sum(event_count)) AS total_events,
      toString(uniqExact(repo_name)) AS total_repos,
      toString(uniqExact(actor_count)) AS total_actors,
      toString(max(hour)) AS latest_event
    FROM (
      SELECT
        repo_name,
        toString(countMerge(events)) AS event_count,
        toString(uniqMerge(actors)) AS actor_count,
        hour
      FROM curated.event_volume_hourly
      WHERE hour > now() - INTERVAL 24 HOUR
      GROUP BY repo_name, hour
    )
    `,
    STATS_TABLES
  );
  return {
    data: rows.length > 0 ? rows : [EMPTY_STATS],
    sql,
    rowsRead: 0,
    elapsedMs,
  };
}

export async function firehoseRepoSignal(
  hours = 24,
  limit = 50
): Promise<QueryResult<FirehoseRepoSignalRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<FirehoseRepoSignalRow>(
    `
    SELECT
      repo_name,
      toString(sumSimpleState(pushes)) AS pushes,
      toString(sumSimpleState(forks)) AS forks,
      toString(sumSimpleState(stars)) AS stars,
      toString(sumSimpleState(prs_opened)) AS prs_opened,
      toString(sumSimpleState(prs_closed)) AS prs_closed,
      toString(sumSimpleState(issues_opened)) AS issues_opened,
      toString(sumSimpleState(issues_closed)) AS issues_closed,
      toString(sumSimpleState(releases)) AS releases,
      toString(sumSimpleState(branches_created)) AS branches_created,
      toString(sumSimpleState(branches_deleted)) AS branches_deleted,
      toString(countMerge(events)) AS events,
      toString(uniqMerge(actors)) AS actors
    FROM curated.firehose_repo_signal_hourly
    WHERE hour > now() - INTERVAL {hours: UInt32} HOUR
    GROUP BY repo_name
    ORDER BY toUInt64(events) DESC
    LIMIT {limit: UInt32}
    `,
    SIGNAL_TABLES,
    { hours, limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function firehoseEventMix(
  hours = 24,
  limit = 100
): Promise<QueryResult<FirehoseEventMixRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<FirehoseEventMixRow>(
    `
    SELECT
      repo_name,
      event_type,
      action,
      toString(countMerge(events)) AS event_count,
      toString(uniqMerge(actors)) AS actor_count
    FROM curated.firehose_event_type_action_hourly
    WHERE hour >= now() - INTERVAL {hours: UInt32} HOUR
    GROUP BY repo_name, event_type, action
    ORDER BY toUInt64(event_count) DESC, repo_name ASC, event_type ASC, action ASC
    LIMIT {limit: UInt32}
    `,
    EVENT_MIX_TABLES,
    { hours, limit }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}
