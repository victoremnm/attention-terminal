import { describe, expect, it, vi } from "vitest";

const mockQuery = vi.hoisted(() => vi.fn());
const mockCreateClient = vi.hoisted(() => vi.fn(() => ({ query: mockQuery })));

vi.mock("@clickhouse/client", () => ({
  createClient: mockCreateClient,
}));

import {
  FALLBACK_TABLES,
  LIST_TABLES_SQL,
  listTables,
  resetCatalogState,
  TABLE_LIST_TIMEOUT_MS,
  buildMorphingCard,
} from "./agent-tools";

describe("listTables tool", () => {
  it("returns bounded system.tables metadata with provenance timing", async () => {
    resetCatalogState();
    mockQuery.mockResolvedValueOnce({
      json: async () => [
        { database: "default", name: "github_events", engine: "MergeTree", total_rows: "1000", size: "1 MB" },
        { database: "default", name: "gh_repo_metadata", engine: "ReplacingMergeTree", total_rows: "50", size: "100 KB" },
      ],
    });

    const res = await (listTables as any).execute({});

    expect(res.tables).toHaveLength(2);
    expect(res.tables[0]).toEqual({
      database: "default",
      name: "github_events",
      engine: "MergeTree",
      total_rows: "1000",
      size: "1 MB",
    });
    expect(res.provenance).toMatchObject({
      sql: LIST_TABLES_SQL,
      rowsReturned: 2,
      tables: ["system.tables"],
    });
    expect(typeof res.provenance.elapsedMs).toBe("number");
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ request_timeout: TABLE_LIST_TIMEOUT_MS })
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: LIST_TABLES_SQL,
        abort_signal: expect.any(AbortSignal),
        clickhouse_settings: {
          readonly: "2",
          max_execution_time: 5,
        },
      })
    );
  });

  it("returns fallback catalog gracefully when ClickHouse metadata query fails", async () => {
    resetCatalogState();
    mockQuery.mockRejectedValueOnce(new Error("ClickHouse connection timeout"));

    const res = await (listTables as any).execute({});

    expect(res.isFallback).toBe(true);
    expect(res.tables).toEqual(FALLBACK_TABLES);
    expect(res.note).toContain("ClickHouse system.tables query failed or timed out");
    expect(res.provenance).toMatchObject({
      sql: LIST_TABLES_SQL,
      rowsReturned: 0,
      tables: ["system.tables"],
    });
    expect(typeof res.provenance.elapsedMs).toBe("number");
  });
});

describe("buildMorphingCard", () => {
  it("builds a valid morphing-card payload from row objects", async () => {
    const rows = [
      { repo_name: "acme/widgets", stars: 500 },
      { repo_name: "acme/gizmos", stars: 210 },
    ];
    const result = await (buildMorphingCard as any).execute({
      rows,
      visualizationType: "Bar Chart",
    });
    expect(result.type).toBe("morphing-card");
    expect(result.visualizationType).toBe("Bar Chart");
    expect(result.chartConfig.data.values).toEqual(rows);
    expect(result.chartConfig.encoding.tooltip).toEqual([
      { field: "repo_name", title: "Repo Name" },
      { field: "stars", title: "Stars" },
    ]);
  });

  it("respects explicit column definitions when provided", async () => {
    const rows = [{ a: 1, b: 2 }];
    const result = await (buildMorphingCard as any).execute({
      rows,
      columns: [{ field: "a", title: "Custom A" }],
      visualizationType: "Data Table",
    });
    expect(result.chartConfig.encoding.tooltip).toEqual([{ field: "a", title: "Custom A" }]);
  });

  it("humanizes column names from snake_case to Title Case", async () => {
    const rows = [{ first_name: "Alice", last_updated: "2024-07-23" }];
    const result = await (buildMorphingCard as any).execute({
      rows,
      visualizationType: "Data Table",
    });
    expect(result.chartConfig.encoding.tooltip).toEqual([
      { field: "first_name", title: "First Name" },
      { field: "last_updated", title: "Last Updated" },
    ]);
  });

  it("includes optional summary and query when provided", async () => {
    const rows = [{ x: 1 }];
    const summary = "Test summary";
    const query = { sql: "SELECT * FROM test", rowsRead: 1, elapsedMs: 100 };
    const result = await (buildMorphingCard as any).execute({
      rows,
      visualizationType: "Data Table",
      summary,
      query,
    });
    expect(result.summary).toBe(summary);
    expect(result.query).toEqual(query);
  });

  it("sets generatedAt to a valid ISO string", async () => {
    const rows = [{ x: 1 }];
    const result = await (buildMorphingCard as any).execute({
      rows,
      visualizationType: "Data Table",
    });
    expect(result.generatedAt).toBeTruthy();
    expect(() => new Date(result.generatedAt)).not.toThrow();
  });
});
