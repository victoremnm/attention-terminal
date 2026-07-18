-- +goose Up
CREATE TABLE IF NOT EXISTS ingest_log
(
    source LowCardinality(String),
    chunk_key String,
    rows_ingested UInt64,
    watermark UInt64,
    ingested_at DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (source, ingested_at);

-- +goose Down
DROP TABLE IF EXISTS ingest_log;
