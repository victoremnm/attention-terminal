-- +goose Up
-- Add minmax and set skipping indexes to prune granules on time boundaries and repo lookup queries

-- 1. Minmax skipping index on hackernews.time for fast 6h/24h story velocity filtering
ALTER TABLE hackernews ADD INDEX IF NOT EXISTS idx_hn_time time TYPE minmax GRANULARITY 4;
ALTER TABLE hackernews MATERIALIZE INDEX idx_hn_time;

-- 2. Minmax skipping index on gh_repo_hourly.hour for fast 24h/7d/30d rollups across repos
ALTER TABLE gh_repo_hourly ADD INDEX IF NOT EXISTS idx_hourly_hour hour TYPE minmax GRANULARITY 4;
ALTER TABLE gh_repo_hourly MATERIALIZE INDEX idx_hourly_hour;

-- 3. Minmax and set skipping indexes on github_events for time window pruning and repo filtering
ALTER TABLE github_events ADD INDEX IF NOT EXISTS idx_github_events_created_at created_at TYPE minmax GRANULARITY 4;
ALTER TABLE github_events MATERIALIZE INDEX idx_github_events_created_at;

ALTER TABLE github_events ADD INDEX IF NOT EXISTS idx_github_events_repo_name repo_name TYPE set(100) GRANULARITY 4;
ALTER TABLE github_events MATERIALIZE INDEX idx_github_events_repo_name;

-- +goose Down
ALTER TABLE hackernews DROP INDEX IF EXISTS idx_hn_time;
ALTER TABLE gh_repo_hourly DROP INDEX IF EXISTS idx_hourly_hour;
ALTER TABLE github_events DROP INDEX IF EXISTS idx_github_events_created_at;
ALTER TABLE github_events DROP INDEX IF EXISTS idx_github_events_repo_name;
