-- +goose Up
-- Repo-level trend rollups for longer-range charts and rankings.
-- Query pattern: recent day/month windows across many repos, then rank or drill.
CREATE TABLE IF NOT EXISTS gh_repo_daily
(
    day Date,
    repo_name String,
    events AggregateFunction(count),
    actors AggregateFunction(uniq, String),
    pushes SimpleAggregateFunction(sum, UInt64),
    commits SimpleAggregateFunction(sum, UInt64),
    distinct_commits SimpleAggregateFunction(sum, UInt64),
    stars SimpleAggregateFunction(sum, UInt64),
    forks SimpleAggregateFunction(sum, UInt64),
    prs_opened SimpleAggregateFunction(sum, UInt64),
    prs_closed SimpleAggregateFunction(sum, UInt64),
    prs_merged SimpleAggregateFunction(sum, UInt64),
    issues_opened SimpleAggregateFunction(sum, UInt64),
    issues_closed SimpleAggregateFunction(sum, UInt64),
    repos_created SimpleAggregateFunction(sum, UInt64),
    branches_created SimpleAggregateFunction(sum, UInt64),
    tags_created SimpleAggregateFunction(sum, UInt64),
    releases_published SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (day, repo_name);

INSERT INTO gh_repo_daily
SELECT
    toDate(created_at) AS day,
    repo_name,
    countState() AS events,
    uniqState(actor_login) AS actors,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'tag')) AS tags_created,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent' AND action = 'published')) AS releases_published
FROM github_events
WHERE repo_name != ''
GROUP BY day, repo_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_daily_mv TO gh_repo_daily AS
SELECT
    toDate(created_at) AS day,
    repo_name,
    countState() AS events,
    uniqState(actor_login) AS actors,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'tag')) AS tags_created,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent' AND action = 'published')) AS releases_published
FROM github_events
WHERE repo_name != ''
GROUP BY day, repo_name;

CREATE TABLE IF NOT EXISTS gh_repo_monthly
(
    month Date,
    repo_name String,
    events AggregateFunction(count),
    actors AggregateFunction(uniq, String),
    pushes SimpleAggregateFunction(sum, UInt64),
    commits SimpleAggregateFunction(sum, UInt64),
    distinct_commits SimpleAggregateFunction(sum, UInt64),
    stars SimpleAggregateFunction(sum, UInt64),
    forks SimpleAggregateFunction(sum, UInt64),
    prs_opened SimpleAggregateFunction(sum, UInt64),
    prs_closed SimpleAggregateFunction(sum, UInt64),
    prs_merged SimpleAggregateFunction(sum, UInt64),
    issues_opened SimpleAggregateFunction(sum, UInt64),
    issues_closed SimpleAggregateFunction(sum, UInt64),
    repos_created SimpleAggregateFunction(sum, UInt64),
    branches_created SimpleAggregateFunction(sum, UInt64),
    tags_created SimpleAggregateFunction(sum, UInt64),
    releases_published SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (month, repo_name);

INSERT INTO gh_repo_monthly
SELECT
    toStartOfMonth(created_at) AS month,
    repo_name,
    countState() AS events,
    uniqState(actor_login) AS actors,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'tag')) AS tags_created,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent' AND action = 'published')) AS releases_published
FROM github_events
WHERE repo_name != ''
GROUP BY month, repo_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_monthly_mv TO gh_repo_monthly AS
SELECT
    toStartOfMonth(created_at) AS month,
    repo_name,
    countState() AS events,
    uniqState(actor_login) AS actors,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(distinct_commit_count)) AS distinct_commits,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'repository')) AS repos_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'tag')) AS tags_created,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent' AND action = 'published')) AS releases_published
FROM github_events
WHERE repo_name != ''
GROUP BY month, repo_name;

-- +goose Down
DROP VIEW IF EXISTS gh_repo_monthly_mv;
DROP TABLE IF EXISTS gh_repo_monthly;
DROP VIEW IF EXISTS gh_repo_daily_mv;
DROP TABLE IF EXISTS gh_repo_daily;
