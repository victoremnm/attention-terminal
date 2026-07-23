# Migrations & Aggregates Registry

This document tracks all ClickHouse DDL via goose migrations. Every new table, index, column, or materialized view must be registered here at the time of migration creation.

**Policy**: All DDL goes through `migrations/` + `./scripts/migrate.sh`. Never ad-hoc DDL. New MVs require manual `INSERT INTO ... SELECT` backfill (MVs only see post-creation inserts).

---

## Tables

### Raw Ingestion

| Name | Engine | Purpose | Migration | Status |
|---|---|---|---|---|
| `ingest_log` | MergeTree | Idempotency watermark for HN + GH Archive hourly loads | `20260717000001_ingest_log.sql` | Live |
| `github_events` | MergeTree | Full GitHub Archive events (30d depth, ~120M rows). ORDER BY (event_type, repo_name, created_at). Reinserts are correct way to update. | Created prior (ingestion task) | Live |
| `hackernews` | ReplacingMergeTree | HN items with update tracking (48.9M items, full corpus since 2006). UPDATE via reinsertion. ORDER BY id | Created prior | Live |

### Rollups & Aggregates

| Name | Engine | Purpose | Grain | Backfill | Status |
|---|---|---|---|---|
| `hn_hourly` | AggregatingMergeTree | HN activity (count, authors, score). Fed by `hn_hourly_mv`. | hour, type | Auto MV | Live |
| `gh_repo_hourly` | AggregatingMergeTree | GitHub event counts per repo. Fed by `gh_repo_hourly_mv`. ORDER BY (repo_name, event_type, hour). | repo_name, event_type, hour | Auto MV | Live |
| `gh_repo_drilldown_hourly` | AggregatingMergeTree | Repo-level 24h KPIs (pushes, commits, stars, forks, PRs, issues). ORDER BY (repo_name, hour). | repo_name, hour | Manual backfill required | Live |
| `gh_repo_actor_hourly` | AggregatingMergeTree | Contributor slices: repo/actor/hour contribution measures. ORDER BY (repo_name, actor_login, hour). | repo_name, actor_login, hour | Manual backfill required | Live |
| `gh_repo_activity_feed` | MergeTree | Narrow PushEvent/PullRequestEvent feed (no aggregation). ORDER BY (repo_name, created_at). | event, repo, timestamp | Manual backfill | Live |
| `gh_repo_daily` (planned) | SummingMergeTree | Daily trend rollups (events, actors, pushes, commits, stars, forks, PRs, issues). | repo_name, day | TBD | Planned |
| `gh_repo_monthly` (planned) | SummingMergeTree | Monthly trend rollups. | repo_name, month | TBD | Planned |
| `gh_repo_actor_daily` | AggregatingMergeTree | Per-actor daily rollup of contribution stats (pushes, PRs, issues). ORDER BY (actor_login, day). Fed by `gh_repo_actor_daily_mv`. | actor_login, day | Auto MV | Live |
| `gh_repo_actor_pr_stats` | ReplacingMergeTree | Per-actor PR metrics (opened, merged, closed). ORDER BY (actor_login, fetched_at). | actor_login | Manual refresh task | Live |

### System / Telemetry

| Name | Engine | Purpose | Migration | Status |
|---|---|---|---|---|
| `subagent_runs` | MergeTree | Agent execution telemetry (session, spec, latency, tokens, cost, eval). ORDER BY (session_id, ts). | `20260720000010_subagent_telemetry.sql` | Live |
| `subagent_evals` | MergeTree | Manual eval scores keyed by (spec_hash, result_hash). ORDER BY (spec_hash, scored_at). | `20260720000010_subagent_telemetry.sql` | Live |
| `subagent_api_events` (optional) | MergeTree | OpenTelemetry bridge events (low-fidelity fallback). | `20260720000010_subagent_telemetry.sql` | Optional |
| `session_learnings` | MergeTree | Structured post-run learnings from agent analysis. ORDER BY (session_id, created_at). | `20260721000016_session_learnings.sql` | Live |

---

## Materialized Views

| Name | Source | Target | Purpose | Migration | Status |
|---|---|---|---|---|
| `hn_hourly_mv` | `hackernews` | `hn_hourly` | Count stories/comments per hour and author uniques. Auto-fed by MV trigger. | `20260717000002_rollups.sql` | Live |
| `gh_repo_hourly_mv` | `github_events` | `gh_repo_hourly` | Hourly event + actor counts per repo. Auto-fed. | `20260717000002_rollups.sql` | Live |
| `gh_repo_drilldown_hourly_mv` | `github_events` | `gh_repo_drilldown_hourly` | Hourly KPI rollup for repo drill-down. | `20260721000018_repo_drilldown_aggregates.sql` | Live |
| `gh_repo_actor_hourly_mv` | `github_events` | `gh_repo_actor_hourly` | Hourly contribution slices per actor. | `20260721000018_repo_drilldown_aggregates.sql` | Live |
| `gh_repo_activity_feed_mv` | `github_events` | `gh_repo_activity_feed` | Latest PushEvent/PullRequestEvent rows per repo. | `20260721000014_gh_repo_activity_feed.sql` | Live |
| `gh_repo_actor_daily_mv` | `github_events` | `gh_repo_actor_daily` | Daily contribution stats per actor. | `20260720000012_gh_actor_daily_rollup.sql` | Live |

---

## Views (non-materialized)

| Name | Source | Purpose | Migration | Status |
|---|---|---|---|---|
| `subagent_experiments` | `subagent_runs`, `subagent_evals` | Experiment bank surface: task + eval scores, deduplicated by spec/result hash. | `20260720000013_subagent_telemetry_tokens.sql` | Live |

---

## Skipping Indices

All indices added via goose; production application requires human review + `./scripts/migrate.sh up`.

### By Table

#### `github_events`

| Index Name | Column(s) | Type | Granularity | Purpose | Migration | Status |
|---|---|---|---|---|---|---|
| `idx_github_events_created_at` | `created_at` | minmax | 4 | Time window pruning (24h/7d/30d rollup filters) | `20260723000001_time_and_event_skipping_indexes.sql` | Live |
| `idx_github_events_repo_name` | `repo_name` | set(100) | 4 | Repo point/range lookups (drilldown, per-repo analysis) | `20260723000001_time_and_event_skipping_indexes.sql` | Live |
| `idx_github_events_actor_login` | `actor_login` | bloom_filter | 4 | Bot detection (ILIKE '%[bot]%') + contributor exact matches | `20260723000002_github_events_data_skipping_indices.sql` | Pending human review |
| `idx_github_events_owner` | `owner` (materialized) | set(100) | 4 | Org-level drilldown/rollup (derived from repo_name split) | `20260723000002_github_events_data_skipping_indices.sql` | Pending human review |

#### `hackernews`

| Index Name | Column(s) | Type | Granularity | Purpose | Migration | Status |
|---|---|---|---|---|---|---|
| `idx_hn_time` | `time` | minmax | 4 | 6h/24h story velocity filtering | `20260723000001_time_and_event_skipping_indexes.sql` | Live |

#### `gh_repo_hourly`

| Index Name | Column(s) | Type | Granularity | Purpose | Migration | Status |
|---|---|---|---|---|---|---|
| `idx_hourly_hour` | `hour` | minmax | 4 | 24h/7d/30d rollup window pruning (global time filters) | `20260723000001_time_and_event_skipping_indexes.sql` | Live |

#### `gh_repo_activity_feed`

| Index Name | Column(s) | Type | Granularity | Purpose | Migration | Status |
|---|---|---|---|---|---|---|
| `idx_feed_created` | `created_at` | minmax | 4 | Time window filtering for feed display | Planned | Planned |

---

## Columns (Materialized)

### `github_events`

| Column | Type | Purpose | Migration | Status |
|---|---|---|---|---|
| `owner` | String | Organization/owner derived from `splitByChar('/', repo_name)[1]` for org-level aggregation. Empty default. | `20260723000002_github_events_data_skipping_indices.sql` | Pending human review |

---

## Planned Aggregates (Issue #3 Checklist)

- [ ] `gh_repo_daily` / `gh_repo_monthly` — time-bucketed trends with SummingMergeTree
- [ ] `headline` table + `headline_mv` — briefing surface (computed headlines on open, scheduled task + LLM)
- [ ] `watchlist` table — user watch lists with REST poller for per-repo precision (GH Archive is discovery-only)
- [ ] `repo_metrics` — static repo metadata + computed trend measures

---

## Backfill Procedure (New MV Standard)

When a new MV is created:

1. **Create MV in goose migration** (declares MV structure + target table)
2. **Manual backfill**: In a separate task or one-off query, `INSERT INTO target_table SELECT ... FROM source_table WHERE conditions`
3. **MV activation**: Forward-inserts only (post-creation rows)
4. **Idempotency**: For AggregatingMergeTree, use `DELETE + reinsert` pattern (never double-count); for SummingMergeTree, reinserts are safe (sums aggregate correctly)

---

## Performance Audit Trail

See `docs/architecture/EXPLAIN-QUERY-AUDIT.md` for query-by-query performance findings and index tuning decisions. Every new index or materialized column should include `EXPLAIN indexes = 1` benchmarks in the PR body.

---

## Notes for Implementation

- **GRANULARITY tuning**: Currently set to 4 across all indices. Adjust downward (2) if pruning is weak on high-cardinality filters; adjust upward (8+) if index materialization is slow and selectivity is high.
- **Owner column mutation**: The UPDATE statement in `20260723000002_github_events_data_skipping_indices.sql` runs asynchronously. Check `system.mutations` to monitor progress.
- **Production DDL safety**: All migrations in this registry require human review before `./scripts/migrate.sh up` is executed on ClickHouse Cloud production.
