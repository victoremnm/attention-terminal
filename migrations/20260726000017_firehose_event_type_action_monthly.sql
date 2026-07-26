-- +goose Up

-- Monthly lossless firehose dimensions for longer-range trend queries.
CREATE TABLE IF NOT EXISTS curated.firehose_event_type_action_monthly
(
    month      Date,
    repo_name  String,
    event_type LowCardinality(String),
    action     LowCardinality(String) DEFAULT '',
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(month)
ORDER BY (month, repo_name, event_type, action);

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_monthly_mv
TO curated.firehose_event_type_action_monthly AS
SELECT
    toDate(toStartOfMonth(created_at)) AS month,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY month, repo_name, event_type, action;

-- Historical rows are populated by the operator-run runtime-cutoff backfill
-- script. This migration intentionally contains DDL only.

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_monthly_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_monthly;
