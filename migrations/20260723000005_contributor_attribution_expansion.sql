-- +goose Up
-- Issue #126: Expand contributor attribution beyond commits
--
-- Add issues_opened to gh_repo_actor_hourly to track issue contributions
-- per actor per hour. Recreating the MV only affects FUTURE inserts --
-- every existing row keeps issues_opened at the column default (0) until
-- backfilled, undercounting issue activity already present in github_events.
--
-- Required manual backfill after this migration is applied: insert delta
-- rows carrying ONLY issues_opened, with every other measure left at 0.
-- gh_repo_actor_hourly is an AggregatingMergeTree keyed on
-- (repo_name, hour, actor_login), so these rows merge additively with the
-- existing correct pushes/commits/PR totals instead of overwriting them:
--
--   INSERT INTO gh_repo_actor_hourly
--     (hour, repo_name, actor_login, events, pushes, commits,
--      distinct_commits, prs_opened, prs_merged, issues_opened)
--   SELECT
--     toStartOfHour(created_at) AS hour,
--     repo_name,
--     actor_login,
--     initializeAggregation('countState', 0) AS events,
--     toUInt64(0) AS pushes,
--     toUInt64(0) AS commits,
--     toUInt64(0) AS distinct_commits,
--     toUInt64(0) AS prs_opened,
--     toUInt64(0) AS prs_merged,
--     countIf(event_type = 'IssuesEvent' AND action = 'opened') AS issues_opened
--   FROM github_events
--   WHERE repo_name != '' AND actor_login != ''
--     AND event_type = 'IssuesEvent' AND action = 'opened'
--     AND created_at >= now() - INTERVAL 30 DAY
--   GROUP BY hour, repo_name, actor_login;

ALTER TABLE gh_repo_actor_hourly
  ADD COLUMN IF NOT EXISTS issues_opened SimpleAggregateFunction(sum, UInt64) DEFAULT 0;

-- Update the materialized view to include issues_opened
DROP VIEW IF EXISTS gh_repo_actor_hourly_mv;

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
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened
FROM github_events
WHERE repo_name != ''
  AND actor_login != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')
GROUP BY hour, repo_name, actor_login;

-- +goose Down
DROP VIEW IF EXISTS gh_repo_actor_hourly_mv;
ALTER TABLE gh_repo_actor_hourly DROP COLUMN IF EXISTS issues_opened;

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
