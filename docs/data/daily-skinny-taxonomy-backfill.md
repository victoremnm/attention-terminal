# Daily Skinny taxonomy backfill

Migration `20260724000002_daily_skinny_taxonomy_mv.sql` changes future
Hacker News and GitHub inserts to use `daily_skinny_taxonomy`. It deliberately
does not truncate or backfill `daily_skinny_subject_hourly` while ingestion is
live. Existing rows remain available as a legacy-compatible transitional state.

Run this procedure only during a maintenance window:

1. Pause both the Hacker News and GitHub ingestion jobs. Do not continue until
   both writers are stopped.
2. Run the following statements as one controlled maintenance operation. The
   30-day bounds follow the original Daily Skinny backfill window, and the
   aggregate expressions match `daily_skinny_subject_hourly`.
3. Confirm both ingestion jobs are still paused until the statements finish.
4. Resume both ingestion jobs. The recreated materialized views will process
   new source inserts using the current taxonomy.

Do not run these statements while either source writer is live. The target is
an additive `AggregatingMergeTree`; truncating it during concurrent inserts can
lose rows, and concurrent inserts between the truncate and the backfill can
produce an incomplete or inconsistent rebuild.

```sql
TRUNCATE TABLE daily_skinny_subject_hourly;

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
        story_id,
        hour,
        argMin(display_name, rank) AS subject,
        descendants
    FROM
    (
        SELECT
            id AS story_id,
            toStartOfHour(time) AS hour,
            lower(title) AS title,
            descendants
        FROM hackernews
        WHERE type = 'story'
          AND deleted = 0
          AND dead = 0
          AND time >= (SELECT max(time) FROM hackernews) - INTERVAL 30 DAY
          AND title != ''
    ) AS stories
    INNER JOIN
    (
        SELECT display_name, hn_tokens, rank
        FROM daily_skinny_taxonomy FINAL
        WHERE notEmpty(hn_tokens)
    ) AS taxonomy
        ON arrayExists(token -> hasToken(stories.title, token), taxonomy.hn_tokens)
    GROUP BY story_id, hour, descendants
)
WHERE subject != ''
GROUP BY hour, subject;

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
        event_id,
        hour,
        argMin(display_name, rank) AS subject,
        repo_name,
        event_type,
        action,
        pr_merged,
        commit_count
    FROM
    (
        SELECT
            event_id,
            toStartOfHour(created_at) AS hour,
            lower(repo_name) AS repo_name,
            event_type,
            action,
            pr_merged,
            commit_count
        FROM github_events
        WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 30 DAY
          AND repo_name != ''
    ) AS events
    INNER JOIN
    (
        SELECT display_name, gh_repo_patterns, rank
        FROM daily_skinny_taxonomy FINAL
        WHERE notEmpty(gh_repo_patterns)
    ) AS taxonomy
        ON arrayExists(pattern -> events.repo_name LIKE pattern, taxonomy.gh_repo_patterns)
    GROUP BY event_id, hour, repo_name, event_type, action, pr_merged, commit_count
)
WHERE subject != ''
GROUP BY hour, subject;
```
