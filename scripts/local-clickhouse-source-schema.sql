-- Test-only source schema for the local migration smoke test.
-- These tables pre-date the checked-in migration chain in production.
CREATE TABLE IF NOT EXISTS default.hackernews
(
    id UInt64,
    type LowCardinality(String),
    time DateTime,
    by String DEFAULT '',
    title String DEFAULT '',
    text String DEFAULT '',
    descendants Int32 DEFAULT 0,
    score Int64 DEFAULT 0,
    deleted UInt8 DEFAULT 0,
    dead UInt8 DEFAULT 0,
    url String DEFAULT '',
    parent UInt64 DEFAULT 0,
    kids Array(UInt64) DEFAULT []
)
ENGINE = ReplacingMergeTree
ORDER BY id;

CREATE TABLE IF NOT EXISTS default.github_events
(
    id UInt64,
    event_id UInt64 DEFAULT 0,
    event_type LowCardinality(String),
    actor_login String DEFAULT '',
    repo_name String DEFAULT '',
    created_at DateTime,
    action LowCardinality(String) DEFAULT '',
    number UInt32 DEFAULT 0
)
ENGINE = MergeTree
ORDER BY (created_at, id);
