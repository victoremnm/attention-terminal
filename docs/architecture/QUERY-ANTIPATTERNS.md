# ClickHouse Query Antipatterns, Query Tags, and Query-Log Review

## Why this exists

Issue #236 surfaced a repeated failure mode: a handful of raw-table query shapes
were both expensive and easy for the agent to regenerate. The fix is to catch
the known timeout shapes before execution, and to tag every agent-issued
ClickHouse query so it can be traced back from `system.query_log`.

## Runtime flow

1. `runReadOnlyQuery` and `runDataRetrieval` normalize bare `UNION` to
   `UNION ALL`.
2. Both paths run the SQL string through `analyzeQueryAntipatterns()`.
3. P1 findings are blocked before the query hits ClickHouse.
4. Successful queries are executed with a stable `query_id` and a
   `log_comment` built by `buildLogComment()`.
5. `/analysis` lazy-loads the Query Performance tab from
   `system.query_log` only when the tab is opened.

## `log_comment` contract

The tag format is intentionally simple and parseable:

```text
attn | run=<runId> | chat=<chatId> | turn=<turn> | step=<step> | tool=<toolName> | surface=<surface> | qid=<queryId>
```

Fields are optional except for the `attn` prefix. The current implementation
uses the stable `tool`, `surface`, and `qid` parts for query-tool execution.

## Query Performance tab

The dashboard reads a bounded, recent slice of `system.query_log` on demand.
That keeps the main `/analysis` payload small while still surfacing:

- query duration
- rows read
- bytes read
- result rows
- memory usage
- parsed attention tags
- local antipattern badges

This is intentionally read-only and lazy. Per-row `EXPLAIN indexes = 1`
inspection can be added later as a drill-down, but it is not part of the
initial fetch path because the issue explicitly asked to keep capture efficient.

