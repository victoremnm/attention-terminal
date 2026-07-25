-- +goose Up
-- Backfill default.github_events_firehose from existing default.github_events.
-- The payload column will be empty string (original JSON was discarded at ingest).
-- Extracted fields (title, number, action, ref_type, commit counts) are preserved.
-- The timeline MV falls back to extracted fields when payload is empty.

INSERT INTO default.github_events_firehose
    (event_id, event_type, actor_login, repo_name, owner, created_at,
     action, ref_type, commit_count, distinct_commit_count, pr_merged, number, title, labels, payload)
SELECT
    event_id, event_type, actor_login,
    repo_name, owner, created_at,
    action, ref_type, commit_count, distinct_commit_count, pr_merged, number, title, labels,
    '' AS payload
FROM default.github_events
SETTINGS max_insert_threads = 4, max_block_size = 500000;

-- +goose Down
-- TTL will naturally expire backfilled rows after 30 days
