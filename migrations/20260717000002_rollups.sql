-- +goose Up
-- Hourly attention rollups (AggregatingMergeTree fan-out pattern).
-- Note: hackernews is a ReplacingMergeTree that receives re-inserts when item
-- scores/comments change, so hn_hourly counts measure activity events, not
-- unique items. Query the raw table when exact uniqueness matters.
CREATE TABLE IF NOT EXISTS hn_hourly
(
    hour DateTime,
    type Enum8('story' = 1, 'comment' = 2, 'poll' = 3, 'pollopt' = 4, 'job' = 5),
    items AggregateFunction(count),
    authors AggregateFunction(uniq, String),
    score SimpleAggregateFunction(sum, Int64)
)
ENGINE = AggregatingMergeTree
ORDER BY (type, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS hn_hourly_mv TO hn_hourly AS
SELECT
    toStartOfHour(time) AS hour,
    type,
    countState() AS items,
    uniqState(toString(by)) AS authors,
    sumSimpleState(toInt64(score)) AS score
FROM hackernews
GROUP BY hour, type;

CREATE TABLE IF NOT EXISTS gh_repo_hourly
(
    hour DateTime,
    repo_name String,
    event_type LowCardinality(String),
    events AggregateFunction(count),
    actors AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, event_type, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_hourly_mv TO gh_repo_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM github_events
GROUP BY hour, repo_name, event_type;

-- +goose Down
DROP VIEW IF EXISTS gh_repo_hourly_mv;
DROP TABLE IF EXISTS gh_repo_hourly;
DROP VIEW IF EXISTS hn_hourly_mv;
DROP TABLE IF EXISTS hn_hourly;
