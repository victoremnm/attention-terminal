import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoActivityWindow } = vi.hoisted(() => ({ repoActivityWindow: vi.fn() }));

vi.mock("@/lib/queries", () => ({ repoActivityWindow }));

import { GET } from "../../app/api/trending/route";

function request(query: string) {
  return {
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as never;
}

describe("GET /api/trending", () => {
  beforeEach(() => repoActivityWindow.mockReset());

  it("rejects invalid pagination and sort values before querying", async () => {
    const response = await GET(request("limit=101&sort=raw_sql"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "limit must be an integer between 1 and 100" });
    expect(repoActivityWindow).not.toHaveBeenCalled();
  });

  it("passes normalized request parameters and returns safe proof metadata", async () => {
    repoActivityWindow.mockResolvedValue({
      data: [{ repo_name: "clickhouse/clickhouse" }],
      elapsedMs: 12,
      rowsRead: 100,
      proof: {
        queryId: "repo_activity_window",
        params: { limit: 25, offset: 25, sort: "commits", direction: "asc", search: "github" },
        sourceTables: ["gh_repo_daily", "gh_repo_metadata"],
      },
    });

    const response = await GET(request(
      "window=30d&limit=25&offset=25&sort=commits&direction=asc&search=github"
    ));
    expect(response.status).toBe(200);
    expect(repoActivityWindow).toHaveBeenCalledWith("30d", {
      limit: 25,
      offset: 25,
      sort: "commits",
      direction: "asc",
      search: "github",
    });
    expect(await response.json()).toEqual({
      data: [{ repo_name: "clickhouse/clickhouse" }],
      proof: {
        queryId: "repo_activity_window",
        params: { limit: 25, offset: 25, sort: "commits", direction: "asc", search: "github" },
        sourceTables: ["gh_repo_daily", "gh_repo_metadata"],
        elapsedMs: 12,
        rowsRead: 100,
      },
    });
  });
});
