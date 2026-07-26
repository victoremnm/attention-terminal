import { describe, expect, it, vi } from "vitest";

const { qMock } = vi.hoisted(() => ({ qMock: vi.fn() }));
vi.mock("./core", () => ({ q: qMock }));

import { firehoseEventMix, firehoseEventMixDaily, firehoseEventMixMonthly } from "./firehose";

// Representative observed firehose surface. Empty actions are intentional:
// Push/Create/Delete/Public are event variants, not actioned transitions.
export const FIREHOSE_EVENT_VARIANTS = [
  ["PushEvent", ""],
  ["CreateEvent", ""],
  ["DeleteEvent", ""],
  ["IssueCommentEvent", "created"],
  ["PullRequestEvent", "opened"],
  ["PullRequestEvent", "merged"],
  ["PullRequestEvent", "labeled"],
  ["PullRequestEvent", "closed"],
  ["PullRequestEvent", "assigned"],
  ["PullRequestEvent", "unlabeled"],
  ["PullRequestEvent", "reopened"],
  ["PullRequestEvent", "unassigned"],
  ["WatchEvent", "started"],
  ["PullRequestReviewCommentEvent", "created"],
  ["PullRequestReviewEvent", "created"],
  ["PullRequestReviewEvent", "updated"],
  ["PullRequestReviewEvent", "dismissed"],
  ["IssuesEvent", "opened"],
  ["IssuesEvent", "closed"],
  ["IssuesEvent", "labeled"],
  ["IssuesEvent", "assigned"],
  ["IssuesEvent", "unlabeled"],
  ["IssuesEvent", "unassigned"],
  ["IssuesEvent", "reopened"],
  ["ForkEvent", "forked"],
  ["MemberEvent", "added"],
  ["CommitCommentEvent", "created"],
  ["PublicEvent", ""],
  ["GollumEvent", ""],
  ["DiscussionEvent", "created"],
  ["ReleaseEvent", "published"],
] as const;

describe("firehose event/action mix", () => {
  it("fixture covers the full 31-variant observed distribution", () => {
    expect(FIREHOSE_EVENT_VARIANTS).toHaveLength(31);
    expect(new Set(FIREHOSE_EVENT_VARIANTS.map(([type, action]) => `${type}:${action}`)).size).toBe(31);
    expect(FIREHOSE_EVENT_VARIANTS).toContainEqual(["PushEvent", ""]);
    expect(FIREHOSE_EVENT_VARIANTS).toContainEqual(["IssueCommentEvent", "created"]);
    expect(FIREHOSE_EVENT_VARIANTS).toContainEqual(["PullRequestEvent", "merged"]);
    expect(FIREHOSE_EVENT_VARIANTS).toContainEqual(["WatchEvent", "started"]);
    expect(FIREHOSE_EVENT_VARIANTS).toContainEqual(["ReleaseEvent", "published"]);
  });

  it("dimension query merges aggregate states instead of summing serialized values", async () => {
    qMock.mockResolvedValueOnce({ rows: [], provenance: { sql: "SELECT 1", elapsedMs: 0 } });
    const result = await firehoseEventMix();
    const sql = String(qMock.mock.calls.at(-1)?.[0]);
    expect(sql).toContain("event_type");
    expect(sql).toContain("action");
    expect(sql).toContain("countMerge(events)");
    expect(sql).toContain("uniqMerge(actors)");
    expect(sql).toContain("GROUP BY repo_name, event_type, action");
    expect(result.sql).toBe("SELECT 1");
  });

  it.each([
    ["daily", firehoseEventMixDaily, "day", "curated.firehose_event_type_action_daily"],
    ["monthly", firehoseEventMixMonthly, "month", "curated.firehose_event_type_action_monthly"],
  ])("builds the %s rollup query with a time key and merged states", async (_name, query, timeKey, table) => {
    qMock.mockResolvedValueOnce({ rows: [], provenance: { sql: "SELECT 1", elapsedMs: 0 } });
    await query();
    const [sql, tables] = qMock.mock.calls.at(-1) ?? [];
    expect(String(sql)).toContain(timeKey);
    expect(String(sql)).toContain("countMerge(events)");
    expect(String(sql)).toContain("uniqMerge(actors)");
    expect(String(sql)).toContain(`LIMIT {limit: UInt32} BY ${timeKey}`);
    expect(tables).toEqual([table]);
  });
});
