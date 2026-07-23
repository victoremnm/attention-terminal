import { describe, expect, it } from "vitest";
import { formatTableRow, fallbackCatalog } from "./catalog";

describe("formatTableRow", () => {
  it("formats a table with rows estimate", () => {
    const result = formatTableRow({
      database: "raw",
      name: "github_events",
      engine: "ReplacingMergeTree",
      total_rows: "1500000",
    });
    expect(result).toBe("- `raw.github_events` (ReplacingMergeTree) (~1,500,000 rows)");
  });

  it("formats a table without row estimate", () => {
    const result = formatTableRow({
      database: "default",
      name: "ingest_log",
      engine: "MergeTree",
      total_rows: undefined,
    });
    expect(result).toBe("- `default.ingest_log` (MergeTree)");
  });

  it("labels views correctly", () => {
    const result = formatTableRow({
      database: "default",
      name: "my_view",
      engine: "MaterializedView",
    });
    expect(result).toBe("- `default.my_view` (view)");
  });
});

describe("fallbackCatalog", () => {
  it("includes known tables in fallback text", () => {
    const text = fallbackCatalog();
    expect(text).toContain("github_events");
    expect(text).toContain("hackernews");
    expect(text).toContain("⚠️");
  });
});
