-- +goose Up
-- Meta table (not product data): a durable, queryable record of engineering
-- learnings captured from agent work sessions. Companion to the file-based
-- agent memory and the multi-agent-pr-review skill — lets us SELECT/aggregate
-- lessons (by category, tag, session) alongside the project's own data. Small,
-- append-oriented; MergeTree ordered by (category, slug) for grouped reads.
CREATE TABLE IF NOT EXISTS session_learnings
(
    ts        DateTime DEFAULT now(),
    session   String,
    slug      String,
    category  LowCardinality(String),
    learning  String,
    tags      Array(String)
)
ENGINE = MergeTree
ORDER BY (category, slug);

-- +goose Down
DROP TABLE IF EXISTS session_learnings;
