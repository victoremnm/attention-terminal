-- +goose Up

-- Daily lossless firehose dimensions. The monthly partition is for retention
-- and lifecycle operations; day remains the leading query-time range key.
CREATE TABLE IF NOT EXISTS curated.firehose_event_type_action_daily
(
    day        Date,
    repo_name  String,
    event_type LowCardinality(String),
    action     LowCardinality(String) DEFAULT '',
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (day, repo_name, event_type, action);

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_daily_mv
TO curated.firehose_event_type_action_daily AS
SELECT
    toDate(created_at) AS day,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY day, repo_name, event_type, action;

-- Historical rows are populated by the operator-run runtime-cutoff backfill
-- script. This migration intentionally contains DDL only.

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_daily_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_daily;
