# ADR 0006: `raw` Database Family for Firehose Query Isolation

- **Status**: Accepted
- **Date**: 2026-07-24
- **Context**: PR #217 (move firehose tables into a `raw` database)

## Context & Problem Statement
`github_events`, `hackernews`, and `hf_model_snapshots` are the three append-only firehose source tables that every downstream rollup, materialized view, and dbt staging model reads from. They lived in `default` alongside ~37 other tables (rollups, drilldown aggregates, telemetry, product tables), with no query-side boundary separating raw ingestion data from derived/product surfaces.

## Decision Drivers
1. **Query isolation**: giving the three firehose tables their own namespace makes it easier to apply database-level policies (access grants, cost/quota tracking) to raw ingestion data separately from derived tables.
2. **Minimal blast radius**: the three tables are read by 11+ materialized views and multiple ingestion tasks. Physically renaming them would require dropping and recreating every dependent MV and backfilling historical rows — the exact kind of destructive migration this project has been burned by before (see the `gh_repo_activity_feed` incident below).
3. **ClickHouse Views cannot be written to**: `CREATE OR REPLACE VIEW` (or any plain View) rejects `INSERT` with `Method write is not supported by storage View`. This was independently rediscovered and confirmed twice in this project's history — once when a migration accidentally replaced a real table with a view and broke all `github_events` ingestion, and again while reviewing this PR, where the first draft had all three ingestion tasks inserting into `raw.*` directly.

## Decision Outcome
Accepted, in its simplified form (an earlier draft of this migration renamed the physical tables and rewired all 11 MVs — rejected in favor of the option below after a "chore: Simplify migration to views-only approach" follow-up commit).

`migrations/20260724000001_database_families.sql`:
- Creates database `raw`.
- Creates three thin passthrough Views: `raw.github_events`, `raw.hackernews`, `raw.hf_model_snapshots`, each `SELECT * FROM default.<table>`.
- The physical tables, their indexes, and all existing materialized views stay exactly where they are in `default` — nothing is dropped, renamed, or backfilled.

### The write/read split (load-bearing)
- **Reads** (application queries, dbt's `raw` source, ad-hoc agent SQL) go through `raw.github_events` / `raw.hackernews` / `raw.hf_model_snapshots`.
- **Writes** (the three ingestion tasks: `ingest-gharchive`, `ingest-hackernews`, `ingest-huggingface`) must target `default.github_events` / `default.hackernews` / `default.hf_model_snapshots` directly — never the `raw.*` name, which is read-only.
- dbt's `sources.yml` mirrors this: the `raw` source (schema `raw`) covers the three firehose tables for staging models; a separate `default` source covers `hn_hourly`/`gh_repo_hourly`/`gh_repo_daily`/`gh_repo_monthly`/`gh_repo_activity_feed`/`ingest_log`, which never moved.

## Consequences
- Positive: query-side isolation achieved with zero downtime, zero MV rebuilds, and zero backfill risk.
- Negative: the write/read split is an easy mistake to reintroduce — any new ingestion task or dbt model touching these three tables must remember writes go to `default.*`. Grep for `INSERT INTO raw\.` or `table: "raw\.` in CI/review as a guard.
- Verified in production: canary insert into `default.github_events` succeeds and is immediately visible via `raw.github_events`; canary insert into `raw.github_events` fails with the expected `NOT_IMPLEMENTED` error, confirming the split is enforced by ClickHouse itself, not just convention.
