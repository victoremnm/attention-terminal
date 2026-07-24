import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./queries/core", () => ({ q: query }));

import {
  buildHnThreadEvidence,
  HN_THREAD_EVIDENCE_SQL,
  hnThreadEvidence,
  sanitizeHnExcerpt,
} from "./hn-thread-metadata";

const story = {
  id: 100,
  title: "A bounded thread",
  url: "",
  by: "story-author",
  time: 1_700_000_000,
  score: 57,
  descendants: 57,
  kids: [101, 102],
};

function reply(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    parent: 100,
    by: "commenter",
    time: 1_700_000_100,
    score: 7,
    text: "<p>Hello <b>HN</b></p>",
    kids: [],
    depth: 1,
    ...overrides,
  };
}

describe("HN thread metadata", () => {
  it("returns nested replies with bounded depth and sanitized excerpts", () => {
    const result = buildHnThreadEvidence(story, [
      reply({ id: 101, kids: [103] }),
      reply({ id: 103, parent: 101, depth: 2, score: 9, text: "<script>alert(1)</script><p>Nested</p>" }),
      reply({ id: 102, parent: 100, score: 3 }),
    ]);

    expect(result.commentsObserved).toBe(3);
    expect(result.topLevelRepliesObserved).toBe(2);
    expect(result.depth).toEqual({ maxObserved: 2, limit: 3, bounded: true });
    expect(result.representativeReplies.map((item) => item.id)).toEqual([103, 101, 102]);
    expect(result.representativeReplies[0].excerpt).toBe("Nested");
    expect(result.depthProfile).toEqual([{ depth: 1, count: 2 }, { depth: 2, count: 1 }]);
    expect(result.descendantsReported).toBe(57);
  });

  it("marks missing comments as partial without failing the story result", () => {
    const result = buildHnThreadEvidence(story, [reply({ id: 101 })]);

    expect(result.commentsObserved).toBe(1);
    expect(result.topLevelRepliesObserved).toBe(1);
    expect(result.completeness).toEqual({ state: "partial", reason: "missing_items" });
  });

  it("deduplicates reinserted rows before counting and ordering", () => {
    const result = buildHnThreadEvidence(story, [
      reply({ id: 101, score: 7 }),
      reply({ id: 101, score: 70, text: "newer state" }),
      reply({ id: 102, score: 9 }),
    ]);

    expect(result.commentsObserved).toBe(2);
    expect(result.representativeReplies.map((item) => item.id)).toEqual([101, 102]);
    expect(result.representativeReplies[0].score).toBe(70);
  });

  it("keeps empty text as a valid empty excerpt", () => {
    expect(sanitizeHnExcerpt("<p></p>")).toBe("");
    expect(buildHnThreadEvidence(story, [reply({ text: "" })]).representativeReplies[0].excerpt).toBe("");
  });

  it("enforces comment, depth, branching, and representative limits", () => {
    const result = buildHnThreadEvidence(
      { ...story, kids: [101, 102, 103] },
      [
        reply({ id: 101, score: 7, kids: [201, 202, 203] }),
        reply({ id: 102, score: 8 }),
        reply({ id: 103, score: 9 }),
        reply({ id: 201, parent: 101, depth: 2, score: 10 }),
      ],
      { maxComments: 2, maxDepth: 1, maxBranching: 2, representativeLimit: 1 },
    );

    expect(result.commentsObserved).toBe(2);
    expect(result.representativeReplies).toHaveLength(1);
    expect(result.representativeReplies.every((item) => item.depth <= 1)).toBe(true);
    expect(result.sampling).toMatchObject({ maxComments: 2, maxDepth: 1, maxBranching: 2, truncated: true });
    expect(result.completeness.state).toBe("partial");
  });

  it("caps caller-provided limits to the bounded query budget", () => {
    const result = buildHnThreadEvidence(story, [], {
      maxComments: 10_000,
      maxDepth: 10_000,
      maxBranching: 10_000,
      representativeLimit: 10_000,
    });

    expect(result.sampling).toMatchObject({
      maxComments: 100,
      maxDepth: 3,
      maxBranching: 20,
      representativeLimit: 8,
    });
    expect(result.depth.limit).toBe(3);
    expect(result.branching.limit).toBe(20);
  });

  it("sorts numeric values numerically, so 57 ranks above 7", () => {
    const result = buildHnThreadEvidence(story, [
      reply({ id: 107, score: "7" }),
      reply({ id: 157, score: "57" }),
    ]);

    expect(result.representativeReplies.map((item) => item.id)).toEqual([157, 107]);
    expect(result.representativeReplies.map((item) => typeof item.score)).toEqual(["number", "number"]);
  });

  it("uses FINAL and bounded ANY joins in the read path", () => {
    expect(HN_THREAD_EVIDENCE_SQL.story).toContain("FROM raw.hackernews FINAL");
    expect(HN_THREAD_EVIDENCE_SQL.replies).toContain("INNER ANY JOIN");
    expect(HN_THREAD_EVIDENCE_SQL.replies).toContain("LIMIT {maxComments:UInt32}");
    expect(HN_THREAD_EVIDENCE_SQL.replies).toContain("{maxDepth:UInt8}");
  });

  it("pushes each bounded child-ID set into its FINAL reply read", () => {
    for (const level of [1, 2, 3]) {
      expect(HN_THREAD_EVIDENCE_SQL.replies).toContain(`WHERE id IN (SELECT id FROM level${level}_ids)`);
    }
  });

  it("returns null for a missing/deleted story and does not query replies", async () => {
    query.mockResolvedValue({ rows: [], provenance: {} });

    await expect(hnThreadEvidence(999)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
