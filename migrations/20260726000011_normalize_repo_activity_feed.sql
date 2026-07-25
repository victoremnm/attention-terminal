-- +goose Up
-- gh_repo_activity_feed was accidentally introduced as a view in migration
-- 20260721000014 after production had already received the table from the
-- original repo-drilldown migration. Converge fresh installs and existing
-- installs on the production table + materialized-view shape without dropping
-- the target table or its historical rows.
CREATE TABLE IF NOT EXISTS gh_repo_activity_feed
(
    created_at DateTime,
    repo_name String,
    actor_login String,
    event_type LowCardinality(String),
    action LowCardinality(String),
    commits UInt16,
    distinct_commits UInt16,
    pr_merged UInt8,
    title Nullable(String),
    labels Array(String) DEFAULT []
)
ENGINE = MergeTree
ORDER BY (repo_name, created_at);

DROP TABLE IF EXISTS gh_repo_activity_feed_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_activity_feed_mv TO gh_repo_activity_feed AS
SELECT
    created_at,
    repo_name,
    actor_login,
    event_type,
    action,
    commit_count AS commits,
    distinct_commit_count AS distinct_commits,
    pr_merged,
    title,
    labels
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

-- +goose Down
-- This migration only normalizes the object type and rewires the MV. Keep the
-- canonical table and current MV shape intact on rollback; later historical
-- migrations own the actual table teardown.
DROP TABLE IF EXISTS gh_repo_activity_feed_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_activity_feed_mv TO gh_repo_activity_feed AS
SELECT
    created_at,
    repo_name,
    actor_login,
    event_type,
    action,
    commit_count AS commits,
    distinct_commit_count AS distinct_commits,
    pr_merged,
    title,
    labels
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');
