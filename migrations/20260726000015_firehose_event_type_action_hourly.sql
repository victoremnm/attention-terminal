-- +goose Up

-- Dimension-preserving activity mix. The existing repo signal aggregate stays
-- in place for its stable UI contract; this path is the lossless event surface.
CREATE TABLE IF NOT EXISTS curated.firehose_event_type_action_hourly
(
    hour       DateTime,
    repo_name  String,
    event_type LowCardinality(String),
    action     LowCardinality(String) DEFAULT '',
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
-- Queries always constrain the recent hour window, then group by repo/type/action.
ORDER BY (hour, repo_name, event_type, action)
TTL hour + INTERVAL 30 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_hourly_mv
TO curated.firehose_event_type_action_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY hour, repo_name, event_type, action;

-- Historical rows are populated by the operator-run runtime-cutoff backfill
-- script. Keeping this migration DDL-only avoids arbitrary calendar cutovers
-- and makes the backfill window explicit at execution time.

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_hourly_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_hourly;
