import { describe, expect, it } from "vitest";
import { summarizeQueryPerformanceForTest } from "./query-performance";

describe("query-performance", () => {
  it("summarizes captured query rows", () => {
    const summary = summarizeQueryPerformanceForTest([
      {
        event_time: "2026-07-24 00:00:00",
        query_id: "q1",
        query_type: "QueryFinish",
        log_comment: "attn | tool=runReadOnlyQuery | qid=q1",
        query: "SELECT 1",
        query_duration_ms: 100,
        read_rows: 1000,
        read_bytes: 2048,
        result_rows: 1,
        memory_usage: 4096,
        rows_per_second: 10_000,
        attention_tag: "runReadOnlyQuery",
        antipatterns: [],
      },
      {
        event_time: "2026-07-24 00:01:00",
        query_id: "q2",
        query_type: "QueryFinish",
        log_comment: "attn | tool=runDataRetrieval | qid=q2",
        query: "SELECT 2",
        query_duration_ms: 300,
        read_rows: 5000,
        read_bytes: 8192,
        result_rows: 2,
        memory_usage: 1024,
        rows_per_second: 16_666,
        attention_tag: "runDataRetrieval",
        antipatterns: ["leading-wildcard-like"],
      },
    ]);

    expect(summary).toEqual({
      queryCount: 2,
      attentionTaggedCount: 2,
      avgDurationMs: 200,
      totalReadRows: 6000,
      totalReadBytes: 10240,
      slowestDurationMs: 300,
    });
  });
});
