-- +goose Up

-- ============================================================
-- Swap the firehose source table to ReplacingMergeTree.
--
-- default.github_events_firehose (MergeTree) becomes
-- default.github_events_stream (ReplacingMergeTree). event_id is appended to
-- the ORDER BY so duplicate inserts of the same event — the hourly GH Archive
-- load and the new real-time Events API poller both write this table —
-- converge to one row at merge time. The leading columns keep the existing
-- range-scan pattern for the curated projections.
--
-- Why not keep MergeTree + writer-side dedup alone: MVs fire on every INSERT
-- before any dedup could run, so only ReplacingMergeTree protects direct
-- reads from the stream. The aggregate MVs are additionally protected by
-- writer-side dedup (the poller watermarks per repo; the GH Archive load
-- anti-joins on event_id) so no event fires an MV twice in steady state.
--
-- Procedure (same build-beside pattern as migration 13):
--   1. create stream table
--   2. drop the 7 MVs that read the old table
--   3. truncate the 6 AggregatingMergeTree targets — they are re-aggregated
--      in full by the copy in step 6 (the legacy table holds the same <=30d
--      window the aggregates were built from, and every aggregate table is
--      younger than the firehose pipeline itself)
--   4. rename the old table to _legacy (kept for operator inspection; its
--      30d TTL self-cleans)
--   5. recreate the 7 MVs against the stream table
--   6. copy all rows — fires every new MV exactly once per event
--   7. force a merge so the RMT timeline dedups re-inserted rows
--   8. repoint the raw/cleansed views
-- ============================================================

-- 1. The stream table. Same columns as the legacy firehose table.
CREATE TABLE IF NOT EXISTS default.github_events_stream
(
    event_id      UInt64,
    event_type    LowCardinality(String),
    actor_login   String,
    actor_avatar  String,
    repo_name     String,
    owner         String,
    created_at    DateTime,
    action        LowCardinality(String),
    ref_type      LowCardinality(String) DEFAULT '',
    number        UInt32 DEFAULT 0,
    title         Nullable(String),
    payload       String DEFAULT '{}'
)
ENGINE = ReplacingMergeTree
ORDER BY (event_type, repo_name, created_at, event_id)
TTL created_at + INTERVAL 30 DAY;

-- 2. Stop the projections that read the old table.
DROP VIEW IF EXISTS curated.event_volume_hourly_mv;
DROP VIEW IF EXISTS curated.event_volume_daily_mv;
DROP VIEW IF EXISTS curated.event_timeline_mv;
DROP VIEW IF EXISTS curated.firehose_repo_signal_hourly_mv;
DROP VIEW IF EXISTS curated.firehose_event_type_action_hourly_mv;
DROP VIEW IF EXISTS curated.firehose_event_type_action_daily_mv;
DROP VIEW IF EXISTS curated.firehose_event_type_action_monthly_mv;

-- 3. Clear the AggregatingMergeTree targets. The step-6 copy re-fires every
-- event through the new MVs once; without a truncate, pre-existing aggregate
-- states would double count. curated.event_timeline is NOT truncated — it is
-- a ReplacingMergeTree keyed by event_id and dedups the re-inserted rows.
TRUNCATE TABLE IF EXISTS curated.event_volume_hourly;
TRUNCATE TABLE IF EXISTS curated.event_volume_daily;
TRUNCATE TABLE IF EXISTS curated.firehose_repo_signal_hourly;
TRUNCATE TABLE IF EXISTS curated.firehose_event_type_action_hourly;
TRUNCATE TABLE IF EXISTS curated.firehose_event_type_action_daily;
TRUNCATE TABLE IF EXISTS curated.firehose_event_type_action_monthly;

-- 4. Move the old table aside. Writers still pointing at the old name fail
-- loudly instead of silently splitting the stream; the next cron succeeds
-- after the code deploy repoints it.
RENAME TABLE default.github_events_firehose TO default.github_events_firehose_legacy;

-- 5. Recreate every projection against the stream table. Definitions are
-- identical to migrations 12/14/15/16/17/19 except for the source table.
CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_volume_hourly_mv TO curated.event_volume_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY hour, repo_name, event_type;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_volume_daily_mv TO curated.event_volume_daily AS
SELECT
    toDate(created_at) AS day,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY day, repo_name, event_type;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_timeline_mv TO curated.event_timeline AS
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
FROM default.github_events_stream;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_repo_signal_hourly_mv TO curated.firehose_repo_signal_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
    sumSimpleState(toUInt64(event_type = 'ForkEvent')) AS forks,
    sumSimpleState(toUInt64(event_type = 'WatchEvent')) AS stars,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
    sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')) AS prs_closed,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')) AS issues_opened,
    sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')) AS issues_closed,
    sumSimpleState(toUInt64(event_type = 'ReleaseEvent')) AS releases,
    sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')) AS branches_created,
    sumSimpleState(toUInt64(event_type = 'DeleteEvent' AND ref_type = 'branch')) AS branches_deleted,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY hour, repo_name;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_hourly_mv
TO curated.firehose_event_type_action_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY hour, repo_name, event_type, action;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_daily_mv
TO curated.firehose_event_type_action_daily AS
SELECT
    toDate(created_at) AS day,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY day, repo_name, event_type, action;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.firehose_event_type_action_monthly_mv
TO curated.firehose_event_type_action_monthly AS
SELECT
    toStartOfMonth(created_at) AS month,
    repo_name,
    event_type,
    action,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_stream
GROUP BY month, repo_name, event_type, action;

-- 6. Copy the retained window. Every row fires each new MV exactly once, so
-- the truncated aggregates rebuild to their pre-swap contents and the RMT
-- timeline queues duplicate rows for merge-time dedup.
INSERT INTO default.github_events_stream
SELECT * FROM default.github_events_firehose_legacy;

-- 7. Force the merge so the timeline is deduped (and TTL-expired rows are
-- dropped) before readers arrive.
OPTIMIZE TABLE curated.event_timeline FINAL;

-- 8. Repoint the schema-family views at the stream table.
CREATE OR REPLACE VIEW raw.github_events_firehose AS
SELECT * FROM default.github_events_stream;

CREATE OR REPLACE VIEW cleansed.github_events_stg_firehose AS
SELECT
    event_id,
    event_type,
    actor_login,
    cityHash64(actor_login) AS actor_id,
    toUInt8(lower(actor_login) LIKE '%[bot]%') AS is_bot,
    actor_avatar,
    repo_name,
    owner,
    created_at,
    action,
    ref_type,
    number,
    title,
    payload
FROM default.github_events_stream;

-- +goose Down
-- Rolling back an engine swap with live traffic is a manual operation: the
-- stream table has received new writes since the swap, and renaming back
-- would strand them. To roll back, stop the writers, copy stream rows into a
-- fresh MergeTree table, and recreate the pre-swap MVs. The legacy table is
-- left in place for that purpose (30d TTL).
SELECT 1;
