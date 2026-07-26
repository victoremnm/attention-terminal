-- +goose Up
-- Issue #131: Indexed Actor Contribution Dataset

CREATE DATABASE IF NOT EXISTS cleansed;
CREATE DATABASE IF NOT EXISTS curated;

-- 1. Cleansed staging view over raw.github_events with derived actor_id and is_bot columns
CREATE VIEW IF NOT EXISTS cleansed.github_events_stg AS
SELECT
    event_id,
    event_type,
    actor_login,
    cityHash64(actor_login) AS actor_id,
    toUInt8(lower(actor_login) LIKE '%[bot]%') AS is_bot,
    repo_name,
    created_at,
    action,
    ref_type,
    commit_count,
    distinct_commit_count,
    pr_merged,
    number,
    title,
    labels
FROM raw.github_events;

-- 2. Curated actor daily rollup table
CREATE TABLE IF NOT EXISTS curated.gh_actor_daily_rollup
(
    day Date,
    actor_login String,
    actor_id UInt64,
    is_bot UInt8 DEFAULT 0,
    pushes UInt32,
    commits UInt32,
    prs_opened UInt32,
    prs_merged UInt32,
    issues_opened UInt32,
    repos_contributed_to UInt32
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(day)
PRIMARY KEY (day, is_bot, actor_login)
ORDER BY (day, is_bot, actor_login);

-- 3. Materialized View to aggregate daily actor contributions into curated layer
CREATE MATERIALIZED VIEW IF NOT EXISTS cleansed.gh_actor_daily_mv TO curated.gh_actor_daily_rollup AS
SELECT
    toDate(created_at) AS day,
    actor_login,
    actor_id,
    is_bot,
    toUInt32(countIf(event_type = 'PushEvent')) AS pushes,
    toUInt32(sumIf(commit_count, event_type = 'PushEvent')) AS commits,
    toUInt32(countIf(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    toUInt32(countIf(event_type = 'PullRequestEvent' AND pr_merged = 1)) AS prs_merged,
    toUInt32(countIf(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    toUInt32(uniqExact(repo_name)) AS repos_contributed_to
FROM cleansed.github_events_stg
WHERE actor_login != ''
GROUP BY day, is_bot, actor_login, actor_id;

-- +goose Down
DROP VIEW IF EXISTS cleansed.gh_actor_daily_mv;
DROP TABLE IF EXISTS curated.gh_actor_daily_rollup;
DROP VIEW IF EXISTS cleansed.github_events_stg;
