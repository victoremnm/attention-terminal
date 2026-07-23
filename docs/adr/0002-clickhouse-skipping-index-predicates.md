# ADR 0002: ClickHouse Case-Insensitive Skipping Index Predicates

- **Status**: Accepted
- **Date**: 2026-07-22
- **Context**: Issue #201 (Bot Filtering Query Performance & Skipping Index Scans)

## Context & Problem Statement
Queries filtering bot accounts previously used `actor_login ILIKE '%[bot]%'`. In ClickHouse 26.2, `ILIKE` predicates fail to match skipping indexes defined on case-lowered expressions (`lower(actor_login)`), forcing full table scans across tens of millions of rows in `github_events`.

## Decision Drivers
1. **Query Performance**: The table `github_events` defines `INDEX idx_github_events_actor_login lower(actor_login) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4`.
2. **Index Alignment**: `ILIKE` bypasses the index. Standard `lower(actor_login) LIKE '%[bot]%'` allows the ClickHouse query engine to prune granules using the token bloom filter.
3. **Operator Precedence**: Using `NOT LIKE` in ClickHouse requires explicit parenthesis wrapping (`lower(actor_login) NOT LIKE '%[bot]%'`) to prevent operator precedence mis-parsing.

## Decision Outcome
Accepted. All queries in `src/lib/queries.ts` and Trigger.dev background jobs were refactored to `lower(actor_login) LIKE '%[bot]%'` and `lower(actor_login) NOT LIKE '%[bot]%'`.

### Index Alignment & Audit Findings
- **Index Expression Match**: `lower(actor_login) LIKE` matches the indexed expression `lower(actor_login)` in `idx_github_events_actor_login`, so the query planner evaluates the skip index rather than bypassing it outright as `ILIKE` does.
- **EXPLAIN Audit Note**: Per `docs/architecture/EXPLAIN-QUERY-AUDIT.md`, token bloom filters on high-cardinality string columns (`tokenbf_v1`) require targeted equality/token searches to prune granules. On broad substring scans across raw event tables, granules may still scan fully (`17420/17420 granules`), making `AggregatingMergeTree` rollups the primary driver for >90% scan reductions.
