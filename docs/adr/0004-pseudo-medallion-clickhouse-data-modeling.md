# ADR 0004: Pseudo-Medallion Architecture & Dataset Triangulation Trade-offs

- **Status**: Accepted
- **Date**: 2026-07-23
- **Context**: ClickHouse OLAP Data Modeling & Ingestion Strategy

## Context & Problem Statement
During initial design, we evaluated two primary data integration strategies:
1. **Hacker News + GitHub Triangulation**: Attempting to cross-reference Hacker News stories/comments with GitHub repository events to correlate social buzz with code commits.
2. **Data Warehouse Modeling Strategy**: Choosing between traditional Kimball dimensional modeling (star schema with facts and dimensions) vs. a real-time columnar **Pseudo-Medallion Architecture** in ClickHouse.

## Decision Drivers

### 1. Dataset Shape & Triangulation Rationale
- **Hacker News Limitations**: Hacker News payloads consist of unstructured text titles and comment threads with minimal dimensional structure (`id`, `by`, `score`, `title`, `url`). Triangulating HN stories to GitHub repos required fragile string matching on URLs/names and yielded noisy, sparse signals.
- **GitHub Event Stream Richness**: The GitHub Archive event stream provides rich, strongly-typed facts across multiple native dimensions (`repo`, `actor`, `org`, `created_at`) and granular event shapes (`PushEvent`, `PullRequestEvent`, `IssuesEvent`, `WatchEvent`, `ForkEvent`).
- **HuggingFace Exploration (Deferred)**: Evaluated integrating HuggingFace models, datasets, and spaces metadata to correlate ML model trends with GitHub repositories. Deferred for lack of discovery time; model-weight releases are largely orthogonal to source-commit velocity, though relevant for AI-repository tracking.
- **Google Places API (Deferred)**: Evaluated the Google Places / Maps API to render geographical contributor maps or physical event heatmaps. Deferred because physical location is a poor fit for core telemetry metrics, which prioritize repository speed, star breakouts, and commit deltas.

<!-- TODO(claude-review): this framing contradicts docs/data/modeling.md, which documents a real dbt Kimball layer (dim_repo, dim_source, fact_repo_activity_daily, fact_talk_activity_hourly, etc. under models/marts/core/) that coexists with this medallion layer -- Goose owns the raw/medallion tables, dbt owns the dim_/fact_ analytical layer on top. This section's claim of having rejected Kimball star-schema modeling outright is inaccurate; the actual decision is closer to "medallion for low-latency ingestion, Kimball via dbt for analytical marts on top." This is a content/thesis question for a human to resolve, not a prose fix. -->
### 2. Pseudo-Medallion Architecture vs. Kimball Modeling
For the low-latency ingestion and rollup layer (owned by Goose migrations), we chose a high-performance **Pseudo-Medallion Architecture** optimized for ClickHouse columnar execution over a traditional Kimball star schema at that layer:

```mermaid
flowchart TD
    BRONZE["Bronze Layer (Raw Facts)\ngithub_events / hackernews\n(Append-only raw event stream)"] --> SILVER
    SILVER["Silver Layer (Cleansed Facts & Indexes)\nFiltered bot accounts (lower(actor) NOT LIKE)\nSkipping indexes (idx_github_events_actor_login)"] --> GOLD
    GOLD["Gold Layer (Rollup Projections)\n_hourly, _daily, _monthly AggregatingMergeTrees\ngh_repo_activity_feed_mv / gh_repo_daily_mv / gh_repo_monthly_mv"]
```

- **Bronze Layer (Raw Ingestion)**: Append-only `github_events` table capturing raw JSON event payloads at high throughput.
- **Silver Layer (Cleansed Facts & Skipping Indexes)**: Deduplicated event facts with `lower(actor_login)` skip index filtering to remove bot traffic (`[bot]`, `copilot`, `dependabot`).
- **Gold Layer (AggregatingMergeTree Rollups)**: Continuous rollups pre-computed into `_hourly`, `_daily`, and `_monthly` `AggregatingMergeTree` tables via Materialized Views (`gh_repo_activity_feed_mv`, `gh_repo_daily_mv`, `gh_repo_monthly_mv`), reducing query scan sizes by orders of magnitude versus scanning `github_events` directly.

### 3. Goose Schema Migration System
To manage DDL changes safely across environments without ad-hoc DDL queries, all schema changes are managed via **Goose DDL migrations** (`migrations/*.sql` + `./scripts/migrate.sh`) integrated into automated CD workflows on merge to `main`.

## Decision Outcome
Accepted. The Pseudo-Medallion pattern combined with Goose DDL migrations delivers sub-second query performance across tens of millions of GitHub events while avoiding join penalties.
