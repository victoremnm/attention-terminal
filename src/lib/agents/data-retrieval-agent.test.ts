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
import { resetCatalogState } from "../sql-catalog-guard";
import { normalizeUnionQuery, runDataRetrievalAgent } from "./data-retrieval-agent";

const generateObjectMock = vi.mocked(generateObject);

const CATALOG_ROWS = [
  { database: "raw", name: "hackernews", engine: "MergeTree" },
  { database: "raw", name: "github_events", engine: "MergeTree" },
];

function mockCatalogFetch() {
  mocks.query.mockResolvedValueOnce({
    json: async () => CATALOG_ROWS,
  });
}

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
    resetCatalogState();
  });

  it("normalizes bare UNION and sets union_default_mode so UNION queries execute", async () => {
    mockCatalogFetch();
    mocks.query.mockResolvedValueOnce({
      json: async () => [{ day: "2026-07-23" }],
    });
    generateObjectMock.mockResolvedValueOnce({
      object: { query: "SELECT day FROM raw.hackernews UNION SELECT day FROM raw.github_events" },
    } as any);

    const result = await runDataRetrievalAgent("show me activity by day");

    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: "SELECT day FROM raw.hackernews UNION ALL SELECT day FROM raw.github_events",
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
      queryExecuted: "SELECT day FROM raw.hackernews UNION ALL SELECT day FROM raw.github_events",
    });
  });

  it("grounds the model with the live catalog before generating SQL", async () => {
    mockCatalogFetch();
    mocks.query.mockResolvedValueOnce({ json: async () => [] });
    generateObjectMock.mockResolvedValueOnce({
      object: { query: "SELECT 1 FROM raw.hackernews" },
    } as any);

    await runDataRetrievalAgent("anything");

    const call = generateObjectMock.mock.calls[0][0] as any;
    expect(call.instructions).toContain("raw.hackernews");
    expect(call.instructions).toContain("raw.github_events");
  });

  it("rejects a query against a fabricated table without executing it, then succeeds on retry", async () => {
    mockCatalogFetch();
    generateObjectMock
      .mockResolvedValueOnce({
        object: { query: "SELECT * FROM repos JOIN pushes ON repos.name = pushes.repo_name" },
      } as any)
      .mockResolvedValueOnce({
        object: { query: "SELECT * FROM raw.github_events" },
      } as any);
    mocks.query.mockResolvedValueOnce({ json: async () => [{ repo_name: "foo" }] });

    const result = await runDataRetrievalAgent("show me repo activity");

    // Only the catalog fetch + the corrected query executed — the fabricated
    // one never reached ClickHouse.
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "SELECT * FROM raw.github_events" })
    );
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    const retryPrompt = generateObjectMock.mock.calls[1][0] as any;
    const lastUserMessage = [...retryPrompt.messages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage.content).toContain("repos");
    expect(result).toMatchObject({ rowCount: 1 });
  });

  it("gives up after exhausting retries and returns a structured error instead of throwing", async () => {
    mockCatalogFetch();
    generateObjectMock.mockResolvedValue({
      object: { query: "SELECT * FROM repos" },
    } as any);

    const result = await runDataRetrievalAgent("show me repo activity");

    expect(mocks.query).toHaveBeenCalledTimes(1); // only the catalog fetch — never executed a bad query
    expect(result).toMatchObject({ error: expect.stringContaining("repos") });
  });

  it("rejects a ReplacingMergeTree read missing FINAL without executing it, then succeeds on retry", async () => {
    mocks.query.mockResolvedValueOnce({
      json: async () => [{ database: "raw", name: "hackernews", engine: "ReplacingMergeTree" }],
    });
    generateObjectMock
      .mockResolvedValueOnce({ object: { query: "SELECT * FROM raw.hackernews" } } as any)
      .mockResolvedValueOnce({ object: { query: "SELECT * FROM raw.hackernews FINAL" } } as any);
    mocks.query.mockResolvedValueOnce({ json: async () => [{ id: 1 }] });

    const result = await runDataRetrievalAgent("show me hn stories");

    expect(mocks.query).toHaveBeenCalledTimes(2); // catalog fetch + the corrected FINAL query
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "SELECT * FROM raw.hackernews FINAL" })
    );
    const retryPrompt = generateObjectMock.mock.calls[1][0] as any;
    const lastUserMessage = [...retryPrompt.messages].reverse().find((m: any) => m.role === "user");
    expect(lastUserMessage.content).toContain("FINAL");
    expect(result).toMatchObject({ rowCount: 1 });
  });

  it("rejects multi-statement queries without executing them", async () => {
    mockCatalogFetch();
    generateObjectMock.mockResolvedValue({
      object: { query: "SELECT 1 FROM raw.hackernews; DROP TABLE raw.hackernews" },
    } as any);

    const result = await runDataRetrievalAgent("do something");

    expect(mocks.query).toHaveBeenCalledTimes(1); // only the catalog fetch
    expect(result).toMatchObject({ error: expect.stringContaining("read-only") });
  });

  it("includes core table column schemas in system prompt and adds hints on UNKNOWN_IDENTIFIER errors", async () => {
    mockCatalogFetch();
    mocks.query
      .mockRejectedValueOnce(new Error("ClickHouseError: Unknown expression or function identifier `event_date`"))
      .mockResolvedValueOnce({ json: async () => [{ repo_name: "htmx/htmx" }] });

    generateObjectMock
      .mockResolvedValueOnce({
        object: { query: "SELECT repo_name FROM raw.github_events WHERE event_date >= today()" },
      } as any)
      .mockResolvedValueOnce({
        object: { query: "SELECT repo_name FROM raw.github_events WHERE created_at >= today()" },
      } as any);

    const result = await runDataRetrievalAgent("repos active today");

    const firstCallPrompt = generateObjectMock.mock.calls[0][0] as any;
    expect(firstCallPrompt.instructions).toContain("Time column is created_at");
    expect(firstCallPrompt.instructions).toContain("gh_repo_metadata");

    const secondCallPrompt = generateObjectMock.mock.calls[1][0] as any;
    const retryUserMsg = [...secondCallPrompt.messages].reverse().find((m: any) => m.role === "user");
    expect(retryUserMsg.content).toContain("HINT: Verify column names against table schemas");
    expect(result).toMatchObject({ rowCount: 1 });
  });
});
