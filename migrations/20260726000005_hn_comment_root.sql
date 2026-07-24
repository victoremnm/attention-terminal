-- +goose Up
-- Denormalized root story ID for efficient comment tree queries.
-- 0 for non-comment items (stories, polls, jobs).
-- Populated by ingest-hackernews trigger for new/updated items;
-- backfilled for historical items via scripts/backfill-hn-comment-roots.sh.
ALTER TABLE default.hackernews ADD COLUMN root UInt32 DEFAULT 0;

-- +goose Down
ALTER TABLE default.hackernews DROP COLUMN root;
