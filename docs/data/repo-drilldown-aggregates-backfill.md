# Repo drill-down aggregates backfill

The drill-down migration creates materialized views for three derived tables:

- `gh_repo_drilldown_hourly`
- `gh_repo_actor_hourly`
- `gh_repo_activity_feed`

Those views only capture inserts that arrive after the migration runs. If you
need to seed historical rows, run a one-time bounded backfill using the same
cutoff timestamp for all three tables.

Replace `<MV_CREATION_TIME>` with the exact migration time, then run:

```sql
INSERT INTO gh_repo_drilldown_hourly
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
  AND created_at < '<MV_CREATION_TIME>'
  AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
GROUP BY hour, repo_name;
```

```sql
INSERT INTO gh_repo_actor_hourly
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
  AND created_at < '<MV_CREATION_TIME>'
  AND event_type IN ('PushEvent', 'PullRequestEvent')
GROUP BY hour, repo_name, actor_login;
```

```sql
INSERT INTO gh_repo_activity_feed
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
  AND created_at < '<MV_CREATION_TIME>'
  AND event_type IN ('PushEvent', 'PullRequestEvent');
```
