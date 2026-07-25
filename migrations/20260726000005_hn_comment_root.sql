-- +goose Up
-- Denormalized root story ID for efficient comment tree queries.
-- 0 for non-comment items (stories, polls, jobs).
-- Populated by ingest-hackernews trigger for new/updated items;
-- backfilled for historical items via scripts/backfill-hn-comment-roots.sh.
ALTER TABLE default.hackernews ADD COLUMN root UInt32 DEFAULT 0;

-- Sequential high-water mark tracker, decoupled from max(id) in the data
-- table so that kid-traversal items (which may have much higher HN IDs
-- than the sequential batch they arrived in) never advance the watermark.
-- Populated by ingest-hackernews trigger; read at the start of each run.
CREATE TABLE IF NOT EXISTS default.ingest_watermark
(
    source  LowCardinality(String),
    watermark UInt64,
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY source;

-- +goose Down
DROP TABLE IF EXISTS default.ingest_watermark;
ALTER TABLE default.hackernews DROP COLUMN root;
