-- +goose Up
-- Actor classification dimension: real account types from the GitHub API
-- ('User' vs 'Bot' vs 'Organization') instead of login-string heuristics.
-- Populated by the refreshActorClassification Trigger.dev job. One row per
-- actor_login; ReplacingMergeTree(fetched_at): re-inserting an actor is the
-- correct way to refresh it. Unclassified actors have no row (LEFT JOIN
-- returns NULL), and the caller falls through to the legacy heuristic.
CREATE TABLE IF NOT EXISTS gh_actor_classification
(
    actor_login String,
    actor_type  LowCardinality(String),   -- 'User' | 'Bot' | 'Organization'
    fetched_at  DateTime
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY actor_login;

-- +goose Down
DROP TABLE IF EXISTS gh_actor_classification;
