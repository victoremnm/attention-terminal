-- +goose Up
-- Per-actor activity feed for repo drill-down.
--
-- Unlike gh_repo_activity_feed (one row per event), this table tracks the
-- latest event per (repo, actor) pair so the drilldown feed can show each
-- contributor's most recent push/PR with their distinct commit count.
--
-- Key: (repo_name, actor_login) — one row per contributor.
-- gh_repo_actor_activity_feed_mv replaces the existing row for a given
-- (repo, actor) on every new event, so SELECT ... FINAL ORDER BY created_at DESC
-- LIMIT N gives the N most recently active contributors with their
-- per-person commit counts.
--
-- Required manual backfill: the MV only sees post-creation inserts. Backfill
-- from github_events for the trailing 30-day window:
--   INSERT INTO gh_repo_actor_activity_feed
--   SELECT repo_name, actor_login, created_at, event_type, action,
--          toUInt16(commit_count), toUInt16(distinct_commit_count), toUInt8(pr_merged)
--   FROM github_events
--   WHERE repo_name != '' AND actor_login != ''
--     AND event_type IN ('PushEvent', 'PullRequestEvent')
--     AND created_at >= now() - INTERVAL 30 DAY
CREATE TABLE IF NOT EXISTS gh_repo_actor_activity_feed
(
    repo_name String,
    actor_login String,
    created_at DateTime,
    event_type LowCardinality(String),
    action LowCardinality(String),
    commits UInt16,
    distinct_commits UInt16,
    pr_merged UInt8
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (repo_name, actor_login);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_actor_activity_feed_mv TO gh_repo_actor_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    toUInt16(commit_count) AS commits,
    toUInt16(distinct_commit_count) AS distinct_commits,
    toUInt8(pr_merged) AS pr_merged
FROM github_events
WHERE repo_name != ''
  AND actor_login != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

-- +goose Down
DROP VIEW IF EXISTS gh_repo_actor_activity_feed_mv;
DROP TABLE IF EXISTS gh_repo_actor_activity_feed;
