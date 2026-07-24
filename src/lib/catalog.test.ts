import { describe, expect, it } from "vitest";
import { formatTableRow, fallbackCatalog } from "./catalog";

describe("formatTableRow", () => {
  it("formats a table with rows estimate and Data Policy badge", () => {
    const result = formatTableRow({
      database: "raw",
      name: "github_events",
      engine: "ReplacingMergeTree",
      total_rows: "1500000",
    });
    expect(result).toBe("- `raw.github_events` (ReplacingMergeTree) [BRONZE: Raw Event Firehose] (~1,500,000 rows)");
  });

  it("formats a table without row estimate", () => {
    const result = formatTableRow({
      database: "default",
      name: "ingest_log",
      engine: "MergeTree",
      total_rows: undefined,
    });
    expect(result).toBe("- `default.ingest_log` (MergeTree) [BRONZE: Raw Event Firehose]");
  });

  it("labels views and Data Policy GOLD tier correctly", () => {
    const result = formatTableRow({
      database: "curated",
      name: "task_execution_metrics",
      engine: "MaterializedView",
    });
    expect(result).toBe("- `curated.task_execution_metrics` (view) [GOLD: Pre-aggregated / Sanitized View]");
  });
});

describe("fallbackCatalog", () => {
  it("includes known tables and Data Policy Language header in fallback text", () => {
    const text = fallbackCatalog();
    expect(text).toContain("github_events");
    expect(text).toContain("Data Policy Language Enforced");
    expect(text).toContain("⚠️");
  });
});
