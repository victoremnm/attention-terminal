import { q } from "./core";
import type { QueryResult } from "./types";

const TIMELAPSE_TABLES = ["curated.repo_timelapse"];
const STREAM_TABLES = ["default.github_events_stream"];

export interface TimelapseWindowRow {
  window_start: string;
  window_end: string;
  commentary: string;
  themes: string[];
  event_count: string;
  key_events: string[];
}

export interface TimelapseSummaryRow {
  total_windows: string;
  total_events: string;
  unique_contributors: string;
  earliest_window: string;
  latest_window: string;
}

export interface TimelapseEventRow {
  event_id: string;
  created_at: string;
  actor_login: string;
  actor_avatar: string;
  event_type: string;
  action: string;
  title: string | null;
  number: string;
  payload_summary: string;
}

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

export async function timelapseWindows(repoName: string): Promise<QueryResult<TimelapseWindowRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<TimelapseWindowRow>(
    `SELECT
       toString(window_start) AS window_start,
       toString(window_end)   AS window_end,
       commentary,
       themes,
       toString(event_count)  AS event_count,
       key_events
     FROM curated.repo_timelapse FINAL
     WHERE repo_name = {repo:String}
       AND window_start >= now() - INTERVAL 24 HOUR
     ORDER BY window_start DESC
     LIMIT 72`,
    TIMELAPSE_TABLES,
    { repo: repoName }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}

export async function timelapseSummary(repoName: string): Promise<QueryResult<TimelapseSummaryRow>> {
  const [windowResult, actorResult] = await Promise.all([
    safeQ<{ total_windows: string; total_events: string; earliest_window: string; latest_window: string }>(
      `SELECT
         toString(count())        AS total_windows,
         toString(sum(event_count)) AS total_events,
         min(window_start)        AS earliest_window,
         max(window_start)        AS latest_window
       FROM curated.repo_timelapse FINAL
       WHERE repo_name = {repo:String}
         AND window_start >= now() - INTERVAL 24 HOUR`,
      TIMELAPSE_TABLES,
      { repo: repoName }
    ),
    safeQ<{ cnt: string }>(
      `SELECT toString(uniqExact(actor_login)) AS cnt
       FROM default.github_events_stream
       WHERE repo_name = {repo:String}
         AND created_at >= now() - INTERVAL 24 HOUR`,
      STREAM_TABLES,
      { repo: repoName }
    ),
  ]);
  const w = windowResult.rows[0];
  const fallback: TimelapseSummaryRow = {
    total_windows: w?.total_windows ?? "0",
    total_events: w?.total_events ?? "0",
    unique_contributors: actorResult.rows[0]?.cnt ?? "0",
    earliest_window: w?.earliest_window ?? "",
    latest_window: w?.latest_window ?? "",
  };
  return { data: fallback, sql: windowResult.sql, rowsRead: 0, elapsedMs: windowResult.elapsedMs };
}

export async function timelapseWindowEvents(
  repoName: string,
  windowStart: string,
  windowEnd: string
): Promise<QueryResult<TimelapseEventRow[]>> {
  const { rows, sql, elapsedMs } = await safeQ<TimelapseEventRow>(
    `SELECT
       toString(event_id)    AS event_id,
       toString(created_at)  AS created_at,
       actor_login,
       actor_avatar          AS actor_avatar,
       event_type,
       action,
       title,
       toString(number)      AS number,
       payload               AS payload_summary
     FROM default.github_events_stream
     WHERE repo_name  = {repo:String}
       AND created_at >= {from:String}
       AND created_at <  {to:String}
     ORDER BY created_at DESC
     LIMIT 200`,
    STREAM_TABLES,
    { repo: repoName, from: windowStart, to: windowEnd }
  );
  return { data: rows, sql, rowsRead: 0, elapsedMs };
}
