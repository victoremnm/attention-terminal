import { describe, expect, it } from "vitest";

const hasCH = Boolean(process.env.CLICKHOUSE_URL && process.env.CLICKHOUSE_PASSWORD);

/** Fetch one Replacing-like table from the live catalog */
async function pickReplacingTable() {
  const { clickhouse } = await import("./clickhouse");
  const result = await clickhouse.query({
    query: `
      SELECT database, name, engine
      FROM system.tables
      WHERE (engine = 'ReplacingMergeTree'
             OR engine LIKE 'Replicated%ReplacingMergeTree'
             OR engine LIKE 'Shared%ReplacingMergeTree')
        AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      ORDER BY database, name
      LIMIT 1
    `,
    format: "JSONEachRow",
    clickhouse_settings: { readonly: "2", max_execution_time: 10 },
  });
  return (await result.json()) as Array<{ database: string; name: string; engine: string }>;
}

describe.skipIf(!hasCH)("sql-catalog-guard FINAL handling (integration)", () => {
  it("FINAL after alias executes successfully (FROM t AS alias FINAL)", async () => {
    const rows = await pickReplacingTable();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const { database, name } = rows[0];

    const { clickhouse } = await import("./clickhouse");
    const result = await clickhouse.query({
      query: `SELECT count() FROM ${database}.${name} AS t FINAL`,
      format: "JSONEachRow",
      clickhouse_settings: { readonly: "2", max_execution_time: 30 },
    });
    const vals = await result.json<{ "count()": string }>();
    expect(vals.length).toBe(1);
    expect(Number(vals[0]["count()"])).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("FINAL before alias is rejected by ClickHouse (FROM t FINAL AS alias)", async () => {
    const rows = await pickReplacingTable();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const { database, name } = rows[0];

    const { clickhouse } = await import("./clickhouse");
    await expect(
      clickhouse.query({
        query: `SELECT count() FROM ${database}.${name} FINAL AS t`,
        format: "JSONEachRow",
        clickhouse_settings: { readonly: "2", max_execution_time: 30 },
      })
    ).rejects.toThrow();
  }, 30_000);

  it("requireFinalOnReplacingTables flags query with FINAL before alias", async () => {
    const rows = await pickReplacingTable();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const { database, name, engine } = rows[0];
    const fullName = `${database}.${name}`;

    const { registerCatalogTables, resetCatalogState, requireFinalOnReplacingTables } = await import(
      "./sql-catalog-guard"
    );
    resetCatalogState();
    registerCatalogTables([{ database, name, engine }]);

    const missing = requireFinalOnReplacingTables(
      `SELECT * FROM ${fullName} FINAL AS m WHERE 1=1`
    );
    expect(missing).toEqual([fullName]);
  }, 30_000);

  it("requireFinalOnReplacingTables accepts FINAL after alias", async () => {
    const rows = await pickReplacingTable();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const { database, name, engine } = rows[0];
    const fullName = `${database}.${name}`;

    const { registerCatalogTables, resetCatalogState, requireFinalOnReplacingTables } = await import(
      "./sql-catalog-guard"
    );
    resetCatalogState();
    registerCatalogTables([{ database, name, engine }]);

    const missing = requireFinalOnReplacingTables(
      `SELECT * FROM ${fullName} AS m FINAL WHERE 1=1`
    );
    expect(missing).toEqual([]);
  }, 30_000);
});
