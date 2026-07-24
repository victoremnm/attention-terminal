import { describe, expect, it, vi, beforeEach } from "vitest";
import { actorLeaderboard, tickerLanes, divergence, devScatter } from "./queries";

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

describe("query layer performance & structural optimization tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTablesExist.mockResolvedValue(undefined);
    mocks.query.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes("daily_skinny_subject_hourly")) {
        return { json: async () => [{ day: "2026-07-24", talk: "10", code: "50" }] };
      }
      if (query.includes("gh_actor_daily") || query.includes("raw.github_events")) {
        return {
          json: async () => [
            {
              actor: "dev",
              actor_login: "dev",
              events: "10",
              repos: "2",
              pushes: "5",
              commits: "15",
              prs: "2",
              prs_opened: "2",
              prs_merged: "1",
              mergedPrs: "1",
              score: "25",
              bot_count: "0",
              mega_pusher_count: "0",
              kept_count: "1",
            },
          ],
        };
      }
      return { json: async () => [] };
    });
  });

  it("actorLeaderboard(24h) uses cheap gh_repo_hourly watermark and avoids 139M-row raw.github_events subqueries", async () => {
    await actorLeaderboard("24h");
    const calls = mocks.query.mock.calls.map((c) => String(c[0].query));
    for (const sql of calls) {
      expect(sql).not.toContain("SELECT max(created_at) FROM raw.github_events");
      expect(sql).toContain("coalesce(max(hour)");
    }
  });

  it("tickerLanes uses cheap gh_repo_hourly watermark and avoids raw.github_events subqueries", async () => {
    await tickerLanes();
    const calls = mocks.query.mock.calls.map((c) => String(c[0].query));
    for (const sql of calls) {
      expect(sql).not.toContain("SELECT max(created_at) FROM raw.github_events");
      expect(sql).not.toContain("SELECT max(created_at) FROM gh_repo_activity_feed");
    }
  });

  it("divergence() routes GitHub side to daily_skinny_subject_hourly without scanning raw.github_events", async () => {
    const result = await divergence("react");
    expect(result.provenance.tables).toContain("daily_skinny_subject_hourly");
    expect(result.provenance.tables).not.toContain("raw.github_events");
    expect(result.provenance.sql).toContain("daily_skinny_subject_hourly");
    expect(result.provenance.sql).not.toContain("FROM raw.github_events");
  });

  it("devScatterSql filters and limits prior to CROSS JOIN meta", async () => {
    const res = await devScatter("7d", 10);
    expect(res.sql).toContain("filtered AS");
    expect(rankedSqliIndex(res.sql)).toBeGreaterThan(-1);
    expect(res.sql).toContain("FROM ranked AS r\n    CROSS JOIN meta AS m");
  });
});

function rankedSqliIndex(sql: string) {
  return sql.indexOf("ranked AS (");
}
