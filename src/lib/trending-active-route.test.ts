import { beforeEach, describe, expect, it, vi } from "vitest";

const { activeContributionRanking } = vi.hoisted(() => ({ activeContributionRanking: vi.fn() }));

vi.mock("@/lib/queries", () => ({ activeContributionRanking }));

import { GET } from "../../app/api/trending-active/route";

function request(query: string) {
  return {
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as never;
}

describe("GET /api/trending-active", () => {
  beforeEach(() => {
    activeContributionRanking.mockReset();
  });

  it("rejects invalid sort/limit values before querying", async () => {
    const response = await GET(request("sort=events&limit=101"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "sort is not supported" });
    expect(activeContributionRanking).not.toHaveBeenCalled();
  });

  it("passes normalized parameters and returns safe proof metadata", async () => {
    activeContributionRanking.mockResolvedValue({
      data: [{ repoName: "clickhouse/clickhouse", distinctCommits: 42 }],
      elapsedMs: 18,
      rowsRead: 500,
      sql: "SELECT 1",
      window: "30d",
      sort: "commits",
      limit: 25,
    });

    const response = await GET(request("window=30d&sort=commits&limit=25"));
    expect(response.status).toBe(200);
    expect(activeContributionRanking).toHaveBeenCalledWith("30d", "commits", 25);
    expect(await response.json()).toEqual({
      data: [{ repoName: "clickhouse/clickhouse", distinctCommits: 42 }],
      proof: {
        queryId: "active_contribution_ranking",
        params: { window: "30d", sort: "commits", limit: 25 },
        sourceTables: ["gh_repo_actor_hourly"],
        elapsedMs: 18,
        rowsRead: 500,
      },
    });
  });

  it("returns a stable 500 shape without leaking backend errors", async () => {
    activeContributionRanking.mockImplementation(async () => {
      throw new Error("connection reset by peer at 10.0.0.5");
    });
    const response = await GET(request("window=7d&sort=pushes"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "active contribution query failed" });
  });
});
