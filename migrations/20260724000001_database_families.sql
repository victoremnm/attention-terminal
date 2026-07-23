-- +goose Up
CREATE DATABASE IF NOT EXISTS raw;

-- Drop MVs that reference source tables (baked-in source refs)
DROP VIEW IF EXISTS gh_repo_hourly_mv;
DROP VIEW IF EXISTS hn_hourly_mv;
DROP VIEW IF EXISTS gh_repo_daily_mv;
DROP VIEW IF EXISTS gh_repo_monthly_mv;
DROP VIEW IF EXISTS gh_actor_daily_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS gh_repo_drilldown_hourly_mv;
DROP VIEW IF EXISTS gh_repo_actor_hourly_mv;
DROP VIEW IF EXISTS gh_repo_activity_feed_mv;
DROP VIEW IF EXISTS gh_repo_actor_activity_feed_mv;

-- Drop compat view (reads FROM github_events)
DROP VIEW IF EXISTS gh_repo_activity_feed;

-- Move source tables into raw database
RENAME TABLE github_events TO raw.github_events;
RENAME TABLE hackernews TO raw.hackernews;
RENAME TABLE hf_model_snapshots TO raw.hf_model_snapshots;

-- Recreate MVs with raw. source refs (targets stay in default)

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_hourly_mv TO gh_repo_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM raw.github_events
GROUP BY hour, repo_name, event_type;

CREATE MATERIALIZED VIEW IF NOT EXISTS hn_hourly_mv TO hn_hourly AS
SELECT
    toStartOfHour(time) AS hour,
    type,
    countState() AS items,
    uniqState(toString(by)) AS authors,
    sumSimpleState(toInt64(score)) AS score
FROM raw.hackernews
GROUP BY hour, type;

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
FROM raw.github_events
WHERE repo_name != ''
GROUP BY day, repo_name;

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
FROM raw.github_events
WHERE repo_name != ''
GROUP BY month, repo_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_actor_daily_mv TO gh_actor_daily AS
SELECT
    toDate(created_at) AS day,
    actor_login,
    countState() AS events,
    uniqState(repo_name) AS repos,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
FROM raw.github_events
WHERE actor_login != ''
GROUP BY day, actor_login;

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_hn_hourly_mv TO daily_skinny_subject_hourly AS
SELECT
    hour,
    subject,
    'hn' AS source,
    count() AS talk_threads,
    sum(greatest(descendants, 0)) AS comments,
    0 AS code_score,
    0 AS gh_stars,
    uniqState('') AS repos
FROM
(
    SELECT
        toStartOfHour(time) AS hour,
        multiIf(
            hasToken(lower(title), 'postgres') OR hasToken(lower(title), 'postgresql') OR hasToken(lower(title), 'pg'), 'Postgres 18',
            hasToken(lower(title), 'sqlite'), 'SQLite',
            hasToken(lower(title), 'clickhouse'), 'ClickHouse',
            hasToken(lower(title), 'bun') OR hasToken(lower(title), 'oven'), 'Bun',
            hasToken(lower(title), 'deno'), 'Deno',
            hasToken(lower(title), 'rust'), 'Rust',
            hasToken(lower(title), 'react'), 'React',
            hasToken(lower(title), 'nextjs') OR hasToken(lower(title), 'next'), 'Next.js',
            hasToken(lower(title), 'tailwind'), 'Tailwind CSS',
            hasToken(lower(title), 'llama'), 'Llama',
            hasToken(lower(title), 'qwen'), 'Qwen',
            hasToken(lower(title), 'graphify'), 'Graphify',
            hasToken(lower(title), 'attention') OR hasToken(lower(title), 'terminal'), 'Attention Terminal',
            ''
        ) AS subject,
        descendants
    FROM raw.hackernews
    WHERE type = 'story'
      AND deleted = 0
      AND dead = 0
)
WHERE subject != ''
GROUP BY hour, subject;

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_skinny_gh_hourly_mv TO daily_skinny_subject_hourly AS
SELECT
    hour,
    subject,
    'gh' AS source,
    0 AS talk_threads,
    0 AS comments,
    sum(commit_count + (event_type = 'PullRequestEvent' AND action = 'opened') * 3 + (event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1) * 5 + (event_type = 'IssuesEvent' AND action = 'opened') * 2 + (event_type = 'WatchEvent') * 2) AS code_score,
    countIf(event_type = 'WatchEvent') AS gh_stars,
    uniqState(repo_name) AS repos
FROM
(
    SELECT
        toStartOfHour(created_at) AS hour,
        repo_name,
        event_type,
        action,
        pr_merged,
        commit_count,
        multiIf(
            lower(repo_name) LIKE '%postgres%' OR lower(repo_name) LIKE '%postgresql%', 'Postgres 18',
            lower(repo_name) LIKE '%sqlite%', 'SQLite',
            lower(repo_name) LIKE '%clickhouse%', 'ClickHouse',
            lower(repo_name) LIKE '%oven-sh/bun%' OR lower(repo_name) LIKE '%bun%', 'Bun',
            lower(repo_name) LIKE '%denoland/deno%' OR lower(repo_name) LIKE '%deno%', 'Deno',
            lower(repo_name) LIKE '%rust-lang%' OR lower(repo_name) LIKE '%rust%', 'Rust',
            lower(repo_name) LIKE '%facebook/react%' OR lower(repo_name) LIKE '%react%', 'React',
            lower(repo_name) LIKE '%vercel/next.js%' OR lower(repo_name) LIKE '%next.js%', 'Next.js',
            lower(repo_name) LIKE '%tailwindlabs/tailwindcss%' OR lower(repo_name) LIKE '%tailwind%', 'Tailwind CSS',
            lower(repo_name) LIKE '%llama%', 'Llama',
            lower(repo_name) LIKE '%qwen%', 'Qwen',
            lower(repo_name) LIKE '%graphify-labs/graphify%' OR lower(repo_name) LIKE '%graphify%', 'Graphify',
            lower(repo_name) LIKE '%victoremnm/attention-terminal%' OR lower(repo_name) LIKE '%clickhouse-trigger-hackathon%', 'Attention Terminal',
            ''
        ) AS subject
    FROM raw.github_events
)
WHERE subject != ''
GROUP BY hour, subject;

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
FROM raw.github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'ForkEvent', 'WatchEvent', 'IssuesEvent', 'PullRequestEvent')
GROUP BY hour, repo_name;

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
FROM raw.github_events
WHERE repo_name != ''
  AND actor_login != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent')
GROUP BY hour, repo_name, actor_login;

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
FROM raw.github_events
WHERE repo_name != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_repo_actor_activity_feed_mv TO gh_repo_actor_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    toUInt16(commit_count) AS commits,
    toUInt16(distinct_commit_count) AS distinct_commits,
    toUInt8(pr_merged) AS pr_merged
FROM raw.github_events
WHERE repo_name != ''
  AND actor_login != ''
  AND event_type IN ('PushEvent', 'PullRequestEvent');

-- Recreate compat view over raw.github_events
CREATE VIEW IF NOT EXISTS gh_repo_activity_feed AS
SELECT
    repo_name,
    actor_login,
    created_at,
    event_type,
    action,
    commit_count,
    distinct_commit_count,
    pr_merged,
    number,
    ref_type
FROM raw.github_events
WHERE repo_name != '';

-- Backfill daily_skinny_subject_hourly from raw sources
INSERT INTO daily_skinny_subject_hourly
SELECT
    hour,
    subject,
    'hn' AS source,
    count() AS talk_threads,
    sum(greatest(descendants, 0)) AS comments,
    0 AS code_score,
    0 AS gh_stars,
    uniqState('') AS repos
FROM
(
    SELECT
        toStartOfHour(time) AS hour,
        multiIf(
            hasToken(lower(title), 'postgres') OR hasToken(lower(title), 'postgresql') OR hasToken(lower(title), 'pg'), 'Postgres 18',
            hasToken(lower(title), 'sqlite'), 'SQLite',
            hasToken(lower(title), 'clickhouse'), 'ClickHouse',
            hasToken(lower(title), 'bun') OR hasToken(lower(title), 'oven'), 'Bun',
            hasToken(lower(title), 'deno'), 'Deno',
            hasToken(lower(title), 'rust'), 'Rust',
            hasToken(lower(title), 'react'), 'React',
            hasToken(lower(title), 'nextjs') OR hasToken(lower(title), 'next'), 'Next.js',
            hasToken(lower(title), 'tailwind'), 'Tailwind CSS',
            hasToken(lower(title), 'llama'), 'Llama',
            hasToken(lower(title), 'qwen'), 'Qwen',
            hasToken(lower(title), 'graphify'), 'Graphify',
            hasToken(lower(title), 'attention') OR hasToken(lower(title), 'terminal'), 'Attention Terminal',
            ''
        ) AS subject,
        descendants
    FROM raw.hackernews
    WHERE type = 'story'
      AND deleted = 0
      AND dead = 0
      AND time >= (SELECT max(time) FROM raw.hackernews) - INTERVAL 30 DAY
      AND (
        hasToken(lower(title), 'postgres') OR hasToken(lower(title), 'postgresql') OR hasToken(lower(title), 'pg') OR
        hasToken(lower(title), 'sqlite') OR hasToken(lower(title), 'clickhouse') OR
        hasToken(lower(title), 'bun') OR hasToken(lower(title), 'oven') OR
        hasToken(lower(title), 'deno') OR hasToken(lower(title), 'rust') OR
        hasToken(lower(title), 'react') OR hasToken(lower(title), 'nextjs') OR
        hasToken(lower(title), 'next') OR hasToken(lower(title), 'tailwind') OR
        hasToken(lower(title), 'llama') OR hasToken(lower(title), 'qwen') OR
        hasToken(lower(title), 'graphify') OR hasToken(lower(title), 'attention') OR
        hasToken(lower(title), 'terminal')
      )
)
WHERE subject != ''
GROUP BY hour, subject;

INSERT INTO daily_skinny_subject_hourly
SELECT
    hour,
    subject,
    'gh' AS source,
    0 AS talk_threads,
    0 AS comments,
    sum(commit_count + (event_type = 'PullRequestEvent' AND action = 'opened') * 3 + (event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1) * 5 + (event_type = 'IssuesEvent' AND action = 'opened') * 2 + (event_type = 'WatchEvent') * 2) AS code_score,
    countIf(event_type = 'WatchEvent') AS gh_stars,
    uniqState(repo_name) AS repos
FROM
(
    SELECT
        toStartOfHour(created_at) AS hour,
        repo_name,
        event_type,
        action,
        pr_merged,
        commit_count,
        multiIf(
            lower(repo_name) LIKE '%postgres%' OR lower(repo_name) LIKE '%postgresql%', 'Postgres 18',
            lower(repo_name) LIKE '%sqlite%', 'SQLite',
            lower(repo_name) LIKE '%clickhouse%', 'ClickHouse',
            lower(repo_name) LIKE '%oven-sh/bun%' OR lower(repo_name) LIKE '%bun%', 'Bun',
            lower(repo_name) LIKE '%denoland/deno%' OR lower(repo_name) LIKE '%deno%', 'Deno',
            lower(repo_name) LIKE '%rust-lang%' OR lower(repo_name) LIKE '%rust%', 'Rust',
            lower(repo_name) LIKE '%facebook/react%' OR lower(repo_name) LIKE '%react%', 'React',
            lower(repo_name) LIKE '%vercel/next.js%' OR lower(repo_name) LIKE '%next.js%', 'Next.js',
            lower(repo_name) LIKE '%tailwindlabs/tailwindcss%' OR lower(repo_name) LIKE '%tailwind%', 'Tailwind CSS',
            lower(repo_name) LIKE '%llama%', 'Llama',
            lower(repo_name) LIKE '%qwen%', 'Qwen',
            lower(repo_name) LIKE '%graphify-labs/graphify%' OR lower(repo_name) LIKE '%graphify%', 'Graphify',
            lower(repo_name) LIKE '%victoremnm/attention-terminal%' OR lower(repo_name) LIKE '%clickhouse-trigger-hackathon%', 'Attention Terminal',
            ''
        ) AS subject
    FROM raw.github_events
    WHERE created_at >= (SELECT max(created_at) FROM raw.github_events) - INTERVAL 30 DAY
      AND (
        lower(repo_name) LIKE '%postgres%' OR lower(repo_name) LIKE '%postgresql%' OR
        lower(repo_name) LIKE '%sqlite%' OR lower(repo_name) LIKE '%clickhouse%' OR
        lower(repo_name) LIKE '%oven-sh/bun%' OR lower(repo_name) LIKE '%bun%' OR
        lower(repo_name) LIKE '%denoland/deno%' OR lower(repo_name) LIKE '%deno%' OR
        lower(repo_name) LIKE '%rust-lang%' OR lower(repo_name) LIKE '%rust%' OR
        lower(repo_name) LIKE '%facebook/react%' OR lower(repo_name) LIKE '%react%' OR
        lower(repo_name) LIKE '%vercel/next.js%' OR lower(repo_name) LIKE '%next.js%' OR
        lower(repo_name) LIKE '%tailwindlabs/tailwindcss%' OR lower(repo_name) LIKE '%tailwind%' OR
        lower(repo_name) LIKE '%llama%' OR lower(repo_name) LIKE '%qwen%' OR
        lower(repo_name) LIKE '%graphify-labs/graphify%' OR lower(repo_name) LIKE '%graphify%' OR
        lower(repo_name) LIKE '%victoremnm/attention-terminal%' OR lower(repo_name) LIKE '%clickhouse-trigger-hackathon%'
      )
)
WHERE subject != ''
GROUP BY hour, subject;

-- +goose Down
DROP VIEW IF EXISTS gh_repo_hourly_mv;
DROP VIEW IF EXISTS hn_hourly_mv;
DROP VIEW IF EXISTS gh_repo_daily_mv;
DROP VIEW IF EXISTS gh_repo_monthly_mv;
DROP VIEW IF EXISTS gh_actor_daily_mv;
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP VIEW IF EXISTS gh_repo_drilldown_hourly_mv;
DROP VIEW IF EXISTS gh_repo_actor_hourly_mv;
DROP VIEW IF EXISTS gh_repo_activity_feed_mv;
DROP VIEW IF EXISTS gh_repo_actor_activity_feed_mv;
DROP VIEW IF EXISTS gh_repo_activity_feed;

RENAME TABLE raw.github_events TO github_events;
RENAME TABLE raw.hackernews TO hackernews;
RENAME TABLE raw.hf_model_snapshots TO hf_model_snapshots;

DROP DATABASE IF EXISTS raw;
