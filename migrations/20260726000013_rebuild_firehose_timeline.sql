-- +goose Up

-- The firehose schema was corrected after the original timeline MV was
-- deployed. CREATE ... IF NOT EXISTS did not replace that old MV, which
-- continued to emit `0 commits to ...` from the removed `payload.size` field.
--
-- Build the replacement beside the live projection first. This matters because
-- incremental materialized views only see inserts that happen after they are
-- created: dropping the live MV before creating its replacement would lose any
-- firehose rows inserted during the rebuild.
DROP VIEW IF EXISTS curated.event_timeline_mv_rebuild;
DROP TABLE IF EXISTS curated.event_timeline_rebuild;

CREATE TABLE curated.event_timeline_rebuild
(
    event_id       UInt64,
    created_at     DateTime,
    repo_name      String,
    actor_login    String,
    actor_avatar   String,
    event_type     LowCardinality(String),
    action         LowCardinality(String),
    title          Nullable(String),
    number         UInt32 DEFAULT 0,
    payload_summary String DEFAULT ''
)
ENGINE = ReplacingMergeTree
ORDER BY (created_at, repo_name, event_id)
TTL created_at + INTERVAL 7 DAY;

-- Install the replacement MV before the historical backfill. Rows inserted
-- while the backfill is running are therefore captured by this MV. The target
-- uses event_id as part of its replacing key so rows seen by both the backfill
-- and this MV converge to one timeline row.
CREATE MATERIALIZED VIEW curated.event_timeline_mv_rebuild
TO curated.event_timeline_rebuild AS
SELECT
    event_id,
    created_at,
    repo_name,
    actor_login,
    actor_avatar,
    event_type,
    action,
    title,
    number,
    if(event_type = 'PushEvent',
       if(JSONExtractString(payload, 'ref') != '',
          concat('pushed to ', replaceRegexpOne(JSONExtractString(payload, 'ref'), '^refs/heads/', '')),
          'pushed'),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(number)),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(number)),
                   if(event_type = 'CreateEvent',
                      if(ref_type != '', concat('created ', ref_type), 'created'),
                      if(event_type = 'DeleteEvent',
                         if(ref_type != '', concat('deleted ', ref_type), 'deleted'),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', coalesce(title, '')),
                            event_type)))))))) AS payload_summary
FROM default.github_events_firehose;

-- Backfill the retained window after the replacement MV is live. Replacing
-- MergeTree deduplicates rows that the MV observes while this snapshot is
-- being inserted, using the source event_id as the stable key.
INSERT INTO curated.event_timeline_rebuild
SELECT
    event_id,
    created_at,
    repo_name,
    actor_login,
    actor_avatar,
    event_type,
    action,
    title,
    number,
    if(event_type = 'PushEvent',
       if(JSONExtractString(payload, 'ref') != '',
          concat('pushed to ', replaceRegexpOne(JSONExtractString(payload, 'ref'), '^refs/heads/', '')),
          'pushed'),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(number)),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(number)),
                   if(event_type = 'CreateEvent',
                      if(ref_type != '', concat('created ', ref_type), 'created'),
                      if(event_type = 'DeleteEvent',
                         if(ref_type != '', concat('deleted ', ref_type), 'deleted'),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', coalesce(title, '')),
                            event_type)))))))) AS payload_summary
FROM default.github_events_firehose
WHERE created_at >= now() - INTERVAL 7 DAY;

-- Stop the stale projection only after the replacement is receiving writes.
-- The exchange is atomic, so readers move to the corrected target without a
-- period where curated.event_timeline is absent.
DROP VIEW curated.event_timeline_mv;
EXCHANGE TABLES curated.event_timeline AND curated.event_timeline_rebuild;
RENAME TABLE curated.event_timeline_mv_rebuild TO curated.event_timeline_mv;
DROP TABLE curated.event_timeline_rebuild;

-- +goose Down
DROP VIEW IF EXISTS curated.event_timeline_mv;
