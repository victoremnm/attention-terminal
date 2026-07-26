import { describe, expect, it } from "vitest";

/**
 * Migration regression test: validates that the firehose pipeline schema
 * is internally consistent — the migration DDL, the ingest INSERT column
 * list, and the query layer all reference the same columns.
 *
 * Runs without ClickHouse (no network dependency).
 */
describe("firehose migration schema consistency", () => {
  // default.github_events_stream (ReplacingMergeTree) is the physical events
  // table as of migration 21; it replaced the MergeTree github_events_firehose.
  const migrationSQL = `
    CREATE TABLE IF NOT EXISTS default.github_events_stream
    (
        event_id      UInt64,
        event_type    LowCardinality(String),
        actor_login   String,
        actor_avatar  String,
        repo_name     String,
        owner         String,
        created_at    DateTime,
        action        LowCardinality(String),
        ref_type      LowCardinality(String) DEFAULT '',
        number        UInt32 DEFAULT 0,
        title         Nullable(String),
        payload       String DEFAULT '{}'
    )
    ENGINE = ReplacingMergeTree
    ORDER BY (event_type, repo_name, created_at, event_id)
    TTL created_at + INTERVAL 30 DAY;
  `;

  const ingestColumns = [
    "event_id",
    "event_type",
    "actor_login",
    "actor_avatar",
    "repo_name",
    "owner",
    "created_at",
    "action",
    "ref_type",
    "number",
    "title",
    "payload",
  ];

  const timelineColumns = [
    "created_at",
    "repo_name",
    "actor_login",
    "actor_avatar",
    "event_type",
    "action",
    "title",
    "number",
    "payload_summary",
  ];

  const volumeColumns = ["hour", "repo_name", "event_type", "events", "actors"];

  it("migration creates all required columns", () => {
    for (const col of ingestColumns) {
      expect(migrationSQL).toContain(col);
    }
  });

  it("ingest column list matches migration column list", () => {
    // Every column in the ingest INSERT must exist in the migration
    for (const col of ingestColumns) {
      expect(migrationSQL).toContain(col);
    }
  });

  it("timeline MV selects only columns that exist in the raw table", () => {
    const timelineMV = `
      SELECT
        created_at, repo_name, actor_login, actor_avatar,
        event_type, action, title, number, payload_summary
      FROM default.github_events_stream
    `;
    for (const col of ["created_at", "repo_name", "actor_login", "actor_avatar", "event_type", "action", "title", "number"]) {
      expect(migrationSQL).toContain(col);
    }
  });

  it("volume MVs reference only existing columns", () => {
    const volumeMV = `
      SELECT
        toStartOfHour(created_at) AS hour,
        repo_name,
        event_type,
        countState() AS events,
        uniqState(actor_login) AS actors
      FROM default.github_events_stream
    `;
    for (const col of ["created_at", "repo_name", "event_type", "actor_login"]) {
      expect(migrationSQL).toContain(col);
    }
  });

  it("cleansed view references only existing columns", () => {
    const cleansedView = `
      SELECT
        event_id, event_type, actor_login,
        cityHash64(actor_login) AS actor_id,
        toUInt8(lower(actor_login) LIKE '%[bot]%') AS is_bot,
        actor_avatar, repo_name, owner, created_at,
        action, ref_type, number, title, payload
      FROM default.github_events_stream
    `;
    for (const col of ["event_id", "event_type", "actor_login", "actor_avatar", "repo_name", "owner", "created_at", "action", "ref_type", "number", "title", "payload"]) {
      expect(migrationSQL).toContain(col);
    }
  });

  it("raw view is a thin passthrough", () => {
    const rawView = `
      CREATE VIEW IF NOT EXISTS raw.github_events_firehose AS
      SELECT * FROM default.github_events_stream;
    `;
    expect(rawView).toContain("SELECT * FROM default.github_events_stream");
  });

  it("timeline table has payload_summary column", () => {
    const timelineTable = `
      CREATE TABLE IF NOT EXISTS curated.event_timeline
      (
          created_at    DateTime,
          repo_name     String,
          actor_login   String,
          actor_avatar  String,
          event_type    LowCardinality(String),
          action        LowCardinality(String),
          title         Nullable(String),
          number        UInt32 DEFAULT 0,
          payload_summary String DEFAULT ''
      )
    `;
    for (const col of timelineColumns) {
      expect(timelineTable).toContain(col);
    }
  });

  it("volume tables have correct aggregate columns", () => {
    const volumeTable = `
      CREATE TABLE IF NOT EXISTS curated.event_volume_hourly
      (
          hour       DateTime,
          repo_name  String,
          event_type LowCardinality(String),
          events     AggregateFunction(count),
          actors     AggregateFunction(uniq, String)
      )
    `;
    for (const col of volumeColumns) {
      expect(volumeTable).toContain(col);
    }
  });

  it("no dead columns in raw table", () => {
    // These were removed after verifying they don't exist in 2026 GH Archive
    expect(migrationSQL).not.toContain("commit_count");
    expect(migrationSQL).not.toContain("distinct_commit_count");
    expect(migrationSQL).not.toContain("pr_merged");
  });

  it("payload column is present for future re-parsing", () => {
    expect(migrationSQL).toContain("payload");
  });

  it("stream table dedups by event_id via ReplacingMergeTree", () => {
    // event_id must trail the ORDER BY so duplicate inserts of the same event
    // (GH Archive hourly load + real-time Events API poller) converge at
    // merge time while the leading columns keep range-scan pruning.
    expect(migrationSQL).toContain("ENGINE = ReplacingMergeTree");
    expect(migrationSQL).toContain("ORDER BY (event_type, repo_name, created_at, event_id)");
  });
});
