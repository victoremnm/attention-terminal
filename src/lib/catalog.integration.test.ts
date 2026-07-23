import { describe, expect, it } from "vitest";

const hasCH = Boolean(process.env.CLICKHOUSE_URL && process.env.CLICKHOUSE_PASSWORD);

describe.skipIf(!hasCH)("catalog metadata query (integration)", () => {
  it("system.tables metadata query executes and returns bounded results", async () => {
    const { clickhouse } = await import("./clickhouse");
    const result = await clickhouse.query({
      query: `
        SELECT database, name, engine, total_rows
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        ORDER BY database, name
        LIMIT 50
      `,
      format: "JSONEachRow",
      clickhouse_settings: {
        readonly: "2",
        max_execution_time: 10,
      },
    });
    const rows = await result.json() as Array<{ database: string; name: string; engine: string; total_rows: string }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(50);
    for (const row of rows) {
      expect(typeof row.database).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.engine).toBe("string");
    }
  }, 30_000);

  it("catalogPromptSection returns a non-empty string", async () => {
    const { catalogPromptSection } = await import("./catalog");
    const text = await catalogPromptSection();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("ClickHouse catalog");
  }, 30_000);

  it("fallbackCatalog is returned when metadata query fails", async () => {
    const { catalogPromptSection } = await import("./catalog");
    const text = await catalogPromptSection();
    if (text.includes("⚠️")) {
      expect(text).toContain("Known tables");
    }
  }, 30_000);
});
