import { q } from "./core";
import type { QueryResult } from "./types";

const TABLES = [
  "curated.event_volume_hourly",
  "curated.event_volume_daily",
  "curated.event_timeline",
  "default.github_events_firehose",
];

const STATS_TABLES = ["curated.event_volume_hourly"];

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
    TABLES
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
    WHERE curated.event_timeline.created_at >= now() - INTERVAL 7 DAY
    ORDER BY created_at DESC
    LIMIT ${limit}
    `,
    TABLES
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
    TABLES,
    { repoName }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function firehoseStats(): Promise<QueryResult<FirehoseStatsRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<FirehoseStatsRow>(
    `
    SELECT
      toString(countMerge(events)) AS total_events,
      toString(uniqExact(repo_name)) AS total_repos,
      toString(uniqMerge(actors)) AS total_actors,
      toString(max(hour)) AS latest_event
    FROM curated.event_volume_hourly
    WHERE hour > now() - INTERVAL 24 HOUR
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
