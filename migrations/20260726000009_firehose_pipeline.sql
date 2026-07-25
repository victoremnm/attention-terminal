-- +goose Up

-- ============================================================
-- RAW: Full payload firehose table
-- ============================================================
CREATE TABLE IF NOT EXISTS raw.github_events_firehose
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
    commit_count  UInt16 DEFAULT 0,
    distinct_commit_count UInt16 DEFAULT 0,
    pr_merged     UInt8 DEFAULT 0,
    number        UInt32 DEFAULT 0,
    title         Nullable(String),
    labels        Array(String) DEFAULT [],
    payload       String DEFAULT '{}'
)
ENGINE = MergeTree
ORDER BY (event_type, repo_name, created_at)
TTL created_at + INTERVAL 30 DAY;

-- ============================================================
-- CLEANSED: View that normalizes raw firehose rows
-- ============================================================
CREATE VIEW IF NOT EXISTS cleansed.github_events_stg_firehose AS
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
    commit_count,
    distinct_commit_count,
    pr_merged,
    number,
    title,
    labels,
    payload
FROM raw.github_events_firehose;

-- ============================================================
-- CURATED: Event volume per (repo, event_type, hour)
-- ============================================================
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
FROM raw.github_events_firehose
GROUP BY hour, repo_name, event_type;

-- ============================================================
-- CURATED: Event volume per (repo, event_type, day)
-- ============================================================
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
FROM raw.github_events_firehose
GROUP BY day, repo_name, event_type;

-- ============================================================
-- CURATED: Timeline feed (recent events with payload summary)
-- ============================================================
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
    if(event_type = 'PullRequestEvent',
       JSONExtractString(payload, 'pull_request', 'title'),
       if(event_type = 'IssuesEvent',
          JSONExtractString(payload, 'issue', 'title'),
          if(event_type = 'ReleaseEvent',
             JSONExtractString(payload, 'release', 'tag_name'),
             null))) AS title,
    toUInt32(JSONExtractUInt(payload, 'number')) AS number,
    if(event_type = 'PushEvent',
       concat(toString(JSONExtractUInt(payload, 'size')), ' commits to ',
              JSONExtractString(payload, 'ref')),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(JSONExtractUInt(payload, 'number'))),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(JSONExtractUInt(payload, 'number'))),
                   if(event_type = 'CreateEvent',
                      concat('created ', JSONExtractString(payload, 'ref_type'), ' ',
                             JSONExtractString(payload, 'ref')),
                      if(event_type = 'DeleteEvent',
                         concat('deleted ', JSONExtractString(payload, 'ref_type'), ' ',
                                JSONExtractString(payload, 'ref')),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', JSONExtractString(payload, 'release', 'tag_name')),
                            event_type)))))))) AS payload_summary
FROM raw.github_events_firehose;

-- +goose Down
DROP VIEW IF EXISTS curated.event_timeline_mv;
DROP TABLE IF EXISTS curated.event_timeline;
DROP VIEW IF EXISTS curated.event_volume_daily_mv;
DROP TABLE IF EXISTS curated.event_volume_daily;
DROP VIEW IF EXISTS curated.event_volume_hourly_mv;
DROP TABLE IF EXISTS curated.event_volume_hourly;
DROP VIEW IF EXISTS cleansed.github_events_stg_firehose;
DROP TABLE IF EXISTS raw.github_events_firehose;
