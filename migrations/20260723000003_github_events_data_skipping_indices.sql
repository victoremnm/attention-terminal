-- +goose Up
-- Data-skipping indices for github_events: actor_login token bloom filter (for the
-- ILIKE '%[bot]%' substring bot-detection workload plus equality lookups),
-- and owner dimension for org-level rollups via expression index on split repo_name.
-- See issue #61 and issue #3 (migrations/aggregates registry) for details.

-- 1. Token bloom filter index on actor_login for devScatter/drilldown ILIKE and equality filters.
--    Used patterns: actor_login ILIKE '%[bot]%' for bot detection, exact matches for contributor
--    lookups. A plain `bloom_filter` only accelerates whole-value equality, not the substring
--    ILIKE workload this table actually runs -- tokenbf_v1 tokenizes on non-alphanumeric
--    boundaries (so "dependabot[bot]" indexes tokens "dependabot" and "bot"), matching the same
--    pattern already used for hackernews.title/text in 20260717000003_text_indexes.sql.
ALTER TABLE github_events ADD INDEX IF NOT EXISTS idx_github_events_actor_login lower(actor_login) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
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
