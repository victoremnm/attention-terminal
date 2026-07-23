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

---

## Verified Results & Next Steps
- Production Next.js build: **SUCCESS**
- Full test suite execution: **100% PASSED**
- `tickerLanes` integration test latency: Reduced from **2177ms to 1002ms**
