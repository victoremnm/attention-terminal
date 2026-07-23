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
