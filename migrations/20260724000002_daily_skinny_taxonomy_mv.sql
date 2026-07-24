-- +goose Up
-- Rewire Daily Skinny rollups to the data-driven taxonomy from
-- 20260723000002_daily_skinny_taxonomy.sql. Materialized views only process
-- source rows inserted after they are created, so replace the old views,
-- rebuild the bounded retained window, then create the new views.

DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;

-- The target uses additive aggregate columns. Clear the rows produced by the
-- old hardcoded classifiers before backfilling with the taxonomy classifier.
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

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_hn_hourly_mv TO daily_skinny_subject_hourly AS
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

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_gh_hourly_mv TO daily_skinny_subject_hourly AS
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
        WHERE repo_name != ''
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

-- +goose Down
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
