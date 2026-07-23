-- +goose Up
-- Data-skipping indices for github_events: actor_login bloom_filter (for ILIKE/equality lookups),
-- and owner dimension for org-level rollups via expression index on split repo_name.
-- See issue #61 and docs/data/migrations-aggregates-registry.md for details.

-- 1. Bloom filter index on actor_login for devScatter/drilldown ILIKE and equality filters
--    Used patterns: actor_login ILIKE '%[bot]%' for bot detection, exact matches for contributor lookups
ALTER TABLE github_events ADD INDEX IF NOT EXISTS idx_github_events_actor_login actor_login TYPE bloom_filter GRANULARITY 4;
ALTER TABLE github_events MATERIALIZE INDEX idx_github_events_actor_login;

-- 2. Add materialized owner column for org-level aggregation
--    Derive owner as the first part of repo_name split by '/' (e.g., 'golang/go' -> 'golang')
ALTER TABLE github_events ADD COLUMN IF NOT EXISTS owner String DEFAULT '' AFTER repo_name;

-- 3. Populate the owner column for existing rows via mutation (async background merge)
ALTER TABLE github_events UPDATE owner = splitByChar('/', repo_name)[1] WHERE owner = '' AND repo_name != '';

-- 4. Add set(100) skip index on owner for org-level drilldown/rollup queries
ALTER TABLE github_events ADD INDEX IF NOT EXISTS idx_github_events_owner owner TYPE set(100) GRANULARITY 4;
ALTER TABLE github_events MATERIALIZE INDEX idx_github_events_owner;

-- +goose Down
ALTER TABLE github_events DROP INDEX IF EXISTS idx_github_events_owner;
ALTER TABLE github_events DROP INDEX IF EXISTS idx_github_events_actor_login;
ALTER TABLE github_events DROP COLUMN IF EXISTS owner;
