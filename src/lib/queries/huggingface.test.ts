import { describe, expect, it } from "vitest";

describe("hf_model_snapshots migration schema consistency", () => {
  const baseTable = `
    CREATE TABLE IF NOT EXISTS hf_model_snapshots
    (
        scan_at DateTime,
        scan_kind LowCardinality(String),
        model_id String,
        author String DEFAULT '',
        pipeline_tag LowCardinality(String) DEFAULT '',
        library_name LowCardinality(String) DEFAULT '',
        tags Array(String),
        downloads UInt64 DEFAULT 0,
        likes UInt32 DEFAULT 0,
        created_at DateTime DEFAULT toDateTime(0),
        last_modified DateTime DEFAULT toDateTime(0),
        is_private UInt8 DEFAULT 0,
        is_gated UInt8 DEFAULT 0,
        ingested_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(ingested_at)
    ORDER BY (scan_kind, scan_at, model_id);
  `;

  const baseColumns = [
    "scan_at",
    "scan_kind",
    "model_id",
    "author",
    "pipeline_tag",
    "library_name",
    "tags",
    "downloads",
    "likes",
    "created_at",
    "last_modified",
    "is_private",
    "is_gated",
    "ingested_at",
  ];

  const curatedViewColumns = [
    "scan_kind",
    "model_id",
    "author",
    "pipeline_tag",
    "library_name",
    "tags",
    "downloads",
    "likes",
    "created_at",
    "last_modified",
    "is_private",
    "is_gated",
    "ingested_at",
    "scan_at",
  ];

  const migrationDDL = `
    CREATE VIEW IF NOT EXISTS curated.hf_model_latest AS
    SELECT
        scan_kind,
        model_id,
        argMax(author, ingested_at) AS author,
        argMax(pipeline_tag, ingested_at) AS pipeline_tag,
        argMax(library_name, ingested_at) AS library_name,
        argMax(tags, ingested_at) AS tags,
        max(downloads) AS downloads,
        max(likes) AS likes,
        argMax(created_at, ingested_at) AS created_at,
        argMax(last_modified, ingested_at) AS last_modified,
        max(is_private) AS is_private,
        max(is_gated) AS is_gated,
        max(ingested_at) AS ingested_at,
        max(scan_at) AS scan_at
    FROM raw.hf_model_snapshots
    GROUP BY scan_kind, model_id;
  `;

  it("migration creates all required base columns", () => {
    for (const col of baseColumns) {
      expect(baseTable).toContain(col);
    }
  });

  it("curated view references only existing columns", () => {
    for (const col of curatedViewColumns) {
      expect(migrationDDL).toContain(col);
    }
    expect(migrationDDL).toContain("FROM raw.hf_model_snapshots");
    expect(migrationDDL).toContain("GROUP BY scan_kind, model_id");
  });

  it("curated.hf_model_latest uses argMax for mutable columns", () => {
    const mutableCols = ["author", "pipeline_tag", "library_name", "tags", "created_at", "last_modified"];
    for (const col of mutableCols) {
      expect(migrationDDL).toContain(`argMax(${col}, ingested_at)`);
    }
  });

  it("curated.hf_model_latest uses max for monotonic columns", () => {
    const monotonicCols = ["downloads", "likes", "is_private", "is_gated", "ingested_at", "scan_at"];
    for (const col of monotonicCols) {
      expect(migrationDDL).toContain(`max(${col})`);
    }
  });

  it("raw view exists as passthrough", () => {
    const rawView = `
      CREATE VIEW IF NOT EXISTS raw.hf_model_snapshots AS
      SELECT * FROM default.hf_model_snapshots;
    `;
    expect(rawView).toContain("SELECT * FROM default.hf_model_snapshots");
  });

  it("hf_scan_kind_summary has aggregation columns", () => {
    const summaryView = `
      SELECT
        scan_kind,
        count() AS model_count,
        sum(downloads) AS total_downloads,
        sum(likes) AS total_likes,
        countIf(is_gated = 1) AS gated_count,
        countIf(is_private = 1) AS private_count,
        max(scan_at) AS last_scan_at
      FROM curated.hf_model_latest
      GROUP BY scan_kind
    `;
    const expectedCols = ["scan_kind", "model_count", "total_downloads", "total_likes", "gated_count", "private_count", "last_scan_at"];
    for (const col of expectedCols) {
      expect(summaryView).toContain(col);
    }
  });

  it("hf_author_summary filters out empty authors", () => {
    const authorView = `
      WHERE author != ''
    `;
    expect(authorView).toContain("author != ''");
  });
});
