# Lessons Learned: Resolving 500 Timeouts & ClickHouse Granule Indexing

**Date**: 2026-07-23  
**Status**: Documented & Resolved  
**Scope**: ClickHouse Query Performance, Self-JOIN Elimination, Granule Pruning, and Next.js SSR Bundling

---

## Executive Summary

During high-concurrency production runs, the application experienced sporadic HTTP 500 errors and 30-second timeouts (`TIMEOUT_EXCEEDED` / `MEMORY_LIMIT_EXCEEDED`). A forensic audit using `system.query_log` revealed that multi-table self-JOINs and string-pattern filtering over raw event feeds caused 14.4+ GB memory spikes and query queuing. 

By eliminating self-JOINs, binding high-water mark scalar constants in `WITH` clauses, and using direct vector byte comparisons, query execution dropped from **100+ seconds to 678 ms (148x speedup)** with zero memory overflow.

---

## Key Learnings & Architectural Anti-Patterns

### 1. Anti-Pattern: Self-JOINs over Unaggregated Views (`gh_repo_activity_feed`)
- **Symptom**: `Code: 241. DB::Exception: (total) memory limit exceeded: would use 14.43 GiB... While executing AggregatingTransform.`
- **Root Cause**: The `shippingVelocity` query performed a `LEFT JOIN` on `gh_repo_activity_feed` to compute hourly sparklines. Because `gh_repo_activity_feed` reads raw `github_events`, joining it against itself forced ClickHouse to create a massive in-memory hash join table across tens of millions of rows.
- **Rule**: **Never perform a `LEFT JOIN` on raw event views.** Compute sparklines and aggregations in a single pass using `countIf()`, `sumIf()`, or pre-aggregated hourly rollup tables (`gh_repo_hourly`).

### 2. Anti-Pattern: Correlated Subqueries in `WHERE` Clauses
- **Symptom**: `Code: 159. DB::Exception: Timeout exceeded: elapsed 30012 ms.`
- **Root Cause**: Filtering `WHERE created_at > (SELECT max(created_at) FROM gh_repo_activity_feed) - INTERVAL 24 HOUR` caused ClickHouse to evaluate the subquery repeatedly across query pipelines.
- **Rule**: **Bind temporal high-water marks as scalar constants** using a top-level `WITH` clause:
  ```sql
  WITH
    (SELECT max(created_at) FROM gh_repo_activity_feed) AS max_time
  SELECT ...
  FROM gh_repo_activity_feed
  WHERE created_at > max_time - INTERVAL 24 HOUR
  ```
  This allows ClickHouse to evaluate `max_time` once and prune primary key granules efficiently.

### 3. Anti-Pattern: Leading Wildcard Case-Insensitive String Match (`ILIKE '%[bot]%'`)
- **Symptom**: Granule skipping indexes ignored during string matching; high CPU load.
- **Root Cause**: `ILIKE '%[bot]%'` requires case-insensitive regex parsing per string.
- **Rule**: Use direct SIMD byte functions: `position(actor_login, '[bot]') = 0` or `endsWith(actor_login, '[bot]')`.

### 4. Anti-Pattern: Numeric-to-String Double Casts in Aggregations
- **Symptom**: `toString(round(...)) AS score` followed by `ORDER BY toFloat64(score) DESC`.
- **Root Cause**: Formatting numbers into `String` during aggregation allocates string buffers in memory, only to force ClickHouse to re-parse strings back into floats when sorting.
- **Rule**: Maintain native `UInt64` / `Float64` numeric types throughout the SQL aggregation pipeline (`ORDER BY score DESC`).

### 5. Next.js SSR ESM Module Require Errors
- **Symptom**: `Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/node_modules/@exodus/bytes/encoding-lite.js from ... html-encoding-sniffer.js not supported.`
- **Root Cause**: Dev-only DOM utilities (`jsdom`, `html-encoding-sniffer`) accidentally referenced in serverless SSR chunk paths.
- **Rule**: Keep browser DOM testing libraries strictly inside `devDependencies` and isolate client component rendering from Node.js CJS server execution paths.

---

## Verification & Granule Pruning Baseline

Automated via [`src/lib/granule-pruning-smoketest.test.ts`](file:///Users/victorem/Code/Repositories/victoremnm/clickhouse-trigger-hackathon/src/lib/granule-pruning-smoketest.test.ts):

| Target Table | Index Name | Index Type | Total Granules | Selected Granules | Granules Saved (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `github_events` | `idx_github_events_created_at` | `minmax` | 1,232 | 9 | **99.27%** |
| `gh_repo_hourly` | `idx_hourly_hour` | `minmax` | 7,142 | 163 | **97.72%** |
| `hackernews` | `idx_hn_time` | `minmax` | 6,019 | 5 | **99.91%** |
