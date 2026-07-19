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

## ClickHouse Design Notes

Per ClickHouse primary-key guidance, table materializations should declare `ORDER BY` around frequent filters before creation because sorting keys are not practically mutable later. Dimensions use low-cardinality leading keys where possible, and repeated categorical strings should use `LowCardinality` in physical migrations.

dbt views are intentionally used for the first fact layer to avoid costly full table rebuilds over large raw feeds. Once a mart proves stable, promote it to an incremental/table materialization with an explicit `ORDER BY` and, if lifecycle management is needed, a bounded date partition.
