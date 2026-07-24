import { beforeEach, describe, expect, it, vi } from "vitest";

// digest.ts imports `q` via a relative "./queries" specifier (not the "@/lib/queries"
// alias), so the mock specifier here must match exactly for vi.mock to intercept it.
const { q, coreQ } = vi.hoisted(() => ({ q: vi.fn(), coreQ: vi.fn() }));

vi.mock("./queries", () => ({ q }));
vi.mock("./queries/core", () => ({ q: coreQ }));

import { HnThreadInsightsSchema } from "./render-payload";

const taxonomyRows = [
  {
    key: "clickhouse",
    display_name: "ClickHouse",
    hn_tokens: ["clickhouse"],
    gh_repo_patterns: ["%clickhouse%"],
    rank: 1,
  },
];

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    subject: "ClickHouse",
    age: 0,
    talk_threads: "10",
    comments: "20",
    code_score: "30",
    gh_stars: "5",
    repos: "2",
    ...overrides,
  };
}

describe("dailyDigest", () => {
  beforeEach(() => {
    vi.resetModules();
    q.mockReset();
    coreQ.mockReset();
  });

  it("drops subjects with no matching taxonomy entry (e.g. self-referential 'Attention Terminal') while keeping taxonomy-backed subjects", async () => {
    q.mockImplementation(async (_sql: string, tables: string[]) => {
      if (tables[0] === "daily_skinny_taxonomy") {
        return { rows: taxonomyRows, provenance: {} };
      }
      return {
        rows: [
          // Taxonomy-backed subject: has a matching daily_skinny_taxonomy row.
          activityRow({ subject: "ClickHouse", age: 0, talk_threads: "50", code_score: "5" }),
          activityRow({ subject: "ClickHouse", age: 1, talk_threads: "1", code_score: "1" }),
          // Self-referential subject the MV can still emit (its own multiIf() matching is
          // independent of the taxonomy table) but that daily_skinny_taxonomy intentionally
          // excludes -- must not surface in the digest.
          activityRow({ subject: "Attention Terminal", age: 0, talk_threads: "50", code_score: "5" }),
          activityRow({ subject: "Attention Terminal", age: 1, talk_threads: "1", code_score: "1" }),
        ],
        provenance: {},
      };
    });

    const { dailyDigest } = await import("./digest");
    const digest = await dailyDigest(0);

    const subjects = digest.clusters.map((cluster) => cluster.subject);
    expect(subjects).toContain("ClickHouse");
    expect(subjects).not.toContain("Attention Terminal");
  });

  it("does not permanently cache a failed taxonomy fetch and retries on the next call", async () => {
    let taxonomyCalls = 0;
    q.mockImplementation(async (_sql: string, tables: string[]) => {
      if (tables[0] === "daily_skinny_taxonomy") {
        taxonomyCalls += 1;
        if (taxonomyCalls === 1) {
          // Simulates the process racing the daily_skinny_taxonomy migration, or any
          // transient ClickHouse error.
          throw new Error("Table default.daily_skinny_taxonomy does not exist");
        }
        return { rows: taxonomyRows, provenance: {} };
      }
      return {
        rows: [
          activityRow({ subject: "ClickHouse", age: 0, talk_threads: "50", code_score: "5" }),
          activityRow({ subject: "ClickHouse", age: 1, talk_threads: "1", code_score: "1" }),
        ],
        provenance: {},
      };
    });

    const { dailyDigest } = await import("./digest");

    // First call: taxonomy fetch fails -> getTaxonomy() returns [] for this call only.
    // With no taxonomy entries, "ClickHouse" has no match and is filtered out (fix 1),
    // so the digest comes back empty rather than throwing.
    const first = await dailyDigest(0);
    expect(first.clusters).toHaveLength(0);

    // Second call: if the failure had been cached, getTaxonomy() would still return []
    // forever and this would stay empty. It must instead retry and pick up real data.
    const second = await dailyDigest(0);
    expect(second.clusters.map((cluster) => cluster.subject)).toContain("ClickHouse");

    expect(taxonomyCalls).toBe(2);
  });

  it("selects one recent FINAL story and derives themes from bounded evidence without changing numeric IDs", async () => {
    q.mockImplementation(async (_sql: string, tables: string[]) => {
      if (tables[0] === "daily_skinny_taxonomy") return { rows: taxonomyRows, provenance: {} };
      return { rows: [{ id: "900", title: "ClickHouse discussion" }], provenance: {} };
    });
    coreQ.mockResolvedValue({
      rows: [{
        id: 900, title: "ClickHouse discussion", url: "", by: "author", time: 1_700_000_000,
        score: "42", descendants: "4", kids: [901, 902, 903],
      },
      ],
    });

    const { threadInsights, DIGEST_THREAD_STORY_SQL } = await import("./digest");
    const result = await threadInsights("clickhouse");

    expect(DIGEST_THREAD_STORY_SQL).toContain("FROM raw.hackernews FINAL");
    expect(result?.evidence.story.id).toBe(900);
    expect(typeof result?.evidence.story.id).toBe("number");
    expect(coreQ).toHaveBeenCalledWith(expect.stringContaining("WHERE id = {storyId:UInt64}"), ["raw.hackernews"], expect.anything());
  });

  it("returns null for unknown topics or when no representative story exists", async () => {
    q.mockImplementation(async (_sql: string, tables: string[]) => {
      if (tables[0] === "daily_skinny_taxonomy") return { rows: taxonomyRows, provenance: {} };
      return { rows: [], provenance: {} };
    });
    const { threadInsights } = await import("./digest");
    await expect(threadInsights("does-not-exist")).resolves.toBeNull();
    await expect(threadInsights("clickhouse")).resolves.toBeNull();
    expect(coreQ).not.toHaveBeenCalled();
  });

  it("keeps insights optional and rejects malformed or over-bounded theme payloads", () => {
    expect(HnThreadInsightsSchema.safeParse({ evidence: {}, themes: [] }).success).toBe(false);
    const result = HnThreadInsightsSchema.safeParse({ evidence: {}, themes: Array.from({ length: 6 }, () => ({
      label: "theme", count: 2, coverage: 0.5, representativeCommentIds: [1], confidence: 0.8,
    })) });
    expect(result.success).toBe(false);
  });
});
