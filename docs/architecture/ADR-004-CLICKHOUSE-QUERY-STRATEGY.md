# ADR-004: ClickHouse Data Retrieval Query Strategy & UNION Normalization

## Status
Accepted

## Context
When performing multi-table or multi-period retrieval in ClickHouse (e.g. via `runDataRetrievalAgent`), generated SQL queries may utilize `UNION` operators to combine results across datasets (such as GitHub events and Hacker News posts).

In ClickHouse, a bare `UNION` (without an explicit `ALL` or `DISTINCT` modifier) causes a execution error if the database server's `union_default_mode` setting is unset. In PR #178, an executor-level setting `union_default_mode=ALL` was added. Issue #179 asks us to evaluate whether:
1. Executor-side settings (`union_default_mode=ALL`) are sufficient,
2. SQL generator/sanitizer prompt & normalization rules should explicitly convert bare `UNION` -> `UNION ALL`, or
3. Application-layer multi-query decomposition & merging should be used.

## Decision & Evaluation

### 1. Architectural Comparison

| Strategy | Tradeoffs & Evaluation | Recommendation |
| :--- | :--- | :--- |
| **Option A: Executor-side setting only (`union_default_mode=ALL`)** | Single point of configuration, but relies on server settings that may be ignored by certain ClickHouse driver versions or proxy layers. | Kept as a **defensive fallback layer**. |
| **Option B: Explicit SQL Generation + Normalization (`UNION ALL`)** | Guarantees self-contained, portable SQL queries that run deterministically across all ClickHouse environments without relying on server-side defaults. Low complexity, high performance, single round-trip. | **SELECTED AS PRIMARY STRATEGY**. |
| **Option C: Application-Layer Multi-Query Decomposition** | Increases HTTP round-trip latency (N queries instead of 1), requires complex schema-merging logic in JS, and loses ClickHouse's vector processing capabilities. | Rejected for core data retrieval; reserved only for independent async micro-surfaces. |

### 2. Implementation Rules

1. **System Prompt Constraint**: The `data-retrieval-agent` system prompt explicitly instructs the model to use `UNION ALL` or `UNION DISTINCT` explicitly, never bare `UNION`.
2. **SQL Normalizer**: A deterministic regex sanitizer (`normalizeUnionQuery`) converts any remaining bare `UNION` occurrences into `UNION ALL` prior to execution.
3. **Defensive Executor Settings**: ClickHouse client execution settings continue to include `union_default_mode: "ALL"` as a second line of defense.

## Consequences
- Zero execution errors due to ambiguous `UNION` syntax across all ClickHouse configurations.
- Preserves single round-trip performance and vector execution speed.
- Fully documented and tested via unit tests in `src/lib/agents/data-retrieval-agent.test.ts`.
