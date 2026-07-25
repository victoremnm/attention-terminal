import { q } from "./core";
import type { QueryResult } from "./types";

const TABLES = [
  "curated.event_volume_hourly",
  "curated.event_volume_daily",
  "curated.event_timeline",
  "raw.github_events_firehose",
];

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

export async function eventVolumeFeed(): Promise<QueryResult<EventVolumeRow[]>> {
  const { rows, provenance } = await q<EventVolumeRow>(
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
  return { data: rows, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}

export async function eventTimelineFeed(limit = 50): Promise<QueryResult<EventTimelineRow[]>> {
  const { rows, provenance } = await q<EventTimelineRow>(
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
    TABLES
  );
  return { data: rows, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}

export async function eventVolumeByDay(
  repoName: string,
  days = 30
): Promise<QueryResult<EventVolumeByDayRow[]>> {
  const { rows, provenance } = await q<EventVolumeByDayRow>(
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
  return { data: rows, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}

export async function firehoseStats(): Promise<QueryResult<FirehoseStatsRow[]>> {
  const { rows, provenance } = await q<FirehoseStatsRow>(
    `
    SELECT
      toString(count()) AS total_events,
      toString(uniqExact(repo_name)) AS total_repos,
      toString(uniqExact(actor_login)) AS total_actors,
      toString(max(created_at)) AS latest_event
    FROM raw.github_events_firehose
    WHERE created_at > now() - INTERVAL 24 HOUR
    `,
    TABLES
  );
  return { data: rows, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}
