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

-- 2. gh_repo_activity_feed: a plain view (thin projection, no stored state),
--    so it's just a column-list update -- no backfill concern.
CREATE OR REPLACE VIEW gh_repo_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    commit_count,
    distinct_commit_count,
    pr_merged,
    number,
    ref_type,
    title,
    labels
FROM github_events
WHERE repo_name != '';

-- +goose Down
DROP VIEW IF EXISTS gh_repo_activity_feed;
CREATE VIEW IF NOT EXISTS gh_repo_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    commit_count,
    distinct_commit_count,
    pr_merged,
    number,
    ref_type
FROM github_events
WHERE repo_name != '';

DROP VIEW IF EXISTS gh_repo_actor_activity_feed_mv;
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
