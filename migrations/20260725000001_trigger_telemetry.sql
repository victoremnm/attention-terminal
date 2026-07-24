-- +goose Up
-- 1. Initialize Data Taxonomy Databases
CREATE DATABASE IF NOT EXISTS cleansed;
CREATE DATABASE IF NOT EXISTS curated;
CREATE DATABASE IF NOT EXISTS internal;

-- 2. Trigger.dev Structured & Console Logs (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_logs
(
    timestamp           DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    severity_text       LowCardinality(String),
    severity_number     UInt8,
    body                String CODEC(ZSTD(3)),
    attributes          Map(String, String) CODEC(ZSTD(1)),
    resource_attributes Map(String, String) CODEC(ZSTD(1)),
    run_id              String CODEC(ZSTD(1)),
    task_identifier     LowCardinality(String),
    attempt_number      UInt8,
    environment_type    LowCardinality(String),
    machine_name        LowCardinality(String),
    worker_version      String CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (task_identifier, environment_type, timestamp, run_id)
SETTINGS index_granularity = 8192;

ALTER TABLE internal.trigger_task_logs ADD INDEX IF NOT EXISTS idx_run_id run_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE internal.trigger_task_logs ADD INDEX IF NOT EXISTS idx_body body TYPE tokenbf_v1(30720, 2, 0) GRANULARITY 1;

-- 3. Trigger.dev OpenTelemetry Traces & Spans (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_spans
(
    timestamp           DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    end_timestamp       DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    parent_span_id      String CODEC(ZSTD(1)),
    span_name           LowCardinality(String),
    span_kind           LowCardinality(String),
    duration_ns         UInt64 CODEC(T64, ZSTD(1)),
    status_code         LowCardinality(String),
    status_message      String CODEC(ZSTD(1)),
    attributes          Map(String, String) CODEC(ZSTD(1)),
    resource_attributes Map(String, String) CODEC(ZSTD(1)),
    run_id              String CODEC(ZSTD(1)),
    task_identifier     LowCardinality(String),
    attempt_number      UInt8,
    environment_type    LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (task_identifier, span_name, timestamp, trace_id, span_id)
SETTINGS index_granularity = 8192;

ALTER TABLE internal.trigger_task_spans ADD INDEX IF NOT EXISTS idx_span_run_id run_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE internal.trigger_task_spans ADD INDEX IF NOT EXISTS idx_trace_id trace_id TYPE bloom_filter GRANULARITY 1;

-- 4. Trigger.dev System, Runtime, & Custom Metrics (internal ops storage)
CREATE TABLE IF NOT EXISTS internal.trigger_task_metrics
(
    timestamp           DateTime64(6) CODEC(DoubleDelta, ZSTD(1)),
    metric_name         LowCardinality(String),
    metric_type         LowCardinality(String),
    unit                LowCardinality(String),
    value               Float64 CODEC(Gorilla, ZSTD(1)),
    count               Nullable(UInt64),
    sum                 Nullable(Float64),
    min                 Nullable(Float64),
    max                 Nullable(Float64),
    attributes          Map(String, String) CODEC(ZSTD(1)),
    resource_attributes Map(String, String) CODEC(ZSTD(1)),
    run_id              String CODEC(ZSTD(1)),
    task_identifier     LowCardinality(String),
    machine_name        LowCardinality(String),
    environment_type    LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (metric_name, task_identifier, environment_type, timestamp, run_id)
SETTINGS index_granularity = 8192;

ALTER TABLE internal.trigger_task_metrics ADD INDEX IF NOT EXISTS idx_metric_name metric_name TYPE bloom_filter GRANULARITY 1;
ALTER TABLE internal.trigger_task_metrics ADD INDEX IF NOT EXISTS idx_metric_task task_identifier TYPE bloom_filter GRANULARITY 1;

-- 5. Hourly AggregatingMergeTree for High-Performance Rollups
CREATE TABLE IF NOT EXISTS internal.trigger_task_metrics_hourly
(
    hour                DateTime CODEC(DoubleDelta, ZSTD(1)),
    metric_name         LowCardinality(String),
    task_identifier     LowCardinality(String),
    environment_type    LowCardinality(String),
    sample_count        SimpleAggregateFunction(sum, UInt64),
    sum_value           SimpleAggregateFunction(sum, Float64),
    min_value           SimpleAggregateFunction(min, Float64),
    max_value           SimpleAggregateFunction(max, Float64),
    quantiles_state     AggregateFunction(quantiles(0.25, 0.50, 0.75, 0.95, 0.99), Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (metric_name, task_identifier, environment_type, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS internal.trigger_task_metrics_hourly_mv
TO internal.trigger_task_metrics_hourly AS
SELECT
    toStartOfHour(timestamp) AS hour,
    metric_name,
    task_identifier,
    environment_type,
    count() AS sample_count,
    sum(value) AS sum_value,
    min(value) AS min_value,
    max(value) AS max_value,
    quantilesState(0.25, 0.50, 0.75, 0.95, 0.99)(value) AS quantiles_state
FROM internal.trigger_task_metrics
GROUP BY hour, metric_name, task_identifier, environment_type;

-- 6. Subagent Telemetry Views in internal.*
CREATE VIEW IF NOT EXISTS internal.subagent_runs AS SELECT * FROM default.subagent_runs;
CREATE VIEW IF NOT EXISTS internal.subagent_api_events AS SELECT * FROM default.subagent_api_events;

-- 7. CURATED GOLD LAYER VIEWS FOR WEB CLIENT CONSUMPTION (`curated.*`)

-- Priority 1: Curated task health summary (sanitized, pre-aggregated)
CREATE VIEW IF NOT EXISTS curated.task_health_summary AS
SELECT
    run_id,
    task_identifier,
    environment_type,
    min(timestamp) AS start_time,
    max(end_timestamp) AS end_time,
    dateDiff('millisecond', min(timestamp), max(end_timestamp)) AS total_duration_ms,
    countIf(status_code = 'ERROR') AS error_span_count,
    count() AS total_spans
FROM internal.trigger_task_spans
GROUP BY run_id, task_identifier, environment_type;

-- Priority 1: Curated task execution metrics (7-day window using AggregatingMergeTree to prevent raw table full scans)
CREATE VIEW IF NOT EXISTS curated.task_execution_metrics AS
SELECT
    hour AS timestamp,
    task_identifier,
    metric_name,
    environment_type,
    sum(sample_count) AS sample_count,
    sum(sum_value) / sum(sample_count) AS avg_value,
    min(min_value) AS min_value,
    max(max_value) AS max_value,
    quantilesExactWeighted(0.25, 0.50, 0.75, 0.95, 0.99)(quantiles_state) AS quantiles_array,
    quantiles_array[1] AS p25_value,
    quantiles_array[2] AS median_value,
    quantiles_array[3] AS p75_value,
    (quantiles_array[3] - quantiles_array[1]) AS iqr_value,
    quantiles_array[4] AS p95_value,
    quantiles_array[5] AS p99_value
FROM internal.trigger_task_metrics_hourly
WHERE hour >= now() - INTERVAL 7 DAY
GROUP BY hour, task_identifier, metric_name, environment_type;

-- Priority 1: Hourly Curated Metrics View for Long-Term (30-day) Dashboard Queries
CREATE VIEW IF NOT EXISTS curated.task_execution_metrics_hourly AS
SELECT
    hour,
    task_identifier,
    metric_name,
    environment_type,
    sum(sample_count) AS sample_count,
    sum(sum_value) / sum(sample_count) AS avg_value,
    min(min_value) AS min_value,
    max(max_value) AS max_value,
    quantilesExactWeighted(0.25, 0.50, 0.75, 0.95, 0.99)(quantiles_state) AS quantiles_array,
    quantiles_array[1] AS p25_value,
    quantiles_array[2] AS median_value,
    quantiles_array[3] AS p75_value,
    (quantiles_array[3] - quantiles_array[1]) AS iqr_value,
    quantiles_array[4] AS p95_value,
    quantiles_array[5] AS p99_value
FROM internal.trigger_task_metrics_hourly
WHERE hour >= now() - INTERVAL 30 DAY
GROUP BY hour, task_identifier, metric_name, environment_type;

-- 8. CLICKHOUSE ROLE-BASED ACCESS CONTROL (RBAC)

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
DROP VIEW IF EXISTS curated.task_execution_metrics_hourly;
DROP VIEW IF EXISTS curated.task_execution_metrics;
DROP VIEW IF EXISTS curated.task_health_summary;
DROP VIEW IF EXISTS internal.subagent_api_events;
DROP VIEW IF EXISTS internal.subagent_runs;
DROP MATERIALIZED VIEW IF EXISTS internal.trigger_task_metrics_hourly_mv;
DROP TABLE IF EXISTS internal.trigger_task_metrics_hourly;
DROP TABLE IF EXISTS internal.trigger_task_metrics;
DROP TABLE IF EXISTS internal.trigger_task_spans;
DROP TABLE IF EXISTS internal.trigger_task_logs;
DROP DATABASE IF EXISTS internal;
DROP DATABASE IF EXISTS curated;
DROP DATABASE IF EXISTS cleansed;
