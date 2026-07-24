import { describe, expect, it, vi } from "vitest";
import { analyzeQueryAntipatterns } from "./query-antipatterns";
import {
  blockAntipatternsIfPresent,
  executeTaggedJsonEachRowQuery,
  normalizeUnionQuery,
} from "./query-execution";

describe("query-execution", () => {
  it("normalizes bare UNION to UNION ALL while preserving quoted literals", () => {
    const sql = `SELECT 'UNION' AS label UNION SELECT 1`;
    expect(normalizeUnionQuery(sql)).toBe(`SELECT 'UNION' AS label UNION ALL SELECT 1`);
  });

  it("blocks known timeout-causing antipatterns", () => {
    const sql = `SELECT * FROM hackernews WHERE title LIKE '%htmx%'`;
    expect(analyzeQueryAntipatterns(sql).some((hit) => hit.id === "leading-wildcard-like")).toBe(true);
    expect(blockAntipatternsIfPresent(sql)).toMatch(/antipattern analyzer/i);
  });

  it("tags queries with a stable query_id and log_comment", async () => {
    const query = vi.fn().mockResolvedValue({
      json: async () => [{ ok: 1 }],
      response_headers: { "x-clickhouse-summary": JSON.stringify({ read_rows: "17" }) },
    });
    const client = { query };

    const result = await executeTaggedJsonEachRowQuery<{ ok: number }>(client, "SELECT 1", {
      queryId: "query-123",
      logComment: { toolName: "runReadOnlyQuery", surface: "read-only-query" },
      maxExecutionTime: 30,
      maxResultRows: "1000",
      resultOverflowMode: "break",
    });

    expect(result.queryId).toBe("query-123");
    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(result.rowsRead).toBe(17);
    expect(result.elapsedMs).toEqual(expect.any(Number));
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT 1",
        query_id: "query-123",
        clickhouse_settings: expect.objectContaining({
          readonly: "2",
          max_execution_time: 30,
          max_result_rows: "1000",
          result_overflow_mode: "break",
          log_comment: "attn | tool=runReadOnlyQuery | surface=read-only-query | qid=query-123",
        }),
      }),
    );
  });
});
