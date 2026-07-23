import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  insert: vi.fn(),
  missingTables: vi.fn(),
  ensureTablesExist: vi.fn(),
}));

vi.mock("./clickhouse", () => ({
  clickhouse: { query: mocks.query },
  clickhouseInsert: { insert: mocks.insert },
  missingTables: mocks.missingTables,
  ensureTablesExist: mocks.ensureTablesExist,
}));

vi.mock("./github-repo", () => ({ fetchRepoRow: vi.fn(), fetchCodeFrequency: vi.fn().mockResolvedValue([]) }));
vi.mock("./repo-analysis", () => ({ analyzeAndStoreRepo: vi.fn() }));

import { repoDrilldown } from "./queries";

const seededHourlyRows = [
  {
    is_total: 0,
    hour: "2026-07-22 11:00:00",
    pushes: "2",
    commits: "4",
    distinct_commits: "3",
    forks: "1",
    stars: "5",
    issues_opened: "1",
    prs_opened: "2",
    prs_merged: "1",
    actors: "2",
  },
  {
    is_total: 0,
    hour: "2026-07-22 12:00:00",
    pushes: "1",
    commits: "2",
    distinct_commits: "2",
    forks: "0",
    stars: "3",
    issues_opened: "0",
    prs_opened: "1",
    prs_merged: "0",
    actors: "2",
  },
  {
    is_total: 1,
    hour: "1970-01-01 00:00:00",
    pushes: "3",
    commits: "6",
    distinct_commits: "5",
    forks: "1",
    stars: "8",
    issues_opened: "1",
    prs_opened: "3",
    prs_merged: "1",
    actors: "3",
  },
];

const seededCommitRows = [
  {
    sha: "top-older",
    author: "alice",
    author_date: "2026-07-20 10:00:00",
    message: "older top commit",
    is_recent: 0,
    is_top_committer: 1,
    commit_count: "12",
    commit_authors: "3",
    author_commits: "7",
  },
  {
    sha: "latest",
    author: "bob",
    author_date: "2026-07-22 12:00:00",
    message: "latest commit",
    is_recent: 1,
    is_top_committer: 0,
    commit_count: "12",
    commit_authors: "3",
    author_commits: "2",
  },
];

const seededTrendRows = [
  {
    date: "2026-07-22",
    stars: "4",
    forks: "1",
    event_type: "",
    event_label: "",
    event_url: "",
    release_tag: "",
    release_name: "",
    release_author: "",
    release_published_at: "",
    release_body: "",
    release_in_activity: 0,
  },
  {
    date: "2026-07-21",
    stars: "0",
    forks: "0",
    event_type: "release",
    event_label: "release v2",
    event_url: "https://github.com/acme/repo/releases/tag/v2",
    release_tag: "v2",
    release_name: "Version 2",
    release_author: "alice",
    release_published_at: "2026-07-21 10:00:00",
    release_body: "release notes",
    release_in_activity: 1,
  },
];

function rowsForQuery(query: string, missingOptional: boolean) {
  if (query.includes("SELECT count() AS c FROM gh_repo_drilldown_hourly")) return [{ c: 1 }];
  if (query.includes("SELECT toString(max(hour)")) return [{ high_water: "2026-07-22 12:00:00" }];
  if (query.includes("SELECT toString(max(created_at)")) return [{ high_water: "2026-07-22 12:00:00" }];
  if (query.includes("WITH ROLLUP")) return missingOptional ? [] : seededHourlyRows;
  if (query.includes("is_top_committer")) return missingOptional ? [] : seededCommitRows;
  if (query.includes("release_in_activity")) return missingOptional ? [] : seededTrendRows;
  if (query.includes("countIf(merged_at")) {
    return missingOptional
      ? []
      : [{
          prs_merged: "1",
          prs_opened: "2",
          prs_open: "4",
          issues_closed: "3",
          issues_opened: "5",
          issues_open: "6",
        }];
  }
  return [];
}

function configureMocks(missingOptional = false) {
  const missing = missingOptional
    ? ["gh_repo_drilldown_hourly", "gh_repo_actor_hourly", "gh_repo_activity_feed", "gh_repo_analysis"]
    : [];
  mocks.missingTables.mockResolvedValue(missing);
  mocks.query.mockImplementation(async ({ query }: { query: string }) => ({
    json: async () => rowsForQuery(query, missingOptional),
  }));
}

describe("repoDrilldown query consolidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureMocks();
  });

  it("derives KPI, velocity, activity, and pulse from consolidated bounded reads", async () => {
    const payload = await repoDrilldown("acme/repo");

    expect(mocks.missingTables).toHaveBeenCalledTimes(1);
    expect(payload.kpis24h).toMatchObject({
      pushes: 3,
      commits: 6,
      distinctCommits: 5,
      actors: 3,
    });
    expect(payload.velocity).toHaveLength(2);
    expect(payload.velocity[0]).toMatchObject({ hour: "2026-07-22 11:00:00", commits: 4 });
    expect(payload.activity?.commits).toEqual([
      {
        sha: "latest",
        author: "bob",
        authorDate: "2026-07-22 12:00:00",
        message: "latest commit",
      },
    ]);
    expect(payload.activity?.releases).toEqual([
      {
        tag: "v2",
        name: "Version 2",
        author: "alice",
        publishedAt: "2026-07-21 10:00:00",
        body: "release notes",
      },
    ]);
    expect(payload.pulse).toMatchObject({
      commitCount: 12,
      commitAuthors: 3,
      topCommitters: [{ author: "alice", commits: 7 }],
    });

    const statements = payload.query.sql.split("-- repo drill-down query ").length - 1;
    expect(statements).toBe(11);
    expect(payload.query.sql).toContain("hour AS bucket_hour");
    expect(payload.query.sql).toContain("GROUP BY bucket_hour WITH ROLLUP");
    expect(payload.query.sql).toContain("release_in_activity");
    expect(payload.query.sql).toContain("row_number() OVER (ORDER BY author_date DESC)");
    expect(payload.query.sql).toContain("countIf(state = 'open')");
  });

  it("falls back when optional aggregate tables are missing and empty rowsets stay omitted", async () => {
    configureMocks(true);

    const payload = await repoDrilldown("acme/repo");

    expect(mocks.missingTables).toHaveBeenCalledTimes(1);
    expect(payload.kpis24h).toEqual({
      pushes: 0,
      commits: 0,
      distinctCommits: 0,
      forks: 0,
      stars: 0,
      issuesOpened: 0,
      prsOpened: 0,
      prsMerged: 0,
      actors: 0,
    });
    expect(payload.velocity).toEqual([]);
    expect(payload.activity).toBeUndefined();
    expect(payload.trends).toBeUndefined();
    expect(payload.pulse).toBeUndefined();
    expect(payload.query.sql).toContain("FROM github_events");
    expect(payload.query.sql).not.toContain("FROM gh_repo_drilldown_hourly");
    expect(payload.query.sql).toContain("countIf(state = 'open')");
  });
});
