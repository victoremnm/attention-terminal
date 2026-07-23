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

import { activeContributionRanking } from "./queries";

const rankingRow = {
  repo_name: "acme/active-repo",
  commits: "12",
  distinct_commits: "10",
  pushes: "8",
  substantive_push_buckets: "4",
  pushers: "3",
  human_pushers: "2",
  bot_pushers: "1",
  prs_opened: "2",
  prs_merged: "1",
  activity_score: "74",
  branch_scope: "unknown",
  dependency_update_attribution: "unknown",
};

describe("active contribution ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTablesExist.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({
      json: async () => [rankingRow],
    });
  });

  it("uses the bounded actor rollup and maps numeric measures to numbers", async () => {
    const result = await activeContributionRanking("7d", "commits", 10);

    expect(result.data).toEqual([
      {
        repoName: "acme/active-repo",
        commits: 12,
        distinctCommits: 10,
        pushes: 8,
        substantivePushBuckets: 4,
        pushers: 3,
        humanPushers: 2,
        botPushers: 1,
        prsOpened: 2,
        prsMerged: 1,
        activityScore: 74,
        branchScope: "unknown",
        dependencyUpdateAttribution: "unknown",
      },
    ]);

    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("FROM gh_repo_actor_hourly");
    expect(query).not.toContain("FROM github_events");
    expect(query).toContain("HAVING commits > 0 OR prs_opened > 0 OR prs_merged > 0");
    expect(query).toContain("pushes > 0 AND commits > 0");
    expect(query).toContain("ORDER BY distinct_commits DESC, activity_score DESC, repo_name ASC");
    expect(result.sql).toBe(query.trim());
  });

  it("ranks push mode by substantive buckets, never raw push volume", async () => {
    await activeContributionRanking("30d", "pushes", 25);

    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("ORDER BY substantive_push_buckets DESC, activity_score DESC, repo_name ASC");
    expect(query).toContain("LIMIT {limit: UInt32}");
    expect(mocks.query.mock.calls[0]?.[0]?.query_params).toEqual({ limit: 25 });
  });

  it.each([
    ["limit zero", () => activeContributionRanking("7d", "commits", 0)],
    ["limit above cap", () => activeContributionRanking("7d", "commits", 101)],
    ["invalid window", () => activeContributionRanking("90d" as never, "commits", 10)],
    ["invalid sort", () => activeContributionRanking("7d", "events" as never, 10)],
  ])("rejects %s before issuing SQL", async (_label, call) => {
    await expect(call()).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
