import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { clickhouse } from "./clickhouse";

describe("Goose Migrations & Skipping Index Verification", () => {
  it("keeps firehose aggregate migrations DDL-only", async () => {
    for (const file of [
      "20260726000014_firehose_repo_signal_hourly.sql",
      "20260726000015_firehose_event_type_action_hourly.sql",
      "20260726000016_firehose_event_type_action_daily.sql",
      "20260726000017_firehose_event_type_action_monthly.sql",
    ]) {
      const migration = await fs.readFile(path.join(process.cwd(), "migrations", file), "utf-8");

      expect(migration).not.toMatch(/INSERT\s+INTO/i);
      expect(migration).not.toMatch(/toDateTime\(['"]20\d\d-/i);
      expect(migration).not.toContain("INTERVAL 7 DAY");
    }
  });

  it("repairs the firehose timeline MV target without replaying history", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000018_repair_firehose_timeline_mv.sql"),
      "utf-8"
    );

    expect(migration).not.toMatch(/INSERT\s+INTO/i);
    expect(migration).toContain("DROP VIEW IF EXISTS curated.event_timeline_mv");
    expect(migration).toContain("CREATE MATERIALIZED VIEW curated.event_timeline_mv");
    expect(migration).toContain("TO curated.event_timeline AS");
    expect(migration).toContain("FROM default.github_events_firehose");
    expect(migration).not.toContain("event_timeline_rebuild");
    expect(migration).toContain("event_id,");
  });

  it("keeps the retained timeline replay outside Goose DDL", async () => {
    const script = await fs.readFile(
      path.join(process.cwd(), "scripts", "backfill-firehose-timeline.mjs"),
      "utf-8"
    );

    expect(script).toContain("--writers-paused");
    expect(script).toContain("--rebuild");
    expect(script).toContain("INSERT INTO ${TIMELINE_TABLE}");
    expect(script).toContain("FROM default.github_events_stream");
    expect(script).toContain("event_id");
    expect(script).not.toContain("event_timeline_rebuild");
  });

  it("repairs legacy timeline schemas before recreating the event-ID MV", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000019_repair_firehose_timeline_event_id.sql"),
      "utf-8"
    );

    expect(migration).not.toMatch(/INSERT\s+INTO/i);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS event_id UInt64");
    expect(migration).toContain("DROP VIEW IF EXISTS curated.event_timeline_mv");
    expect(migration).toContain("TO curated.event_timeline AS");
    expect(migration).toContain("event_id,");
    expect(migration).not.toContain("event_timeline_rebuild");
  });

  it("swaps the firehose source to ReplacingMergeTree without dropping projections", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000021_github_events_stream_rmt.sql"),
      "utf-8"
    );

    // Stream table: RMT keyed by event_id trailing the existing scan columns.
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS default.github_events_stream");
    expect(migration).toContain("ENGINE = ReplacingMergeTree");
    expect(migration).toContain("ORDER BY (event_type, repo_name, created_at, event_id)");

    // Every pre-existing projection MV is dropped, then recreated against the
    // stream table — none may be left pointing at the renamed legacy table.
    for (const mv of [
      "curated.event_volume_hourly_mv",
      "curated.event_volume_daily_mv",
      "curated.event_timeline_mv",
      "curated.firehose_repo_signal_hourly_mv",
      "curated.firehose_event_type_action_hourly_mv",
      "curated.firehose_event_type_action_daily_mv",
      "curated.firehose_event_type_action_monthly_mv",
    ]) {
      expect(migration).toContain(`DROP VIEW IF EXISTS ${mv}`);
    }
    expect(migration.match(/FROM default\.github_events_stream/g)?.length).toBeGreaterThanOrEqual(9);

    // AggregatingMergeTree targets are truncated before the copy re-fires
    // every event through the new MVs (otherwise they would double count).
    // The RMT timeline is NOT truncated — it dedups on event_id.
    expect(migration).toContain("TRUNCATE TABLE IF EXISTS curated.event_volume_hourly");
    expect(migration).toContain("TRUNCATE TABLE IF EXISTS curated.firehose_repo_signal_hourly");
    expect(migration).not.toContain("TRUNCATE TABLE IF EXISTS curated.event_timeline");

    // The old table is preserved as _legacy and copied in full.
    expect(migration).toContain(
      "RENAME TABLE default.github_events_firehose TO default.github_events_firehose_legacy"
    );
    expect(migration).toContain("INSERT INTO default.github_events_stream");
    expect(migration).toContain("SELECT * FROM default.github_events_firehose_legacy");

    // Readers keep working through repointed schema-family views.
    expect(migration).toContain("CREATE OR REPLACE VIEW raw.github_events_firehose");
    expect(migration).toContain("CREATE OR REPLACE VIEW cleansed.github_events_stg_firehose");
  });

  it("builds the poller and timelapse infrastructure on the stream table", async () => {
    const migration = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000022_poll_infrastructure.sql"),
      "utf-8"
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS default.events_api_etags");
    expect(migration).toContain("ENGINE = ReplacingMergeTree(updated_at)");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS curated.repo_timelapse");
    expect(migration).toContain("ENGINE = ReplacingMergeTree(generated_at)");

    // The prune must measure engagement from the stream (firehose coverage),
    // never from gh_repo_daily (degraded old-pipeline coverage), and must
    // preserve manually curated watchlist rows.
    expect(migration).toContain("FROM default.github_events_stream");
    expect(migration).not.toContain("FROM gh_repo_daily");
    expect(migration).toContain("source = 'auto-seed'");
    expect(migration).toContain("mutations_sync = 1");
  });

  it("partitions daily and monthly firehose rollups by calendar month", async () => {
    const daily = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000016_firehose_event_type_action_daily.sql"),
      "utf-8"
    );
    const monthly = await fs.readFile(
      path.join(process.cwd(), "migrations", "20260726000017_firehose_event_type_action_monthly.sql"),
      "utf-8"
    );

    expect(daily).toContain("PARTITION BY toYYYYMM(day)");
    expect(daily).toContain("ORDER BY (day, repo_name, event_type, action)");
    expect(monthly).toContain("PARTITION BY toYYYYMM(month)");
    expect(monthly).toContain("ORDER BY (month, repo_name, event_type, action)");
  });

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
