-- +goose Up
-- Actor PR-merge dimension (issue #40): github_events (GH Archive firehose) is
-- push-dominated and rarely carries merged-PR data (CLAUDE.md gotcha #4), so
-- devScatter()'s sum(pr_merged) is ~empty on live data. This table holds a
-- real merged-PR count per actor, fetched via the GitHub REST/search API by
-- the refreshActorPrStats Trigger.dev job, for devScatter() to LEFT JOIN as
-- an enrichment signal. One row per actor; ReplacingMergeTree(fetched_at):
-- re-inserting an actor is the correct way to refresh their count (same
-- pattern as gh_repo_metadata, migration 20260720000009).
--
-- Counts are stored PER SCATTER WINDOW (7d / 30d). devScatter()'s merge-rate
-- ranking divides the merged count by p.prs, which is scoped to the selected
-- 7d/30d window; a single lifetime count divided by a window denominator
-- produces merge rates far above 100% and lets prolific historical
-- contributors outrank current-window builders (PR #43 review, issue #40). So
-- each column holds the merged PRs authored within that window
-- (`type:pr is:merged author:{login} merged:>={window_start}`), and the query
-- reads the column matching its own denominator window.
CREATE TABLE IF NOT EXISTS gh_actor_pr_stats
(
    actor_login    String,
    merged_prs_7d  UInt64,   -- total_count for merged:>={today-7d}
    merged_prs_30d UInt64,   -- total_count for merged:>={today-30d}
    fetched_at     DateTime
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY actor_login;

-- +goose Down
DROP TABLE IF EXISTS gh_actor_pr_stats;
