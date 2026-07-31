-- +goose Up
-- Time-first trend tables for the home-page ticker (query-performance
-- remediation). gh_repo_hourly and gh_repo_activity_feed are ordered
-- (repo_name, ...) first, so every ticker lane's cross-repo "last N hours"
-- window skips the leading PK column and scans the whole rollup/feed on each
-- 60s cache-miss render, and the lanes' max() watermark subqueries do the
-- same. These two time-first tables make the ticker windows prune on the
-- primary key:
--
--   gh_repo_trend_hourly - (hour, repo_name, event_type) AggregatingMergeTree
--     feeding the NEW REPO / FORKED 24H / STARS 24H lanes. An event_type
--     dimension keeps countMerge(events) semantics identical to gh_repo_hourly,
--     and `repos_created` carries the CreateEvent + ref_type='repository'
--     signal that otherwise forces a raw-event scan. `actors` is uniqState
--     (HyperLogLog) like gh_repo_daily.actors.
--   gh_repo_trend_feed - (created_at, repo_name) row feed feeding the SHIPPING
--     lane, which needs per-actor bot filtering that an aggregate rollup cannot
--     express. Mirrors gh_repo_activity_feed's columns but time-first.
--
-- Required manual backfills (MVs only see post-creation inserts):
-- github_events retains ~30 days, so each backfill is one bounded
-- INSERT ... SELECT, mirroring the gh_actor_daily recipe:
--
--   INSERT INTO gh_repo_trend_hourly
--   SELECT
--       toStartOfHour(created_at) AS hour,
--       repo_name,
--       event_type,
--       countState() AS events,
--       uniqState(actor_login) AS actors,
--       sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
--       sumSimpleState(toUInt64(commit_count)) AS commits,
--       sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
--       sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
--       sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
--       sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
--       sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created
--   FROM github_events
--   WHERE repo_name != ''
--     AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent', 'CreateEvent')
--   GROUP BY hour, repo_name, event_type;
--
--   INSERT INTO gh_repo_trend_feed
--   SELECT
--       created_at,
--       repo_name,
--       actor_login,
--       event_type,
--       action,
--       commit_count AS commits,
--       distinct_commit_count AS distinct_commits,
--       pr_merged
--   FROM github_events
--   WHERE repo_name != ''
--     AND event_type IN ('PushEvent', 'PullRequestEvent');

CREATE TABLE IF NOT EXISTS gh_repo_trend_hourly
(
    hour DateTime,
    repo_name String,
    event_type LowCardinality(String),
    events AggregateFunction(count),
    actors AggregateFunction(uniq, String),
    pushes SimpleAggregateFunction(sum, UInt64),
    commits SimpleAggregateFunction(sum, UInt64),
    distinct_commits SimpleAggregateFunction(sum, UInt64),
    forks SimpleAggregateFunction(sum, UInt64),
    stars SimpleAggregateFunction(sum, UInt64),
    issues_opened SimpleAggregateFunction(sum, UInt64),
    prs_opened SimpleAggregateFunction(sum, UInt64),
    prs_closed SimpleAggregateFunction(sum, UInt64),
    prs_merged SimpleAggregateFunction(sum, UInt64),
    repos_created SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (hour, repo_name, event_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_trend_hourly_mv TO gh_repo_trend_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent', 'CreateEvent')
GROUP BY hour, repo_name, event_type;

CREATE TABLE IF NOT EXISTS gh_repo_trend_feed
(
    created_at DateTime,
    repo_name String,
    actor_login String,
    event_type LowCardinality(String),
    action LowCardinality(String),
    commits UInt16,
    distinct_commits UInt16,
    pr_merged UInt8
)
ENGINE = MergeTree
ORDER BY (created_at, repo_name);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_trend_feed_mv TO gh_repo_trend_feed AS
SELECT
    created_at,
    repo_name,
    actor_login,
    event_type,
    action,
    commit_count AS commits,
    distinct_commit_count AS distinct_commits,
    pr_merged
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

-- +goose Down
DROP VIEW IF EXISTS gh_repo_trend_feed_mv;
DROP TABLE IF EXISTS gh_repo_trend_feed;
DROP VIEW IF EXISTS gh_repo_trend_hourly_mv;
DROP TABLE IF EXISTS gh_repo_trend_hourly;
