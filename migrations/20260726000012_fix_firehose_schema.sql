-- +goose Up
-- Fix: the firehose table was created with the old schema (dead columns
-- commit_count, distinct_commit_count, pr_merged, labels). Use
-- CREATE OR REPLACE to atomically swap to the correct schema.

CREATE OR REPLACE TABLE default.github_events_firehose
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
ENGINE = MergeTree
ORDER BY (event_type, repo_name, created_at)
TTL created_at + INTERVAL 30 DAY;

CREATE OR REPLACE VIEW raw.github_events_firehose AS
SELECT * FROM default.github_events_firehose;

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
FROM default.github_events_firehose;

CREATE TABLE IF NOT EXISTS curated.event_volume_hourly
(
    hour       DateTime,
    repo_name  String,
    event_type LowCardinality(String),
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, event_type, hour);

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_volume_hourly_mv TO curated.event_volume_hourly AS
SELECT
    toStartOfHour(created_at) AS hour,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY hour, repo_name, event_type;

CREATE TABLE IF NOT EXISTS curated.event_volume_daily
(
    day        Date,
    repo_name  String,
    event_type LowCardinality(String),
    events     AggregateFunction(count),
    actors     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (repo_name, event_type, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_volume_daily_mv TO curated.event_volume_daily AS
SELECT
    toDate(created_at) AS day,
    repo_name,
    event_type,
    countState() AS events,
    uniqState(actor_login) AS actors
FROM default.github_events_firehose
GROUP BY day, repo_name, event_type;

CREATE TABLE IF NOT EXISTS curated.event_timeline
(
    created_at    DateTime,
    repo_name     String,
    actor_login   String,
    actor_avatar  String,
    event_type    LowCardinality(String),
    action        LowCardinality(String),
    title         Nullable(String),
    number        UInt32 DEFAULT 0,
    payload_summary String DEFAULT ''
)
ENGINE = MergeTree
ORDER BY (created_at, repo_name)
TTL created_at + INTERVAL 7 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS curated.event_timeline_mv TO curated.event_timeline AS
SELECT
    created_at,
    repo_name,
    actor_login,
    actor_avatar,
    event_type,
    action,
    title,
    number,
    if(event_type = 'PushEvent',
       concat('pushed to ', JSONExtractString(payload, 'ref')),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(number)),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(number)),
                   if(event_type = 'CreateEvent',
                      concat('created ', ref_type, ' ', ref_type),
                      if(event_type = 'DeleteEvent',
                         concat('deleted ', ref_type, ' ', ref_type),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', coalesce(title, '')),
                            event_type)))))))) AS payload_summary
FROM default.github_events_firehose;

-- +goose Down
DROP VIEW IF EXISTS curated.event_timeline_mv;
DROP TABLE IF EXISTS curated.event_timeline;
DROP VIEW IF EXISTS curated.event_volume_daily_mv;
DROP TABLE IF EXISTS curated.event_volume_daily;
DROP VIEW IF EXISTS curated.event_volume_hourly_mv;
DROP TABLE IF EXISTS curated.event_volume_hourly;
DROP VIEW IF EXISTS cleansed.github_events_stg_firehose;
DROP VIEW IF EXISTS raw.github_events_firehose;
DROP TABLE IF EXISTS default.github_events_firehose;
