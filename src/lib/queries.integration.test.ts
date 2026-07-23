import { describe, expect, it } from "vitest";
import {
  tickerLanes,
  repoDrilldown,
  repoActivityWindow,
  divergence,
  pulse,
  freshness,
  devScatter,
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

  it("tickerLanes executes all lanes", async () => {
    const lanes = await tickerLanes();
    for (const key of ["newRepos", "topForked", "shippingVelocity", "starBreakouts", "risingStories"] as const) {
      expect(Array.isArray(lanes[key])).toBe(true);
    }
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
    await expect(divergence(subject)).resolves.toBeDefined();
    await expect(pulse(subject)).resolves.toBeDefined();
  }, 120_000);
});
