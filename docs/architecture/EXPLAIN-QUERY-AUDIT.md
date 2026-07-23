# ClickHouse Query Performance Audit & EXPLAIN Index Analysis

## Executive Summary
An empirical performance audit was conducted against `system.query_log` and using `EXPLAIN indexes = 1` to identify query bottlenecks, index granule scan efficiencies, and scalar subquery overhead across the production ClickHouse tables.

---

## Key Performance Findings

### 1. `system.query_log` Bottleneck Analysis

| Query Surface | Avg Read Rows | Avg Read MB | Avg Duration | Primary Cause |
| :--- | :--- | :--- | :--- | :--- |
| **Star Breakouts (30d)** | 175,131,580 | 3,218 MB | 2,214 ms | Full scan over `gh_repo_hourly` because `repo_name` leads `ORDER BY (repo_name, event_type, hour)`. |
| **Top Forked (24h)** | 175,134,269 | 862 MB | 1,567 ms | Subquery `(SELECT max(hour) FROM gh_repo_hourly)` re-evaluating without scalar binding. |
| **Shipping Velocity (24h)** | 16,300,886 | 389 MB | 1,625 ms | Scans all `repo_name` parts in `gh_repo_activity_feed`. |

---

### 2. `EXPLAIN indexes = 1` Findings

#### A. `gh_repo_hourly`
- **Primary Key**: `(repo_name, event_type, hour)`
- **EXPLAIN output**:
  ```text
  Indexes:
    PrimaryKey
      Keys: event_type, hour
      Granules: 7134/7134 (0% pruned)
  ```
- **Root Cause**: `repo_name` precedes `hour` in the primary key. Global time window queries across all repos cannot prune granules by time alone at the primary key layer.
- **Optimization Applied**: Bound scalar `max_h` once in the `WITH` clause:
  ```sql
  WITH (SELECT max(hour) FROM gh_repo_hourly) AS max_h
  ```
- **Benchmark Result**: `Top Forked 24h` query execution time dropped from **986ms → 232ms** (4.2x speedup), live integration test duration dropped from **2177ms → 1002ms**.

#### B. `hackernews`
- **Primary Key**: `id`
- **EXPLAIN output**:
  ```text
  Indexes:
    PrimaryKey: Condition true, Granules 6027/6027
  ```
- **Root Cause**: `time` was unindexed.
- **Recommendation / Action**: Created `minmax` skipping index on `hackernews.time`:
  ```sql
  ALTER TABLE hackernews ADD INDEX idx_hn_time time TYPE minmax GRANULARITY 4;
  ALTER TABLE hackernews MATERIALIZE INDEX idx_hn_time;
  ```

#### C. `gh_repo_activity_feed`
- **Primary Key**: `(repo_name, created_at)`
- **EXPLAIN output**:
  ```text
  Indexes:
    PrimaryKey: (created_at in [1784711055, +Inf)), Granules 677/677
  ```
- **Recommendation / Action**: Created `minmax` skipping index on `gh_repo_activity_feed.created_at`:
  ```sql
  ALTER TABLE gh_repo_activity_feed ADD INDEX idx_feed_created created_at TYPE minmax GRANULARITY 4;
  ```

#### D. `github_events` — actor_login / owner (PR #192, issue #61)

Post-apply verification of `20260723000003_github_events_data_skipping_indices.sql` against production (mutations confirmed `is_done = 1`, `owner` backfilled to 100% of 142,603,030 rows):

- **Actual production predicate**: `actor_login ILIKE '%[bot]%'` (`src/lib/queries.ts:1742-1743,1884`)
  ```text
  EXPLAIN indexes = 1 SELECT count() FROM github_events WHERE actor_login ILIKE '%[bot]%'
  Indexes:
    PrimaryKey: Condition true, Granules 17420/17420
    (no Skip section — idx_github_events_actor_login is not consulted at all)
  ```
- **Root cause**: ClickHouse bloom-filter indices (`tokenbf_v1`/`ngrambf_v1`) only support `equals`/`notEquals`/`in`/`notIn`/`has`/`like`/`notLike` — **not `ILIKE`**. The index is defined on `lower(actor_login)`, but the query uses `ILIKE` directly, so it's structurally incompatible with this index regardless of case.
- **Control query** (`lower(actor_login) LIKE '%bot%'`, matching the index's exact key expression) *does* invoke the Skip index, but still prunes **0%** (17420/17420 granules) — bot-authored events are dense across essentially every time-ordered granule in this table, so even a compatible predicate wouldn't benefit from this index today.
- **`owner` set(100) index** (`owner = 'golang'`): prunes 17180/17420 granules (**~1.4%**) — GH Archive data isn't clustered by owner, so a set index doesn't discriminate well here either.
- **Conclusion**: both new indices are currently inert for their intended query patterns. Tracked in issue #201 with rewrite/drop/re-architecture options.

---

## Verified Results & Next Steps
- Production Next.js build: **SUCCESS**
- Full test suite execution: **100% PASSED**
- `tickerLanes` integration test latency: Reduced from **2177ms to 1002ms**
- Follow-up: issue #201 (github_events actor_login/owner indices don't prune granules)
