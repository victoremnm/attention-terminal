-- +goose Up
-- Actor-activity rollup for DevScatter (issue #41): devScatter() in
-- src/lib/queries.ts scans all of github_events over a 7d/30d window on every
-- /deck render (~398,890,473 rows read / ~7.9s measured live, per issue #41),
-- because app/deck/page.tsx is force-dynamic. This mirrors gh_repo_daily's
-- AggregatingMergeTree + `-State`/`-Merge` pattern (see
-- 20260718000008_github_repo_period_rollups.sql), but keyed by actor_login
-- instead of repo_name, carrying only the aggregates devScatter() needs:
-- pushes, distinct repos (uniqState), commits, opened PRs, merged PRs.
--
-- Approximation note: `repos` uses uniqState/uniqMerge (HyperLogLog, same as
-- gh_repo_daily.actors) rather than the raw query's uniqExact. devScatter()'s
-- mega-pusher filter tests `repos = 1` — at single-digit-to-low-hundreds repo
-- counts per actor, uniq's error rate is negligible in practice, but this is a
-- deliberate accuracy/scan-cost tradeoff, not a hidden behavior change.
--
-- Required manual backfill (MVs only see post-creation inserts - CLAUDE.md):
-- as with gh_repo_daily, no backfill runs here since CD does not pause GH
-- ingestion and a backfill-before-MV sequence can miss live rows. Once this
-- migration is applied, backfill separately with:
--
--   INSERT INTO gh_actor_daily
--   SELECT
--       toDate(created_at) AS day,
--       actor_login,
--       countState() AS events,
--       uniqState(repo_name) AS repos,
--       sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
--       sumSimpleState(toUInt64(commit_count)) AS commits,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
--       sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
--   FROM github_events
--   WHERE actor_login != ''
--   GROUP BY day, actor_login;
--
-- github_events only retains ~30 days (CLAUDE.md), so this backfill is one
-- bounded INSERT ... SELECT, not a multi-day catch-up loop like gharchive
-- ingestion.
CREATE TABLE IF NOT EXISTS gh_actor_daily
(
    day Date,
    actor_login String,
    events AggregateFunction(count),
    repos AggregateFunction(uniq, String),
    pushes SimpleAggregateFunction(sum, UInt64),
    commits SimpleAggregateFunction(sum, UInt64),
    prs_opened SimpleAggregateFunction(sum, UInt64),
    prs_merged SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (day, actor_login);

CREATE MATERIALIZED VIEW IF NOT EXISTS gh_actor_daily_mv TO gh_actor_daily AS
SELECT
    toDate(created_at) AS day,
    actor_login,
    countState() AS events,
    uniqState(repo_name) AS repos,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(commit_count)) AS commits,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
FROM github_events
WHERE actor_login != ''
GROUP BY day, actor_login;

-- +goose Down
DROP VIEW IF EXISTS gh_actor_daily_mv;
DROP TABLE IF EXISTS gh_actor_daily;
