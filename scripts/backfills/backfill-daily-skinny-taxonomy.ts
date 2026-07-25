import { clickhouse } from "../../src/lib/clickhouse";

async function runBackfill() {
  const daysArg = process.argv[2];
  const days = Math.max(1, parseInt(daysArg || "30", 10));

  console.log(`[Backfill] Backfilling daily_skinny_subject_hourly for the past ${days} days...`);

  const hnBackfillQuery = `
    INSERT INTO daily_skinny_subject_hourly
    SELECT
        hour,
        subject,
        'hn' AS source,
        count() AS talk_threads,
        sum(greatest(descendants, 0)) AS comments,
        0 AS code_score,
        0 AS gh_stars,
        uniqState('') AS repos
    FROM
    (
        SELECT
            toStartOfHour(h.time) AS hour,
            h.id,
            h.descendants,
            argMin(t.display_name, t.rank) AS subject
        FROM hackernews h
        -- Intentional bounded dimension expansion: each story must be
        -- compared with each tokenized subject. Filter empty token sets
        -- before expanding the source rows.
        CROSS JOIN (
            SELECT display_name, rank, hn_tokens
            FROM daily_skinny_taxonomy
            WHERE length(hn_tokens) > 0
        ) t
        WHERE h.type = 'story'
          AND h.deleted = 0
          AND h.dead = 0
          AND h.time >= (SELECT max(time) FROM hackernews) - INTERVAL {days: UInt32} DAY
          AND arrayExists(
            tok -> position(
              concat(' ', replaceRegexpAll(lower(h.title), '[^a-z0-9]+', ' '), ' '),
              concat(' ', tok, ' ')
            ) > 0,
            t.hn_tokens
          )
        GROUP BY hour, h.id, h.descendants
    )
    GROUP BY hour, subject
  `;

  const ghBackfillQuery = `
    INSERT INTO daily_skinny_subject_hourly
    SELECT
        hour,
        subject,
        'gh' AS source,
        0 AS talk_threads,
        0 AS comments,
        sum(commit_count + (event_type = 'PullRequestEvent' AND action = 'opened') * 3 + (event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1) * 5 + (event_type = 'IssuesEvent' AND action = 'opened') * 2 + (event_type = 'WatchEvent') * 2) AS code_score,
        countIf(event_type = 'WatchEvent') AS gh_stars,
        uniqState(repo_name) AS repos
    FROM
    (
        SELECT
            toStartOfHour(g.created_at) AS hour,
            g.id,
            g.repo_name,
            g.event_type,
            g.action,
            g.pr_merged,
            g.commit_count,
            argMin(t.display_name, t.rank) AS subject
        FROM github_events g
        CROSS JOIN daily_skinny_taxonomy t
        WHERE g.created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL {days: UInt32} DAY
          AND arrayExists(pat -> lower(g.repo_name) LIKE pat, t.gh_repo_patterns)
        GROUP BY hour, g.id, g.repo_name, g.event_type, g.action, g.pr_merged, g.commit_count
    )
    GROUP BY hour, subject
  `;

  console.log("[Backfill] Backfilling HackerNews stories...");
  await clickhouse.command({ query: hnBackfillQuery, query_params: { days } });

  console.log("[Backfill] Backfilling GitHub events...");
  await clickhouse.command({ query: ghBackfillQuery, query_params: { days } });

  console.log(`[Backfill] Backfill complete for ${days} days!`);
}

runBackfill().catch((err) => {
  console.error("[Backfill] Failed to execute backfill:", err);
  process.exit(1);
});
