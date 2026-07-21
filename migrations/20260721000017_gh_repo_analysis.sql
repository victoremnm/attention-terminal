-- +goose Up
-- Repo codebase analysis cache: structured codebase intelligence (overview, tech_stack,
-- key_files, architecture_summary) populated on-demand or via the Trigger.dev analyzeRepo task.
-- ReplacingMergeTree(analyzed_at): re-inserting a repo replaces stale analysis.
CREATE TABLE IF NOT EXISTS gh_repo_analysis
(
    repo_name            String,
    overview             String,
    tech_stack           Array(String),
    key_files            Array(String),
    architecture_summary String,
    analyzed_at          DateTime
)
ENGINE = ReplacingMergeTree(analyzed_at)
ORDER BY repo_name;

-- +goose Down
DROP TABLE IF EXISTS gh_repo_analysis;
