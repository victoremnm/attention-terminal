-- +goose Up

-- Fixed UTC cutover: rows before this instant are backfilled, while rows at
-- or after it are captured by the MV. Keep this literal identical in both
-- predicates so late-arriving inserts cannot be counted by both paths.
-- Update the cutover deliberately if this migration is rescheduled.
-- firehose_repo_signal_cutover = 2026-07-26 00:00:00 UTC

-- ============================================================
-- CURATED: Repo signal aggregates per hour
-- Derives 10 discrete signals from event_type + action + ref_type
-- ============================================================
CREATE TABLE IF NOT EXISTS curated.firehose_repo_signal_hourly
(
    hour             DateTime,
    repo_name        String,
    pushes           SimpleAggregateFunction(sum, UInt64),
    forks            SimpleAggregateFunction(sum, UInt64),
    stars            SimpleAggregateFunction(sum, UInt64),
    prs_opened       SimpleAggregateFunction(sum, UInt64),
    prs_closed       SimpleAggregateFunction(sum, UInt64),
    issues_opened    SimpleAggregateFunction(sum, UInt64),
    issues_closed    SimpleAggregateFunction(sum, UInt64),
    releases         SimpleAggregateFunction(sum, UInt64),
    branches_created SimpleAggregateFunction(sum, UInt64),
    branches_deleted SimpleAggregateFunction(sum, UInt64),
    events           AggregateFunction(count),
    actors           AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, hour)
TTL hour + INTERVAL 30 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_repo_signal_hourly_mv TO curated.firehose_repo_signal_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent')) AS releases,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'DeleteEvent' AND ref_type = 'branch')) AS branches_deleted,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
WHERE created_at >= toDateTime('2026-07-26 00:00:00')
GROUP BY hour, repo_name;

-- Backfill the seven days before the fixed cutover. The strict upper bound is
-- disjoint from the MV predicate above.
INSERT INTO curated.firehose_repo_signal_hourly
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    sumSimpleState(toUInt64(event_type = 'PushEvent')),
    sumSimpleState(toUInt64(event_type = 'ForkEvent')),
    sumSimpleState(toUInt64(event_type = 'WatchEvent')),
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')),
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')),
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')),
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')),
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent')),
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')),
    sumSimpleState(toUInt64(event_type = 'DeleteEvent' AND ref_type = 'branch')),
    countState(),
    uniqState(actor_login)
FROM default.github_events_firehose
WHERE created_at >= toDateTime('2026-07-26 00:00:00') - INTERVAL 7 DAY
  AND created_at < toDateTime('2026-07-26 00:00:00')
GROUP BY hour, repo_name;

-- +goose Down
DROP VIEW IF EXISTS curated.firehose_repo_signal_hourly_mv;
DROP TABLE IF EXISTS curated.firehose_repo_signal_hourly;
