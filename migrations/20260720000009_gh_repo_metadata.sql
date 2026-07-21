-- +goose Up
-- Repo metadata dimension: enrichment fetched from the GitHub REST API (owner_type,
-- description, language, topics, license, etc.) that the event/aggregate tables lack.
-- One row per repo; JOIN against gh_repo_daily USING (repo_name) for _l1d/_l7d/_l30d/_ltd
-- windows (time filters live on the activity side, not here). ReplacingMergeTree(fetched_at):
-- re-inserting a repo is the correct way to refresh it. Populated by the refreshRepoMetadata
-- Trigger.dev job (issue #26). See docs/architecture/AGENT-FLEET-PLAN.md §4.1.
CREATE TABLE IF NOT EXISTS gh_repo_metadata
(
    repo_name     String,
    owner         String,
    owner_type    LowCardinality(String),   -- 'User' | 'Organization'
    description   String,
    language      LowCardinality(String),
    topics        Array(String),
    homepage      String,
    license       LowCardinality(String),   -- SPDX id
    created_at    DateTime,
    pushed_at     DateTime,
    archived      UInt8,
    fork          UInt8,
    github_stars  UInt64,
    github_forks  UInt64,
    open_issues   UInt64,
    fetched_at    DateTime
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY repo_name;

-- +goose Down
DROP TABLE IF EXISTS gh_repo_metadata;
