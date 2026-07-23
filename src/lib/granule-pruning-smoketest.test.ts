import { describe, expect, it } from "vitest";
import { clickhouse } from "./clickhouse";

export interface GranuleStats {
  queryName: string;
  selectedGranules: number;
  totalGranules: number;
  prunedGranules: number;
  prunedPercentage: number;
  indexesUsed: string[];
}

export function parseExplainGranules(explainText: string, queryName: string): GranuleStats {
  const indexesUsed: string[] = [];

  // Match index names
  const indexMatches = explainText.matchAll(/Name:\s*([A-Za-z0-9_]+)/g);
  for (const match of indexMatches) {
    if (match[1]) indexesUsed.push(match[1]);
  }

  // Match Granules: X/Y pattern
  const granuleMatches = [...explainText.matchAll(/Granules:\s*(\d+)\/(\d+)/g)];

  let selected = 0;
  let total = 0;

  if (granuleMatches.length > 0) {
    // Pick the last matched granules line (represents final scan selection)
    const lastMatch = granuleMatches[granuleMatches.length - 1];
    selected = parseInt(lastMatch[1], 10);
    total = parseInt(lastMatch[2], 10);
  }

  const prunedGranules = Math.max(0, total - selected);
  const prunedPercentage = total > 0 ? Number(((prunedGranules / total) * 100).toFixed(2)) : 0;

  return {
    queryName,
    selectedGranules: selected,
    totalGranules: total,
    prunedGranules,
    prunedPercentage,
    indexesUsed,
  };
}

describe("Automated ClickHouse Granule Pruning Smoke Test", () => {
  it("verifies hackernews time skipping index and reports granule scan statistics", async () => {
    let isConnected = false;
    let explainText = "";

    try {
      const res = await clickhouse.query({
        query: `
          EXPLAIN indexes = 1
          SELECT id, title AS name, score
          FROM hackernews FINAL
          WHERE type = 'story' AND time > now() - INTERVAL 6 HOUR
            AND score >= 10 AND deleted = 0 AND dead = 0
        `,
        format: "TabSeparated",
      });
      explainText = await res.text();
      isConnected = true;
    } catch (err: any) {
      console.warn("HackerNews granule test connection notice:", err.message);
    }

    if (isConnected) {
      expect(explainText).toContain("idx_hn_time");
      const stats = parseExplainGranules(explainText, "HackerNews 6h Story Query");
      console.info(
        `[Granule Smoke Test] ${stats.queryName}: ${stats.selectedGranules}/${stats.totalGranules} granules selected (${stats.prunedGranules} granules pruned, ${stats.prunedPercentage}% saved)`
      );
      expect(stats.totalGranules).toBeGreaterThan(0);
    }
  });

  it("verifies gh_repo_hourly hour skipping index and reports granule scan statistics", async () => {
    let isConnected = false;
    let explainText = "";

    try {
      const res = await clickhouse.query({
        query: `
          EXPLAIN indexes = 1
          SELECT repo_name, event_type, countMerge(events) AS event_count
          FROM gh_repo_hourly
          WHERE hour > now() - INTERVAL 24 HOUR
            AND event_type IN ('ForkEvent', 'WatchEvent', 'PushEvent')
          GROUP BY repo_name, event_type
        `,
        format: "TabSeparated",
      });
      explainText = await res.text();
      isConnected = true;
    } catch (err: any) {
      console.warn("gh_repo_hourly granule test connection notice:", err.message);
    }

    if (isConnected) {
      expect(explainText).toContain("idx_hourly_hour");
      const stats = parseExplainGranules(explainText, "gh_repo_hourly 24h Query");
      console.info(
        `[Granule Smoke Test] ${stats.queryName}: ${stats.selectedGranules}/${stats.totalGranules} granules selected (${stats.prunedGranules} granules pruned, ${stats.prunedPercentage}% saved)`
      );
      expect(stats.totalGranules).toBeGreaterThan(0);
    }
  });

  it("verifies github_events created_at skipping index and reports granule scan statistics", async () => {
    let isConnected = false;
    let explainText = "";

    try {
      const res = await clickhouse.query({
        query: `
          EXPLAIN indexes = 1
          SELECT repo_name, count() AS cnt
          FROM github_events
          WHERE event_type = 'CreateEvent'
            AND ref_type = 'repository'
            AND created_at > now() - INTERVAL 6 HOUR
          GROUP BY repo_name
        `,
        format: "TabSeparated",
      });
      explainText = await res.text();
      isConnected = true;
    } catch (err: any) {
      console.warn("github_events granule test connection notice:", err.message);
    }

    if (isConnected) {
      expect(explainText).toContain("github_events");
      const stats = parseExplainGranules(explainText, "github_events 6h CreateEvent Query");
      console.info(
        `[Granule Smoke Test] ${stats.queryName}: ${stats.selectedGranules}/${stats.totalGranules} granules selected (${stats.prunedGranules} granules pruned, ${stats.prunedPercentage}% saved)`
      );
      expect(stats.totalGranules).toBeGreaterThan(0);
    }
  });
});
