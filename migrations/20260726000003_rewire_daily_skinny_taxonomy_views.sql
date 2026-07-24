-- +goose Up
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;

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
        toStartOfHour(h.time) AS hour,
        h.id,
        h.descendants,
        argMin(t.display_name, t.rank) AS subject
    FROM hackernews h
    CROSS JOIN daily_skinny_taxonomy t
    WHERE h.type = 'story'
      AND h.deleted = 0
      AND h.dead = 0
      AND arrayExists(tok -> position(lower(h.title), tok) > 0, t.hn_tokens)
    GROUP BY hour, h.id, h.descendants
)
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
    WHERE arrayExists(pat -> lower(g.repo_name) LIKE pat, t.gh_repo_patterns)
    GROUP BY hour, g.id, g.repo_name, g.event_type, g.action, g.pr_merged, g.commit_count
)
GROUP BY hour, subject;

-- Backfill last 30 days into daily_skinny_subject_hourly with rank-based deduplication
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
    CROSS JOIN daily_skinny_taxonomy t
    WHERE h.type = 'story'
      AND h.deleted = 0
      AND h.dead = 0
      AND h.time >= (SELECT max(time) FROM hackernews) - INTERVAL 30 DAY
      AND arrayExists(tok -> position(lower(h.title), tok) > 0, t.hn_tokens)
    GROUP BY hour, h.id, h.descendants
)
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
    WHERE g.created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 30 DAY
      AND arrayExists(pat -> lower(g.repo_name) LIKE pat, t.gh_repo_patterns)
    GROUP BY hour, g.id, g.repo_name, g.event_type, g.action, g.pr_merged, g.commit_count
)
GROUP BY hour, subject;

-- +goose Down
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
