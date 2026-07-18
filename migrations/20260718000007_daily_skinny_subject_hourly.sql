-- +goose Up
-- Subject-level hourly rollup for The Daily Skinny. Query pattern is a rolling
-- hour range across every tracked subject, so ORDER BY starts with hour.
CREATE TABLE IF NOT EXISTS daily_skinny_subject_hourly
(
    hour DateTime,
    subject LowCardinality(String),
    source Enum8('hn' = 1, 'gh' = 2),
    talk_threads SimpleAggregateFunction(sum, UInt64),
    comments SimpleAggregateFunction(sum, UInt64),
    code_score SimpleAggregateFunction(sum, UInt64),
    gh_stars SimpleAggregateFunction(sum, UInt64),
    repos AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (hour, subject, source);

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
    FROM hackernews
    WHERE type = 'story'
      AND deleted = 0
      AND dead = 0
      AND time >= (SELECT max(time) FROM hackernews) - INTERVAL 30 DAY
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
    FROM github_events
    WHERE created_at >= (SELECT max(created_at) FROM github_events) - INTERVAL 30 DAY
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
    FROM hackernews
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
    FROM github_events
)
WHERE subject != ''
GROUP BY hour, subject;

-- +goose Down
DROP VIEW IF EXISTS daily_skinny_gh_hourly_mv;
DROP VIEW IF EXISTS daily_skinny_hn_hourly_mv;
DROP TABLE IF EXISTS daily_skinny_subject_hourly;
