-- +goose Up
-- 1. Initialize Data Taxonomy Databases
CREATE DATABASE IF NOT EXISTS cleansed;
CREATE DATABASE IF NOT EXISTS curated;
CREATE DATABASE IF NOT EXISTS internal;

-- 2. Trigger.dev Structured & Console Logs (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_logs
(
    Timestamp          DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    TraceId            String CODEC(ZSTD(1)),
    SpanId             String CODEC(ZSTD(1)),
    SeverityText       LowCardinality(String),
    SeverityNumber     UInt8,
    Body               String CODEC(ZSTD(3)),
    Attributes         Map(String, String) CODEC(ZSTD(1)),
    ResourceAttributes Map(String, String) CODEC(ZSTD(1)),
    run_id             String CODEC(ZSTD(1)),
    task_identifier    LowCardinality(String),
    attempt_number     UInt8,
    environment_type   LowCardinality(String),
    machine_name       LowCardinality(String),
    worker_version     String CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(Timestamp)
ORDER BY (task_identifier, environment_type, Timestamp, run_id)
SETTINGS index_granularity = 8192;

ALTER TABLE internal.trigger_task_logs ADD INDEX IF NOT EXISTS idx_run_id run_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE internal.trigger_task_logs ADD INDEX IF NOT EXISTS idx_body Body TYPE tokenbf_v1(30720, 2, 0) GRANULARITY 1;

-- 3. Trigger.dev OpenTelemetry Traces & Spans (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_spans
(
    Timestamp          DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    EndTimestamp       DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    TraceId            String CODEC(ZSTD(1)),
    SpanId             String CODEC(ZSTD(1)),
    ParentSpanId       String CODEC(ZSTD(1)),
    SpanName           LowCardinality(String),
    SpanKind           LowCardinality(String),
    DurationNs         UInt64 CODEC(T64, ZSTD(1)),
    StatusCode         LowCardinality(String),
    StatusMessage      String CODEC(ZSTD(1)),
    Attributes         Map(String, String) CODEC(ZSTD(1)),
    ResourceAttributes Map(String, String) CODEC(ZSTD(1)),
    run_id             String CODEC(ZSTD(1)),
    task_identifier    LowCardinality(String),
    attempt_number     UInt8,
    environment_type   LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(Timestamp)
ORDER BY (task_identifier, SpanName, Timestamp, TraceId, SpanId)
SETTINGS index_granularity = 8192;

ALTER TABLE internal.trigger_task_spans ADD INDEX IF NOT EXISTS idx_span_run_id run_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE internal.trigger_task_spans ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter GRANULARITY 1;

-- 4. Trigger.dev System, Runtime, & Custom Metrics (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_metrics
(
    Timestamp          DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    MetricName         LowCardinality(String),
    MetricType         LowCardinality(String),
    Unit               LowCardinality(String),
    Value              Float64 CODEC(Gorilla, ZSTD(1)),
    Count              Nullable(UInt64),
    Sum                Nullable(Float64),
    Min                Nullable(Float64),
    Max                Nullable(Float64),
    Attributes         Map(String, String) CODEC(ZSTD(1)),
    ResourceAttributes Map(String, String) CODEC(ZSTD(1)),
    run_id             String CODEC(ZSTD(1)),
    task_identifier    LowCardinality(String),
    machine_name       LowCardinality(String),
    environment_type   LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(Timestamp)
ORDER BY (MetricName, task_identifier, Timestamp, run_id)
SETTINGS index_granularity = 8192;

-- 5. Subagent Telemetry Views in internal.*
CREATE VIEW IF NOT EXISTS internal.subagent_runs AS SELECT * FROM default.subagent_runs;
CREATE VIEW IF NOT EXISTS internal.subagent_api_events AS SELECT * FROM default.subagent_api_events;

-- 6. CURATED GOLD LAYER VIEWS FOR WEB CLIENT CONSUMPTION (`curated.*`)

-- Priority 1: Curated task health summary (sanitized, pre-aggregated)
CREATE VIEW IF NOT EXISTS curated.task_health_summary AS
SELECT
    run_id,
    task_identifier,
    environment_type,
    min(Timestamp) AS start_time,
    max(EndTimestamp) AS end_time,
    dateDiff('millisecond', min(Timestamp), max(EndTimestamp)) AS total_duration_ms,
    countIf(StatusCode = 'ERROR') AS error_span_count,
    count() AS total_spans
FROM internal.trigger_task_spans
GROUP BY run_id, task_identifier, environment_type;

-- Priority 1: Curated task execution metrics (CPU utilization, heap memory)
CREATE VIEW IF NOT EXISTS curated.task_execution_metrics AS
SELECT
    toStartOfMinute(Timestamp) AS minute,
    task_identifier,
    MetricName,
    avg(Value) AS avg_value,
    max(Value) AS max_value
FROM internal.trigger_task_metrics
WHERE Timestamp >= now() - INTERVAL 7 DAY
GROUP BY minute, task_identifier, MetricName;

-- 7. CLICKHOUSE ROLE-BASED ACCESS CONTROL (RBAC)

-- Web Application Role (Access to curated.* first, cleansed.* second)
CREATE ROLE IF NOT EXISTS web_app_role;
GRANT SELECT ON curated.* TO web_app_role;
GRANT SELECT ON cleansed.* TO web_app_role;

-- Telemetry Ingestion Role (Selective write & read access to internal.*)
CREATE ROLE IF NOT EXISTS telemetry_ingest_role;
GRANT INSERT, SELECT ON internal.* TO telemetry_ingest_role;

-- Firehose Ingestion Role (Write & Read access to raw.* and cleansed.*)
CREATE ROLE IF NOT EXISTS pipeline_ingest_role;
GRANT INSERT, SELECT ON raw.* TO pipeline_ingest_role;
GRANT INSERT, SELECT ON cleansed.* TO pipeline_ingest_role;

-- +goose Down
DROP ROLE IF EXISTS pipeline_ingest_role;
DROP ROLE IF EXISTS telemetry_ingest_role;
DROP ROLE IF EXISTS web_app_role;
DROP VIEW IF EXISTS curated.task_execution_metrics;
DROP VIEW IF EXISTS curated.task_health_summary;
DROP VIEW IF EXISTS internal.subagent_api_events;
DROP VIEW IF EXISTS internal.subagent_runs;
DROP TABLE IF EXISTS internal.trigger_task_metrics;
DROP TABLE IF EXISTS internal.trigger_task_spans;
DROP TABLE IF EXISTS internal.trigger_task_logs;
DROP DATABASE IF EXISTS internal;
DROP DATABASE IF EXISTS curated;
DROP DATABASE IF EXISTS cleansed;
