-- +goose Up

-- Reuse the firehose cutover from migration 20260726000014. Rows before the
-- instant are backfilled; rows at or after it are written by the MV.
-- firehose_event_type_action_cutover = 2026-07-26 00:00:00 UTC

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
WHERE created_at >= toDateTime('2026-07-26 00:00:00')
GROUP BY hour, repo_name, event_type, action;

-- Manual backfill is strictly before the MV lower bound, so the two paths are
-- disjoint even when late-arriving firehose rows are inserted.
INSERT INTO curated.firehose_event_type_action_hourly
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    action,
    countState(),
    uniqState(actor_login)
FROM default.github_events_firehose
WHERE created_at >= toDateTime('2026-07-26 00:00:00') - INTERVAL 7 DAY
  AND created_at < toDateTime('2026-07-26 00:00:00')
GROUP BY hour, repo_name, event_type, action;

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_event_type_action_hourly_mv;
DROP TABLE IF EXISTS curated.firehose_event_type_action_hourly;
