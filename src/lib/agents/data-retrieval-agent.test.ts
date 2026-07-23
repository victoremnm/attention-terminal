import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  writeFile: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: mocks.generateObject,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => model),
}));

vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn(() => ({ query: mocks.query })),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mocks.writeFile,
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "retrieval-key"),
}));

import { generateObject } from "ai";
import { normalizeUnionQuery, runDataRetrievalAgent } from "./data-retrieval-agent";

const generateObjectMock = vi.mocked(generateObject);

describe("normalizeUnionQuery", () => {
  it("converts bare UNION to UNION ALL", () => {
    const raw = "SELECT repo_name FROM raw.github_events UNION SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM raw.github_events UNION ALL SELECT repo_name FROM hn_posts");
  });

  it("preserves explicit UNION ALL queries", () => {
    const raw = "SELECT repo_name FROM raw.github_events UNION ALL SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM raw.github_events UNION ALL SELECT repo_name FROM hn_posts");
  });

  it("preserves explicit UNION DISTINCT queries", () => {
    const raw = "SELECT repo_name FROM raw.github_events UNION DISTINCT SELECT repo_name FROM hn_posts";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT repo_name FROM raw.github_events UNION DISTINCT SELECT repo_name FROM hn_posts");
  });

  it("handles case-insensitive bare UNION keywords", () => {
    const raw = "SELECT 1 union SELECT 2";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT 1 UNION ALL SELECT 2");
  });

  it("preserves union keyword inside string literals", () => {
    const raw = "SELECT title FROM hn WHERE lower(title) LIKE '%union%' UNION SELECT title FROM gh";
    const normalized = normalizeUnionQuery(raw);
    expect(normalized).toBe("SELECT title FROM hn WHERE lower(title) LIKE '%union%' UNION ALL SELECT title FROM gh");
  });
});

describe("runDataRetrievalAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({
      json: async () => [{ day: "2026-07-23" }],
    });
    generateObjectMock.mockResolvedValue({
      object: {
        query: "SELECT day FROM hn_talk UNION SELECT day FROM github_code",
      },
    } as any);
  });

  it("normalizes bare UNION and sets union_default_mode so UNION queries execute", async () => {
    const result = await runDataRetrievalAgent("show me activity by day");

    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT day FROM hn_talk UNION ALL SELECT day FROM github_code",
        clickhouse_settings: expect.objectContaining({
          readonly: "2",
          max_execution_time: 30,
          union_default_mode: "ALL",
        }),
      })
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("clickhouse_result_retrieval-key.json"),
      JSON.stringify([{ day: "2026-07-23" }]),
      "utf-8"
    );
    expect(result).toMatchObject({
      retrievalKey: "retrieval-key",
      rowCount: 1,
      queryExecuted: "SELECT day FROM hn_talk UNION ALL SELECT day FROM github_code",
    });
  });
});
