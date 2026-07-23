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
import { runDataRetrievalAgent } from "./data-retrieval-agent";

const generateObjectMock = vi.mocked(generateObject);

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

  it("sets union_default_mode so bare UNION queries execute", async () => {
    const result = await runDataRetrievalAgent("show me activity by day");

    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "SELECT day FROM hn_talk UNION SELECT day FROM github_code",
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
      queryExecuted: "SELECT day FROM hn_talk UNION SELECT day FROM github_code",
    });
  });
});
