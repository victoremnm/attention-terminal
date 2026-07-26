import { describe, expect, it, vi } from "vitest";

const { qMock } = vi.hoisted(() => ({ qMock: vi.fn() }));
vi.mock("./core", () => ({ q: qMock }));

import { firehoseEventMix } from "./firehose";

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
  ["PullRequestEvent", "synchronize"],
  ["WatchEvent", "started"],
  ["PullRequestReviewEvent", "submitted"],
  ["PullRequestReviewCommentEvent", "created"],
  ["PullRequestReviewCommentEvent", "edited"],
  ["IssuesEvent", "opened"],
  ["IssuesEvent", "closed"],
  ["IssuesEvent", "labeled"],
  ["IssuesEvent", "assigned"],
  ["IssuesEvent", "unlabeled"],
  ["IssuesEvent", "unassigned"],
  ["IssuesEvent", "reopened"],
  ["MemberEvent", "created"],
  ["MemberEvent", "added"],
  ["CommitCommentEvent", "created"],
  ["PublicEvent", ""],
  ["GollumEvent", "created"],
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
});
