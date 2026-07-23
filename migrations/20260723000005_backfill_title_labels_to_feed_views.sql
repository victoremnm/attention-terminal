-- +goose Up
-- 20260723000004 added title/labels to github_events, but src/lib/queries.ts's
-- repoDrilldown feed query also reads from two derived feed objects that were
-- left behind without those columns: gh_repo_actor_activity_feed (a materialized
-- table+MV) and gh_repo_activity_feed (a thin projection view). Selecting
-- title/labels from either throws an unknown-identifier error in ClickHouse
-- instead of falling back, breaking the drilldown whenever aggregates are
-- available. Bring both up to the same shape as github_events.

-- 1. gh_repo_actor_activity_feed: add columns to the target table, then drop
--    and recreate the MV so new rows populate them (materialized views can't
--    be altered in place). Existing rows keep title=NULL/labels=[] -- the
--    original GH Archive payload isn't retained, so there's nothing to
--    backfill them from; only newly-ingested events get real values.
ALTER TABLE gh_repo_actor_activity_feed ADD COLUMN IF NOT EXISTS title Nullable(String);
ALTER TABLE gh_repo_actor_activity_feed ADD COLUMN IF NOT EXISTS labels Array(String) DEFAULT [];

DROP TABLE IF EXISTS gh_repo_actor_activity_feed_mv;
CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_actor_activity_feed_mv TO gh_repo_actor_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    toUInt16(commit_count) AS commits,
    toUInt16(distinct_commit_count) AS distinct_commits,
    toUInt8(pr_merged) AS pr_merged,
    title,
    labels
FROM github_events
WHERE repo_name != ''
  AND actor_login != '';

-- 2. gh_repo_activity_feed: also a real table (SharedMergeTree), fed by
--    gh_repo_activity_feed_mv -- NOT a plain view (verified against production
--    system.tables: engine = SharedMergeTree). Same drop/recreate-MV pattern
--    as step 1, matching the MV's actual existing shape and WHERE clause.
ALTER TABLE gh_repo_activity_feed ADD COLUMN IF NOT EXISTS title Nullable(String);
ALTER TABLE gh_repo_activity_feed ADD COLUMN IF NOT EXISTS labels Array(String) DEFAULT [];

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
    pr_merged
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

ALTER TABLE gh_repo_activity_feed DROP COLUMN IF EXISTS labels;
ALTER TABLE gh_repo_activity_feed DROP COLUMN IF EXISTS title;

DROP TABLE IF EXISTS gh_repo_actor_activity_feed_mv;
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
  AND actor_login != '';

ALTER TABLE gh_repo_actor_activity_feed DROP COLUMN IF EXISTS labels;
ALTER TABLE gh_repo_actor_activity_feed DROP COLUMN IF EXISTS title;
