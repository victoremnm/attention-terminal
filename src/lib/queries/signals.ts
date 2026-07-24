import { q } from "./core";
import type { DailySeries, Provenance } from "./types";

export async function divergence(subject: string): Promise<DailySeries & { talk: number[]; code: number[] }> {
  const { rows, provenance } = await q<{ day: string; talk: string; code: string }>(
    `SELECT day, sumIf(c, src = 'hn') AS talk, sumIf(c, src = 'gh') AS code
     FROM (
       SELECT toDate(time) AS day, count() AS c, 'hn' AS src
      FROM raw.hackernews FINAL
      WHERE type = 'story' AND hasToken(lower(title), '${subject}')
        AND time > now() - INTERVAL 30 DAY AND deleted = 0 AND dead = 0
      GROUP BY day
      UNION ALL
      SELECT toDate(created_at) AS day, count() AS c, 'gh' AS src
      FROM raw.github_events
      WHERE repo_name ILIKE '%${subject}%' AND created_at > now() - INTERVAL 30 DAY
      GROUP BY day
     )
     GROUP BY day ORDER BY day`,
    ["raw.hackernews", "raw.github_events"]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: string[] = [];
  const talk: number[] = [];
  const code: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(d);
    talk.push(Number(byDay.get(d)?.talk ?? 0));
    code.push(Number(byDay.get(d)?.code ?? 0));
  }
  return { days, talk, code, provenance };
}

export async function pulse(subject: string): Promise<DailySeries & { stories: number[]; points: number[] }> {
  const { rows, provenance } = await q<{ day: string; stories: string; points: string }>(
     `SELECT toDate(time) AS day, count() AS stories, sum(score) AS points
      FROM raw.hackernews FINAL
      WHERE type = 'story' AND hasToken(lower(title), '${subject}')
        AND time > now() - INTERVAL 30 DAY AND deleted = 0 AND dead = 0
      GROUP BY day ORDER BY day`,
    ["raw.hackernews"]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: string[] = [];
  const stories: number[] = [];
  const points: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(d);
    stories.push(Number(byDay.get(d)?.stories ?? 0));
    points.push(Number(byDay.get(d)?.points ?? 0));
  }
  return { days, stories, points, provenance };
}

export async function freshness(): Promise<{ hn_lag_s: number; gh_chunk: string }> {
  const { rows } = await q<{ hn_lag_s: number; gh_chunk: string }>(
      `SELECT
        (SELECT toUInt32(now() - max(time)) FROM raw.hackernews) AS hn_lag_s,
        (SELECT max(chunk_key) FROM ingest_log WHERE source = 'gharchive') AS gh_chunk`,
    ["raw.hackernews", "ingest_log"]
  );
  return rows[0] ?? { hn_lag_s: -1, gh_chunk: "unknown" };
}
