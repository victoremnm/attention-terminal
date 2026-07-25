-- +goose Up
-- Backfill raw.github_events_firehose from existing default.github_events.
-- The payload column will be empty string (original JSON was discarded at ingest).
-- This gives historical aggregates even without the raw payload.

INSERT INTO raw.github_events_firehose
    (event_id, event_type, actor_login, actor_avatar, repo_name, owner, created_at,
     action, ref_type, commit_count, distinct_commit_count, pr_merged, number, title, labels, payload)
SELECT
    event_id, event_type, actor_login, '' AS actor_avatar,
    repo_name, owner, created_at,
    action, ref_type, commit_count, distinct_commit_count, pr_merged, number, title, labels,
    '' AS payload
FROM default.github_events;

-- +goose Down
-- TTL will naturally expire backfilled rows after 30 days
