import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  missingTables: vi.fn(),
  missingColumns: vi.fn(),
}));

vi.mock("./clickhouse", () => ({
  clickhouse: { query: mocks.query },
  missingTables: mocks.missingTables,
  missingColumns: mocks.missingColumns,
}));

import { fetchQueryPerformanceData, summarizeQueryPerformanceForTest } from "./query-performance";

describe("query-performance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.missingTables.mockResolvedValue([]);
    mocks.missingColumns.mockResolvedValue([]);
  });

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

  it("returns only attention-tagged query log rows", async () => {
    mocks.query.mockResolvedValue({
      json: async () => [
        {
          event_time: "2026-07-24 00:00:00",
          query_id: "attention-query",
          query_type: "QueryFinish",
          log_comment: "attn | tool=runReadOnlyQuery | qid=attention-query",
          query: "SELECT secret FROM attention_data",
          query_duration_ms: "100",
          read_rows: "10",
          read_bytes: "20",
          result_rows: "1",
          memory_usage: "30",
        },
        {
          event_time: "2026-07-24 00:00:01",
          query_id: "unrelated-query",
          query_type: "QueryFinish",
          log_comment: "",
          query: "SELECT secret FROM unrelated_data",
          query_duration_ms: "200",
          read_rows: "20",
          read_bytes: "40",
          result_rows: "2",
          memory_usage: "60",
        },
      ],
    });

    const payload = await fetchQueryPerformanceData();

    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]?.query_id).toBe("attention-query");
    expect(payload.rows[0]?.query).toBe("SELECT secret FROM attention_data");
    expect(String(mocks.query.mock.calls[0]?.[0]?.query)).toContain("startsWith(log_comment, 'attn')");
  });

  it("returns the empty payload when required query log metadata is unavailable", async () => {
    mocks.missingTables.mockRejectedValue(new Error("system.tables unavailable"));

    const payload = await fetchQueryPerformanceData();

    expect(payload.rows).toEqual([]);
    expect(payload.summary).toEqual({
      queryCount: 0,
      attentionTaggedCount: 0,
      avgDurationMs: 0,
      totalReadRows: 0,
      totalReadBytes: 0,
      slowestDurationMs: 0,
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns the empty payload when a required query log column is missing", async () => {
    mocks.missingColumns.mockResolvedValue(["log_comment"]);

    const payload = await fetchQueryPerformanceData();

    expect(payload.rows).toEqual([]);
    expect(payload.summary.queryCount).toBe(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
