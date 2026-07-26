-- +goose Up

-- Monthly event-type/action aggregate. Same dimensions as the daily and hourly
-- tables so consumers can drill across time grains without remapping columns.

CREATE TABLE IF NOT EXISTS curated.firehose_event_type_action_monthly
(
    month      DateTime,
    repo_name  String,
    event_type LowCardinality(String),
    action     LowCardinality(String) DEFAULT '',
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(month)
ORDER BY (repo_name, event_type, action, month);

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_monthly_mv
TO curated.firehose_event_type_action_monthly AS
SELECT
    toStartOfMonth(created_at) AS month,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY month, repo_name, event_type, action;

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_monthly_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_monthly;
