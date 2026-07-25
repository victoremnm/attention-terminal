import { q } from "./core";
import type { QueryResult } from "./types";

const TABLES = ["default.hackernews"];

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

export interface HNReplyRow {
  story_id: string;
  id: string;
  by: string;
  time: string;
  text: string;
  score: string;
}

export interface HNStreamResult {
  stories: QueryResult<HNStoryRow[]>;
  replies: HNReplyRow[];
}

export async function hnStoryFeed(hours = 6, limit = 50): Promise<QueryResult<HNStoryRow[]>> {
  const { rows, provenance } = await q<HNStoryRow>(
    `SELECT
       toString(id) AS id,
       title,
       toString(score_raw) AS score,
       toString(descendants) AS descendants,
       by,
       toString(ts) AS time,
       url,
       toString(round(toFloat64(score_raw) / greatest((now_sec - ts) / 3600, 0.5), 1)) AS velocity
     FROM (
       SELECT id, title, toFloat64(score) AS score_raw, descendants, by, url,
              toUnixTimestamp(time) AS ts, toUnixTimestamp(now()) AS now_sec
       FROM default.hackernews FINAL
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

export async function hnStoryReplies(storyIds: string[]): Promise<HNReplyRow[]> {
  if (storyIds.length === 0) return [];
  const { rows } = await q<HNReplyRow>(
    `SELECT
       toString(parent) AS story_id,
       toString(id) AS id,
       by,
       toString(ts) AS time,
       text,
       toString(score_raw) AS score
     FROM (
       SELECT parent, id, by, score, text,
              toUnixTimestamp(time) AS ts,
              toFloat64(score) AS score_raw
       FROM default.hackernews FINAL
       WHERE parent IN (${storyIds.join(",")})
         AND type = 'comment'
         AND deleted = 0
         AND dead = 0
       ORDER BY time DESC
       LIMIT 5 BY parent
     )
     ORDER BY ts DESC`,
    TABLES
  );
  return rows;
}

export async function hnStoryStream(hours = 6, limit = 50): Promise<HNStreamResult> {
  const stories = await hnStoryFeed(hours, limit);
  const ids = stories.data.map((s) => s.id);
  const replies = await hnStoryReplies(ids);
  return { stories, replies };
}
