-- +goose Up
-- Compatibility view for repo drill-down / ad-hoc agent SQL.
--
-- The canonical GitHub source is github_events; this view exists so
-- prompt-generated queries can target a stable, explicitly named feed
-- instead of inventing a nonexistent table. Keep it as a thin projection so
-- there is no backfill burden and no duplicate storage.
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

-- +goose Down
DROP VIEW IF EXISTS gh_repo_activity_feed;
