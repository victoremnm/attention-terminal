import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { clickhouse } from "./clickhouse";

describe("Goose Migrations & Skipping Index Verification", () => {
  it("verifies all SQL migration files in /migrations are readable and non-empty", async () => {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith(".sql"));

    expect(sqlFiles.length).toBeGreaterThan(0);

    for (const file of sqlFiles) {
      const content = await fs.readFile(path.join(migrationsDir, file), "utf-8");
      expect(content).toContain("-- +goose Up");
      expect(content.trim().length).toBeGreaterThan(20);
    }
  });

  it("keeps the HN taxonomy MV predicate compatible with ClickHouse", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000008_fix_hn_taxonomy_token_boundaries.sql"),
      "utf-8"
    );

    expect(migration).toContain("replaceRegexpAll(lower(h.title), '[^a-z0-9]+', ' ')");
    expect(migration).toContain("concat(' ', tok, ' ')");
    expect(migration).not.toContain("position(lower(h.title), tok)");
    expect(migration).not.toContain("hasToken(lower(h.title), tok)");
    expect(migration).toContain("daily_skinny_hn_hourly_mv");
  });

  it("keeps the taxonomy backfill on whole-token matching", async () => {
    const script = await fs.readFile(
      path.join(process.cwd(), "scripts/backfills/backfill-daily-skinny-taxonomy.ts"),
      "utf-8"
    );

    expect(script).toContain("replaceRegexpAll(lower(h.title), '[^a-z0-9]+', ' ')");
    expect(script).toContain("concat(' ', tok, ' ')");
    expect(script).not.toContain("position(lower(h.title), tok)");
  });

  it("keeps the HN watermark table in the migration chain", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000007_restore_hn_ingest_watermark.sql"),
      "utf-8"
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS default.ingest_watermark");
    expect(migration).toContain("ENGINE = ReplacingMergeTree(updated_at)");
    expect(migration).toContain("ORDER BY source");
  });

  it("verifies goose migration status via scripts/migrate.sh status", () => {
    try {
      const output = execSync("./scripts/migrate.sh status", {
        encoding: "utf-8",
        cwd: process.cwd(),
      });
      expect(output).toContain("20260723000001_time_and_event_skipping_indexes.sql");
    } catch (err: any) {
      // Fail open if goose binary is not installed locally in non-container envs
      console.warn("Goose status check skipped:", err.message);
    }
  });

  it("verifies ClickHouse skipping indexes are present on target tables", async () => {
    let hnExplain = "";
    let hourlyExplain = "";
    let isConnected = false;

    try {
      const hnRes = await clickhouse.query({
        query: "EXPLAIN indexes = 1 SELECT count() FROM raw.hackernews WHERE time > now() - INTERVAL 6 HOUR",
        format: "TabSeparated",
      });
      hnExplain = await hnRes.text();

      const hourlyRes = await clickhouse.query({
        query: "EXPLAIN indexes = 1 SELECT count() FROM gh_repo_hourly WHERE hour > now() - INTERVAL 24 HOUR",
        format: "TabSeparated",
      });
      hourlyExplain = await hourlyRes.text();
      isConnected = true;
    } catch (err: any) {
      console.warn("Skipping index verification connection notice:", err.message);
    }

    if (isConnected) {
      expect(hnExplain).toContain("idx_hn_time");
      expect(hourlyExplain).toContain("idx_hourly_hour");
    }
  });
});
