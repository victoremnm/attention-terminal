-- +goose Up
-- Canonical table for repo drill-down / ad-hoc agent SQL.
--
-- The materialized view and subsequent migrations populate/extend this
-- table. Keeping the target as a table is required for incremental writes and
-- preserves the production object type.
CREATE TABLE IF NOT EXISTS gh_repo_activity_feed
(
    created_at DateTime,
    repo_name String,
    actor_login String,
    event_type LowCardinality(String),
    action LowCardinality(String),
    commits UInt16,
    distinct_commits UInt16,
    pr_merged UInt8
)
ENGINE = MergeTree
ORDER BY (repo_name, created_at);

-- +goose Down
DROP TABLE IF EXISTS gh_repo_activity_feed;
