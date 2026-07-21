# Data Modeling

Attention Terminal uses two separate layers of structure:

- Goose migrations own physical ClickHouse objects needed by ingestion: raw tables, skip indexes, and low-latency materialized views.
- dbt owns analytical structure: staging views, conformed dimensions, facts, bridges, and product/search marts.

This is a Kimball/Inmon-style modeling boundary, not a medallion hierarchy. The question is not only how refined a table is; it is what analytical role it plays.

## Table Roles

| Prefix | Role | Owner |
| --- | --- | --- |
| `stg_` | Thin source normalization over raw ClickHouse tables | dbt |
| `dim_` | Conformed entity context such as source, repo, model | dbt |
| `fact_` | Measured activity by time grain | dbt |
| `bridge_` | Many-to-many mappings such as subject-to-repo or subject-to-document | dbt, planned |
| `mart_` | Product-facing query surfaces | dbt |

Raw source tables keep their existing names for compatibility with ingestion tasks. New product queries should prefer dbt models once they exist for the needed grain.

`hackernews` is a `ReplacingMergeTree(update_time)` that receives reinserted rows when scores or comments change. Keep `stg_hackernews_items` as a thin view over that stream, then use `stg_hackernews_items_current` whenever a consumer needs one latest row per HN item. HN facts and search documents read from the current-state model so thread counts and latest comment totals are not inflated by raw update reinsertions or the `hn_hourly` materialized view.

## dbt Boundary

Use dbt for transformations that benefit from lineage, tests, and clear model names:

- source staging
- reusable facts and dimensions
- product marts
- search/document corpora for semantic retrieval

Keep these in Goose migrations:

- raw table creation
- ingestion watermarks
- ClickHouse skip indexes
- incremental materialized views that must update synchronously with inserts

## Semantic Search Direction

The first semantic-search-ready model is `mart_attention_documents`. It normalizes HN stories, GitHub repositories, and Hugging Face models into a common document shape:

- `source_id`
- `document_id`
- `observed_at`
- `title`
- `body`
- `url`
- `embedding_text`
- `popularity_score`

The next step is to add an embeddings table keyed by `(source_id, document_id, embedding_model)` and a Trigger.dev task that embeds new or changed documents. That avoids expanding the hardcoded subject dictionary and lets Daily Skinny rank candidates from both lexical and vector retrieval.

## GitHub Trend Rollups

`gh_repo_hourly` remains the low-latency event-family rollup. `gh_repo_daily` and `gh_repo_monthly` add trend-oriented repo measures for longer windows: events, actors, pushes, commits, distinct commits, stars, forks, PRs opened/closed/merged, issues opened/closed, repository creates, branch/tag creates, and releases published.

`gh_repo_activity_feed` is a thin compatibility view over `github_events` for repo drill-down and ad-hoc agent SQL. It exists to give prompt-generated queries a stable object name without introducing another physical storage layer.

The dbt `mart_repo_activity_timeseries` model exposes those measures with a `day` or `month` grain, so product surfaces can switch time windows without rewriting measure logic.

## ClickHouse Design Notes

Per ClickHouse primary-key guidance, table materializations should declare `ORDER BY` around frequent filters before creation because sorting keys are not practically mutable later. Dimensions use low-cardinality leading keys where possible, and repeated categorical strings should use `LowCardinality` in physical migrations.

dbt views are intentionally used for the first fact layer to avoid costly full table rebuilds over large raw feeds. Once a mart proves stable, promote it to an incremental/table materialization with an explicit `ORDER BY` and, if lifecycle management is needed, a bounded date partition.
