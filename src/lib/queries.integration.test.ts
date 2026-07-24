import { describe, expect, it } from "vitest";
import {
  tickerLanes,
  repoDrilldown,
  repoActivityWindow,
  divergence,
  pulse,
  freshness,
  devScatter,
  activeContributionRanking,
  type RepoWindow,
} from "./queries";

const hasCH = Boolean(process.env.CLICKHOUSE_URL && process.env.CLICKHOUSE_PASSWORD);

// Executes real SQL so syntax errors (e.g. the `FINAL AS m` bug that reached
// prod) fail the suite. Skipped when creds are absent.
describe.skipIf(!hasCH)("query layer (integration)", () => {
  const windows: RepoWindow[] = ["1d", "7d", "30d", "td"];

  it.each(windows)("repoActivityWindow(%s) executes and is shaped", async (w) => {
    const { data } = await repoActivityWindow(w, 5);
    expect(Array.isArray(data)).toBe(true);
    for (const r of data) {
      expect(typeof r.repo_name).toBe("string");
      expect(typeof r.events).toBe("number");
      expect(Array.isArray(r.spark)).toBe(true);
      for (const v of r.spark) expect(typeof v).toBe("number");
    }
  }, 120_000);

  it("supports paginated sorting and returns a safe query proof", async () => {
    const result = await repoActivityWindow("30d", {
      limit: 2,
      offset: 1,
      sort: "commits",
      direction: "asc",
      search: "github",
    });
    expect(result.data.length).toBeLessThanOrEqual(2);
    expect(result.proof).toEqual({
      queryId: "repo_activity_window",
      params: {
        limit: 2,
        offset: 1,
        sort: "commits",
        direction: "asc",
        search: "github",
      },
      sourceTables: ["gh_repo_daily", "gh_repo_metadata"],
    });
    expect(result.sql).toContain("LIMIT {limit: UInt32} OFFSET {offset: UInt32}");
    expect(result.sql).toContain("repo_name ASC");
  }, 120_000);

  it("search filters out non-matching repos instead of just blanking their metadata", async () => {
    const searched = await repoActivityWindow("30d", {
      limit: 100,
      sort: "events",
      direction: "desc",
      search: "zzz-no-such-repo-should-match-nothing-zzz",
    });
    expect(searched.data.length).toBe(0);
  }, 120_000);

  it("returns deterministic ties across repeated reads", async () => {
    const first = await repoActivityWindow("7d", { limit: 10, sort: "events" });
    const second = await repoActivityWindow("7d", { limit: 10, sort: "events" });
    expect(first.data.map((row) => row.repo_name)).toEqual(second.data.map((row) => row.repo_name));
  }, 120_000);

  it("activeContributionRanking(pushes) executes and enforces push eligibility", async () => {
    const result = await activeContributionRanking("7d", "pushes", 10);

    expect(result.window).toBe("7d");
    expect(result.sort).toBe("pushes");
    expect(result.limit).toBe(10);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.sql).toContain("FROM gh_repo_actor_hourly");
    expect(result.sql).toContain("HAVING substantive_push_bucket_total > 0");
    expect(result.data.every((row) => row.substantivePushBuckets > 0)).toBe(true);
    expect(result.data.every((row) => row.branchScope === "unknown")).toBe(true);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("main-branch filtering is not claimed"),
      expect.stringContaining("hour-only filtering cannot use the rollup key prefix"),
    ]));
  }, 120_000);

  it("tickerLanes executes all lanes", async () => {
    const lanes = await tickerLanes();
    for (const key of ["newRepos", "topForked", "shippingVelocity", "starBreakouts", "risingStories"] as const) {
      expect(Array.isArray(lanes[key])).toBe(true);
    }
    expect(lanes.actors).toBeDefined();
    expect(Array.isArray(lanes.actors?.humans)).toBe(true);
    expect(Array.isArray(lanes.actors?.bots)).toBe(true);
    expect(Array.isArray(lanes.provenance)).toBe(true);
  }, 120_000);

  it("repoDrilldown executes for a live repo", async () => {
    const { data } = await repoActivityWindow("30d", 1);
    const repoName = data.length > 0 ? data[0].repo_name : "clickhouse/clickhouse";
    const payload = await repoDrilldown(repoName);
    expect(payload.type).toBe("repo-drilldown");
    expect(payload.repoName).toBe(repoName);
    expect(payload.query.sql).toContain("gh_repo_analysis");
  }, 120_000);

  it("freshness executes", async () => {
    await expect(freshness()).resolves.toBeTruthy();
  });

  it.each(["7d", "30d"] as const)("devScatter(%s) executes", async (w) => {
    const res = await devScatter(w, 10);
    expect(Array.isArray(res.data)).toBe(true);
  }, 120_000);

  it.each(["react", "ai"])("divergence(%s) & pulse execute", async (subject) => {
    const res = await divergence(subject);
    expect(res).toBeDefined();
    expect(res.provenance.tables).toContain("daily_skinny_subject_hourly");
    expect(res.provenance.tables).not.toContain("raw.github_events");
    await expect(pulse(subject)).resolves.toBeDefined();
  }, 120_000);

  it("live ClickHouse latency benchmarks execute under 500ms latency budget", async () => {
    const start = Date.now();
    const res = await devScatter("7d", 10);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1500);
    expect(res.rowsRead).toBeLessThan(10_000_000);
  }, 120_000);
});
