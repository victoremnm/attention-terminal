-- +goose Up

-- Daily event-type/action aggregate. Partitioned by calendar month so daily
-- retention and pruning remain efficient. The MV streams from the physical
-- firehose table (not the cleansed VIEW) to keep the ingestion path short.

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
ORDER BY (repo_name, event_type, action, day);

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

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_daily_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_daily;
