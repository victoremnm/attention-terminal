-- +goose Up
-- Per-repo REST-activity tables (issue #79 track #81).
--
-- The GH Archive firehose (`github_events`) is push-dominated and carries no
-- commit messages, PR titles, release tags/bodies, or issue titles (CLAUDE.md
-- gotcha #4). These tables hold the content the firehose structurally lacks,
-- fetched from the GitHub REST API by the `refresh-repo-activity` poller
-- (issue #82) and read by `repoDrilldown()`'s activity + trends queries
-- (issue #83).
--
-- All tables are ReplacingMergeTree(inserted_at): re-inserting a row is the
-- correct way to refresh it (matches the `gh_repo_metadata` pattern). ORDER BY
-- keys start with `repo_name` so per-repo reads prune by the primary key.
-- `inserted_at` is the ReplacingMergeTree version column so a refresh
-- supersedes a stale row with the same business key.

CREATE TABLE IF NOT EXISTS gh_repo_commits
(
    repo_name     String,
    sha           String,
    author        String,
    author_date   DateTime,
    message       String,           -- first line only (subject)
    inserted_at   DateTime
)
ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (repo_name, sha);

CREATE TABLE IF NOT EXISTS gh_repo_prs
(
    repo_name     String,
    number        UInt32,
    title         String,
    state         LowCardinality(String),   -- 'open' | 'closed'
    author        String,
    created_at    DateTime,
    merged_at     DateTime,
    closed_at     DateTime,
    labels        Array(String),
    inserted_at   DateTime
)
ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (repo_name, number);

CREATE TABLE IF NOT EXISTS gh_repo_releases
(
    repo_name     String,
    tag           String,
    name          String,
    author        String,
    published_at  DateTime,
    body          String,            -- truncated to ~500 chars by the fetcher
    inserted_at   DateTime
)
ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (repo_name, tag);

CREATE TABLE IF NOT EXISTS gh_repo_issues
(
    repo_name     String,
    number        UInt32,
    title         String,
    state         LowCardinality(String),   -- 'open' | 'closed'
    author        String,
    created_at    DateTime,
    closed_at     DateTime,
    labels        Array(String),
    comments      UInt32,
    inserted_at   DateTime
)
ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (repo_name, number);

-- Watchlist: repos the poller should refresh. Seeded on first poller run from
-- 4 buckets (top-50 by stars/forks/pushes/commits over 30d), then updated by
-- the hourly candidate picker. Explicit additions (from the agent or UI) use
-- `source='manual'`; auto-seed rows use `source='auto-seed'`.
CREATE TABLE IF NOT EXISTS watchlist
(
    repo_name     String,
    added_at      DateTime,
    added_by      String,
    source        LowCardinality(String),   -- 'auto-seed' | 'manual' | 'activity'
    priority      UInt8,                    -- 1 = default; higher = poll sooner
    inserted_at   DateTime
)
ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY repo_name;

-- +goose Down
DROP TABLE IF EXISTS watchlist;
DROP TABLE IF EXISTS gh_repo_issues;
DROP TABLE IF EXISTS gh_repo_releases;
DROP TABLE IF EXISTS gh_repo_prs;
DROP TABLE IF EXISTS gh_repo_commits;