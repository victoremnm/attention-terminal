-- +goose Up
-- Actor PR-merge dimension (issue #40): github_events (GH Archive firehose) is
-- push-dominated and rarely carries merged-PR data (CLAUDE.md gotcha #4), so
-- devScatter()'s sum(pr_merged) is ~empty on live data. This table holds a
-- real merged-PR count per actor, fetched via the GitHub REST/search API by
-- the refreshActorPrStats Trigger.dev job, for devScatter() to LEFT JOIN as
-- an enrichment signal. One row per actor; ReplacingMergeTree(fetched_at):
-- re-inserting an actor is the correct way to refresh their count (same
-- pattern as gh_repo_metadata, migration 20260720000009).
CREATE TABLE IF NOT EXISTS gh_actor_pr_stats
(
    actor_login  String,
    merged_prs   UInt64,   -- total_count from GET /search/issues?q=type:pr+is:merged+author:{login}
    fetched_at   DateTime
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY actor_login;

-- +goose Down
DROP TABLE IF EXISTS gh_actor_pr_stats;
