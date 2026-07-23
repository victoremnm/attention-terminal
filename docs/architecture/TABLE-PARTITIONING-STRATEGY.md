# ClickHouse Table Partitioning Strategy & Future Restructuring Plan

## Overview
This document outlines the partitioning strategy scheduled for the upcoming ClickHouse table restructuring.

---

## Current State vs Partitioned Architecture

Currently, tables use `SharedMergeTree` or `SharedAggregatingMergeTree` with primary key ordering:
- `gh_repo_hourly`: `ORDER BY (repo_name, event_type, hour)`
- `github_events`: `ORDER BY (event_type, repo_name, created_at)`
- `hackernews`: `ORDER BY id`

While minmax skipping indexes (added in migration `20260723000001`) prune granules within parts, **partition pruning** drops entire part directories at the metadata layer before reading any index blocks.

---

## Scheduled Partitioning Plan

When table restructuring is executed, tables will be partitioned by time:

### 1. `github_events`
```sql
CREATE TABLE default.github_events_v2
(
    `event_id` UInt64,
    `event_type` LowCardinality(String),
    `actor_login` String,
    `repo_name` String,
    `created_at` DateTime,
    `action` LowCardinality(String),
    `ref_type` LowCardinality(String) DEFAULT '',
    `commit_count` UInt16 DEFAULT 0,
    `distinct_commit_count` UInt16 DEFAULT 0,
    `pr_merged` UInt8 DEFAULT 0,
    `number` UInt32
)
ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY toYYYYMM(created_at)
ORDER BY (event_type, repo_name, created_at)
SETTINGS index_granularity = 8192;
```

### 2. `gh_repo_hourly`
```sql
CREATE TABLE default.gh_repo_hourly_v2
(
    `hour` DateTime,
    `repo_name` String,
    `event_type` LowCardinality(String),
    `events` AggregateFunction(count),
    `actors` AggregateFunction(uniq, String)
)
ENGINE = SharedAggregatingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY toYYYYMM(hour)
ORDER BY (repo_name, event_type, hour)
SETTINGS index_granularity = 8192;
```

### 3. Migration & Backfill Procedure
1. Create `*_v2` tables with `PARTITION BY toYYYYMM(...)`.
2. Attach `MATERIALIZED VIEW` triggers to backfill ongoing realtime ingestion into `*_v2`.
3. Backfill historic partitions via `INSERT INTO *_v2 SELECT * FROM *_v1`.
4. Swap table names via `RENAME TABLE *_v1 TO *_v1_old, *_v2 TO *_v1`.

---

## Performance Benefits
- **Zero Part Reads for Out-of-Window Queries**: Queries with `WHERE created_at > now() - INTERVAL 7 DAY` skip 100% of historical monthly partitions.
- **Instant Partition Detach/Drop**: Data retention policies (TTL or manual lifecycle management) operate via zero-copy partition drops (`ALTER TABLE ... DROP PARTITION`).
