-- +goose Up
-- Repo drill-down aggregates for the double-click card.
--
-- Query pattern:
--   - repo_name = ? over the latest 24h feed window
--   - hourly KPI/chart rows grouped by toStartOfHour(created_at)
--   - repo/actor/hour contribution slices for compact contributor summaries
--   - latest PushEvent/PullRequestEvent rows without scanning the wide firehose
--
-- Per ClickHouse primary-key guidance, these tables are keyed around the most
-- selective interactive filter (`repo_name`) before `hour`/`created_at`. The
-- actor table adds `actor_login` after the repo/time filters so per-repo reads
-- still prune well before grouping by contributor.
--
-- Required manual backfill (MVs only see post-creation inserts - CLAUDE.md):
-- Note: You MUST bound these backfills to events before MV creation to avoid double-counting.
-- Substitute <MV_CREATION_TIME> with the exact time the migration ran.
--
--   INSERT INTO gh_repo_drilldown_hourly
--   SELECT
--       toStartOfHour(created_at) AS hour,
--       repo_name,
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
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
--   FROM github_events
--   WHERE repo_name != ''
--     AND created_at < '<MV_CREATION_TIME>'
--     AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
--   GROUP BY hour, repo_name;
--
--   INSERT INTO gh_repo_actor_hourly
--   SELECT
--       toStartOfHour(created_at) AS hour,
--       repo_name,
--       actor_login,
--       countState() AS events,
--       sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
--       sumSimpleState(toUInt64(commit_count)) AS commits,
--       sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
--   FROM github_events
--   WHERE repo_name != ''
--     AND actor_login != ''
--     AND created_at < '<MV_CREATION_TIME>'
--     AND event_type IN ('PushEvent', 'PullRequestEvent')
--   GROUP BY hour, repo_name, actor_login;
--
--   INSERT INTO gh_repo_activity_feed
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
--     AND created_at < '<MV_CREATION_TIME>'
--     AND event_type IN ('PushEvent', 'PullRequestEvent');
CREATE TABLE IF NOT EXISTS gh_repo_drilldown_hourly
(
    hour DateTime,
    repo_name String,
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
    prs_merged SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_drilldown_hourly_mv TO gh_repo_drilldown_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
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
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
FROM github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
GROUP BY hour, repo_name;

CREATE TABLE IF NOT EXISTS gh_repo_actor_hourly
(
    hour DateTime,
    repo_name String,
    actor_login String,
    events AggregateFunction(count),
    pushes SimpleAggregateFunction(sum, UInt64),
    commits SimpleAggregateFunction(sum, UInt64),
    distinct_commits SimpleAggregateFunction(sum, UInt64),
    prs_opened SimpleAggregateFunction(sum, UInt64),
    prs_merged SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, hour, actor_login);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_actor_hourly_mv TO gh_repo_actor_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    actor_login,
    countState() AS events,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
FROM github_events
WHERE repo_name != ''
  AND actor_login != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent')
GROUP BY hour, repo_name, actor_login;

CREATE TABLE IF NOT EXISTS gh_repo_activity_feed
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
ORDER BY (repo_name, created_at);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_activity_feed_mv TO gh_repo_activity_feed AS
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
DROP VIEW IF EXISTS gh_repo_activity_feed_mv;
DROP TABLE IF EXISTS gh_repo_activity_feed;
DROP VIEW IF EXISTS gh_repo_actor_hourly_mv;
DROP TABLE IF EXISTS gh_repo_actor_hourly;
DROP VIEW IF EXISTS gh_repo_drilldown_hourly_mv;
DROP TABLE IF EXISTS gh_repo_drilldown_hourly;
