import { q } from "./core";
import type { QueryResult } from "./types";

const TABLES = ["raw.hackernews"];

export interface HNStoryRow {
  id: string;
  title: string;
  score: string;
  descendants: string;
  by: string;
  time: string;
  url: string;
  velocity: string;
}

export async function hnStoryFeed(hours = 6, limit = 50): Promise<QueryResult<HNStoryRow[]>> {
  const { rows, provenance } = await q<HNStoryRow>(
    `SELECT
       toString(id) AS id,
       title,
       toString(score_num) AS score,
       toString(descendants) AS descendants,
       by,
       toString(ts) AS time,
       url,
       toString(round(toFloat64(score_num) / greatest((now_sec - ts) / 3600, 0.5), 1)) AS velocity
     FROM (
       SELECT id, title, toFloat64(score) AS score_num, descendants, by, url,
              toUnixTimestamp(time) AS ts, toUnixTimestamp(now()) AS now_sec
       FROM raw.hackernews FINAL
       WHERE type = 'story'
         AND time > now() - INTERVAL ${hours} HOUR
         AND score >= 5
         AND deleted = 0
         AND dead = 0
     )
     ORDER BY toFloat64(velocity) DESC
     LIMIT ${limit}`,
    TABLES
  );
  return { data: rows, sql: provenance.sql, rowsRead: provenance.rowsRead ?? 0, elapsedMs: provenance.elapsedMs };
}
