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

import { activeContributionRanking } from "./queries.active-contributions";

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
  forks: "5",
  pr_velocity: "3",
  active_builders: "3",
  activity_score: "74",
  branch_scope: "unknown",
  dependency_update_attribution: "unknown",
};

const emptyPushRow = {
  ...rankingRow,
  repo_name: "acme/empty-pushes",
  commits: "0",
  distinct_commits: "0",
  pushes: "8",
  substantive_push_buckets: "0",
  pushers: "2",
  human_pushers: "2",
  bot_pushers: "0",
  prs_opened: "0",
  prs_merged: "0",
  forks: "0",
  pr_velocity: "0",
  active_builders: "2",
  activity_score: "0",
};

const prOnlyRow = {
  ...rankingRow,
  repo_name: "acme/pr-only",
  commits: "0",
  distinct_commits: "0",
  pushes: "0",
  substantive_push_buckets: "0",
  pushers: "0",
  human_pushers: "0",
  bot_pushers: "0",
  prs_opened: "2",
  prs_merged: "1",
  forks: "0",
  pr_velocity: "3",
  active_builders: "1",
  activity_score: "9",
};

const substantiveRow = {
  ...rankingRow,
  repo_name: "acme/substantive",
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
    const result = await activeContributionRanking("7d", "top_commits", 10);

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
        forks: 5,
        prVelocity: 3,
        activeBuilders: 3,
        activityScore: 74,
        branchScope: "unknown",
        dependencyUpdateAttribution: "unknown",
      },
    ]);

    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("FROM gh_repo_actor_hourly");
    expect(query).not.toContain("FROM github_events");
    expect(query).toContain("HAVING commit_total > 0 OR pr_opened_total > 0 OR pr_merged_total > 0");
    expect(query).toContain("bucket.pushes > 0 AND bucket.commits > 0");
    expect(query).toContain("sum(bucket.pushes) AS push_total");
    expect(query).toContain("sum(toUInt64(bucket.pushes > 0 AND bucket.commits > 0)) AS substantive_push_bucket_total");
    expect(query).toContain("ORDER BY distinct_commit_total DESC, activity_score DESC, repo_name ASC");
    expect(result.sql).toBe(query.trim());
    expect(result.data[0]?.branchScope).toBe("unknown");
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("main-branch filtering is not claimed"),
      expect.stringContaining("hour-only filtering cannot use the rollup key prefix"),
    ]));
  });

  it("ranks top_pushes mode by substantive buckets, filtering zero-commit pushes via commits > 0", async () => {
    const result = await activeContributionRanking("30d", "top_pushes", 25);

    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("ORDER BY substantive_push_bucket_total DESC, activity_score DESC, repo_name ASC");
    expect(query).toContain("HAVING substantive_push_bucket_total > 0");
    expect(query).toContain("LIMIT {limit: UInt32}");
    expect(mocks.query.mock.calls[0]?.[0]?.query_params).toEqual({ limit: 25 });
    expect(result.notes[0]).toContain("raw push volume never makes a repo eligible");
  });

  it("ranks top_forks mode ordering by fork_total", async () => {
    const result = await activeContributionRanking("7d", "top_forks", 10);
    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("ORDER BY fork_total DESC, activity_score DESC, repo_name ASC");
  });

  it("ranks pr_velocity mode ordering by pr_opened_total + pr_merged_total", async () => {
    const result = await activeContributionRanking("7d", "pr_velocity", 10);
    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("ORDER BY (pr_opened_total + pr_merged_total) DESC, activity_score DESC, repo_name ASC");
  });

  it("ranks active_builders mode ordering by builder_total (uniqExact(actor_login))", async () => {
    const result = await activeContributionRanking("7d", "active_builders", 10);
    const query = String(mocks.query.mock.calls[0]?.[0]?.query);
    expect(query).toContain("uniqExact(bucket.actor_login) AS builder_total");
    expect(query).toContain("ORDER BY builder_total DESC, activity_score DESC, repo_name ASC");
  });

  it("excludes empty-push and PR-only fixtures from push mode while retaining substantive rows", async () => {
    const fixtures = [emptyPushRow, prOnlyRow, substantiveRow];
    mocks.query.mockImplementation(async ({ query }: { query: string }) => ({
      json: async () => query.includes("HAVING substantive_push_bucket_total > 0")
        ? fixtures.filter((row) => Number(row.substantive_push_buckets) > 0)
        : fixtures.filter((row) => Number(row.commits) > 0 || Number(row.prs_opened) > 0 || Number(row.prs_merged) > 0),
    }));

    const pushResult = await activeContributionRanking("7d", "top_pushes", 10);
    expect(pushResult.data.map((row) => row.repoName)).toEqual(["acme/substantive"]);
    expect(pushResult.data.every((row) => row.substantivePushBuckets > 0)).toBe(true);

    const commitResult = await activeContributionRanking("7d", "top_commits", 10);
    expect(commitResult.data.map((row) => row.repoName)).toEqual([
      "acme/pr-only",
      "acme/substantive",
    ]);
    expect(commitResult.data.map((row) => row.repoName)).not.toContain("acme/empty-pushes");
    expect(commitResult.data.find((row) => row.repoName === "acme/pr-only")?.prsOpened).toBe(2);
  });

  it.each([
    ["limit zero", () => activeContributionRanking("7d", "top_commits", 0)],
    ["limit above cap", () => activeContributionRanking("7d", "top_commits", 101)],
    ["invalid window", () => activeContributionRanking("90d" as never, "top_commits", 10)],
    ["invalid sort", () => activeContributionRanking("7d", "events" as never, 10)],
  ])("rejects %s before issuing SQL", async (_label, call) => {
    await expect(call()).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
