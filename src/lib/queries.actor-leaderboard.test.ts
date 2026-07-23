import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  ensureTablesExist: vi.fn(),
}));

vi.mock("./clickhouse", () => ({
  clickhouse: { query: mocks.query },
  clickhouseInsert: { insert: vi.fn() },
  ensureTablesExist: mocks.ensureTablesExist,
  missingTables: vi.fn(),
}));

import { actorLeaderboard } from "./queries";

describe("actorLeaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTablesExist.mockResolvedValue(undefined);
    mocks.query.mockImplementation(async ({ query }: { query: string }) => ({
      json: async () =>
        query.includes("lower(actor_login) NOT LIKE")
          ? [
              {
                actor_login: "alice",
                events: "11",
                repos: "4",
                pushes: "6",
                prs_opened: "2",
                prs_merged: "1",
                score: "37.5",
              },
            ]
          : [
              {
                actor_login: "bot[bot]",
                events: "19",
                repos: "7",
                pushes: "19",
                prs_opened: "0",
                prs_merged: "0",
                score: "19",
              },
            ],
    }));
  });

  it("queries gh_actor_daily for humans and bots and coerces numeric values", async () => {
    const result = await actorLeaderboard();

    expect(mocks.ensureTablesExist).toHaveBeenCalledWith(["raw.github_events"]);
    expect(result.humans).toEqual([
      {
        actor_login: "alice",
        events: 11,
        repos: 4,
        pushes: 6,
        prs_opened: 2,
        prs_merged: 1,
        score: 37.5,
      },
    ]);
    expect(result.bots).toEqual([
      {
        actor_login: "bot[bot]",
        events: 19,
        repos: 7,
        pushes: 19,
        prs_opened: 0,
        prs_merged: 0,
        score: 19,
      },
    ]);
    expect(result.provenance).toHaveLength(2);

    const [humanCall, botCall] = mocks.query.mock.calls.map((call) => call[0]);
    expect(String(humanCall.query)).toContain("FROM raw.github_events");
    expect(String(humanCall.query)).toContain("lower(actor_login) NOT LIKE '%[bot]%'");
    expect(String(botCall.query)).toContain("lower(actor_login) LIKE '%[bot]%'");
    expect(String(botCall.query)).toContain("LIMIT 10");
  });
});
