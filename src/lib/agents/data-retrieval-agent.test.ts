import { describe, expect, it } from "vitest";
import { normalizeUnionQuery } from "./data-retrieval-agent";

describe("normalizeUnionQuery", () => {
  it("converts bare UNION to UNION ALL", () => {
    const raw = "SELECT repo_name FROM github_events UNION SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM github_events UNION ALL SELECT repo_name FROM hn_posts");
  });

  it("preserves explicit UNION ALL queries", () => {
    const raw = "SELECT repo_name FROM github_events UNION ALL SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM github_events UNION ALL SELECT repo_name FROM hn_posts");
  });

  it("preserves explicit UNION DISTINCT queries", () => {
    const raw = "SELECT repo_name FROM github_events UNION DISTINCT SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM github_events UNION DISTINCT SELECT repo_name FROM hn_posts");
  });

  it("handles case-insensitive bare UNION keywords", () => {
    const raw = "SELECT 1 union SELECT 2";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT 1 UNION ALL SELECT 2");
  });
});
