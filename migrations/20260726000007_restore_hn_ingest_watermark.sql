-- +goose Up
-- The HN ingestion task uses this table as a sequential cursor. Migration
-- 20260726000005 was recorded as applied in production, but the table is
-- absent there, so keep the repair idempotent and restore it explicitly.
CREATE TABLE IF NOT EXISTS default.ingest_watermark
(
    source     LowCardinality(String),
    watermark  UInt64,
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY source;

-- +goose Down
DROP TABLE IF EXISTS default.ingest_watermark;
