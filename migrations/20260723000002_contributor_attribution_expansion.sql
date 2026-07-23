-- +goose Up
-- Issue #126: Expand contributor attribution beyond commits
--
-- Add issues_opened to gh_repo_actor_hourly to track issue contributions
-- per actor per hour. Backfill will be automatic since this is added to the
-- materialized view - future ingestions will include the field.

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
