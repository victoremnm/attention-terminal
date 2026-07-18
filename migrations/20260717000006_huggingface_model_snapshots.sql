-- +goose Up
CREATE TABLE IF NOT EXISTS hf_model_snapshots
(
    scan_at DateTime,
    scan_kind LowCardinality(String),
    model_id String,
    author String DEFAULT '',
    pipeline_tag LowCardinality(String) DEFAULT '',
    library_name LowCardinality(String) DEFAULT '',
    tags Array(String),
    downloads UInt64 DEFAULT 0,
    likes UInt32 DEFAULT 0,
    created_at DateTime DEFAULT toDateTime(0),
    last_modified DateTime DEFAULT toDateTime(0),
    is_private UInt8 DEFAULT 0,
    is_gated UInt8 DEFAULT 0,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (scan_kind, scan_at, model_id);

-- +goose Down
DROP TABLE IF EXISTS hf_model_snapshots;
