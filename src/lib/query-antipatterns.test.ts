/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import {
  analyzeQueryAntipatterns,
  buildLogComment,
  formatAntipatternHint,
  parseLogComment,
} from "./query-antipatterns";

// The exact failing query from the 2026-07-24 production timeout — kept
// verbatim as the regression anchor. If the analyzer ever stops flagging this
// it's a regression that re-opens the timeout bug. See issue #236 and the
// LESSONS-LEARNED-500-TIMEOUTS doc.
const PRODUCTION_TIMEOUT_QUERY = `SELECT
  time,
  id,
  title,
  score,
  descendants AS comments,
  url
FROM default.hackernews FINAL
WHERE type = 'story'
  AND deleted = 0
  AND dead = 0
  AND (lower(title) LIKE '%htmx%' OR lower(text) LIKE '%htmx%' OR lower(url) LIKE '%htmx%')
  AND time >= now() - INTERVAL 30 DAY
ORDER BY time DESC
LIMIT 20`;

function hitIds(sql: string): string[] {
  return analyzeQueryAntipatterns(sql).map((h) => h.id);
}

describe("query-antipatterns — production-timeout regression", () => {
  it("flags the 2026-07-24 htmx timeout query as leading-wildcard-like (P1)", () => {
    const hits = analyzeQueryAntipatterns(PRODUCTION_TIMEOUT_QUERY);
    const p1 = hits.filter((h) => h.severity === "P1");
    expect(p1.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === "leading-wildcard-like")).toBe(true);
    expect(formatAntipatternHint(hits)).toMatch(/blocked by the antipattern analyzer/i);
  });
});

describe("query-antipatterns — known-good curated queries (zero false positives)", () => {
  // Raw hackernews read with a tight (6h) time bound — should NOT trip
  // raw-table-full-scan. From queries.ts: ticker story breakout.
  it("allows tight-time-bounded raw.hackernews read", () => {
    const sql = `SELECT id, title AS name, score, round(score / greatest((now() - time) / 3600, 0.5), 1) AS velocity
       FROM raw.hackernews FINAL
       WHERE type = 'story' AND time > now() - INTERVAL 6 HOUR
         AND score >= 10 AND deleted = 0 AND dead = 0
       ORDER BY velocity DESC LIMIT 20`;
    expect(hitIds(sql)).toEqual([]);
  });

  // WITH-bound scalar subquery on max(hour) — should NOT trip the correlated
  // scalar subquery rule (the WITH binding is the lesson-#2 fix).
  it("allows WITH-bound max(high-water-mark) scalar in a rollup read", () => {
    const sql = `WITH
         (SELECT max(hour) FROM gh_repo_hourly) AS max_h,
         per_repo_event AS (
           SELECT repo_name, event_type, countMerge(events) AS event_count
           FROM gh_repo_hourly
           WHERE hour > max_h - INTERVAL 24 HOUR
             AND event_type IN ('ForkEvent', 'WatchEvent', 'PushEvent', 'PullRequestEvent', 'IssuesEvent')
           GROUP BY repo_name, event_type
         )
         SELECT repo_name FROM per_repo_event LIMIT 5`;
    expect(hitIds(sql)).toEqual([]);
  });

  // Tokenized search on the raw table — the *correct* alternative to a
  // leading-wildcard LIKE — should NOT trip any rule.
  it("allows tokenized position() search instead of LIKE '%needle%'", () => {
    const sql = `SELECT time, id, title FROM default.hackernews FINAL
       WHERE type = 'story' AND deleted = 0
         AND position(lower(title), 'htmx') > 0
         AND time >= now() - INTERVAL 24 HOUR
       ORDER BY score DESC LIMIT 20`;
    expect(hitIds(sql)).toEqual([]);
  });

  // Rollup-table reads with their own time bound — no false-positive scan.
  it("allows gh_repo_hourly read with a tight hour predicate", () => {
    const sql = `SELECT repo_name, countMerge(events) AS clicks
                 FROM gh_repo_hourly
                 WHERE hour >= now() - INTERVAL 30 DAY
                   AND repo_name = 'langgenius/dify'
                 GROUP BY repo_name LIMIT 20`;
    expect(hitIds(sql)).toEqual([]);
  });

  it.each([
    "lower(actor_login) LIKE '%[bot]%'",
    "lower(actor_login) NOT LIKE '%[bot]%'",
    "lower(bucket.actor_login) LIKE '%[bot]%'",
  ])("allows documented bot predicate: %s", (predicate) => {
    expect(hitIds(`SELECT actor_login FROM gh_actor_daily WHERE day >= now() - INTERVAL 1 DAY AND ${predicate}`)).toEqual([]);
  });
});

describe("query-antipatterns — per-rule positive coverage", () => {
  it("leading-wildcard-like (P1) — bare col LIKE '%x%'", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT title FROM hackernews WHERE title LIKE '%htmx%'`
    );
    expect(hits.some((h) => h.id === "leading-wildcard-like" && h.severity === "P1")).toBe(true);
  });

  it("leading-wildcard-like (P1) — ILIKE with leading %", () => {
    const hits = analyzeQueryAntipatterns(`SELECT * FROM x WHERE name ILIKE '%foo%'`);
    expect(hits.some((h) => h.id === "leading-wildcard-like")).toBe(true);
  });

  it("still rejects non-bot leading-wildcard LIKE predicates", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT title FROM hackernews WHERE lower(title) LIKE '%htmx%'`
    );
    expect(hits.some((h) => h.id === "leading-wildcard-like" && h.severity === "P1")).toBe(true);
  });

  it("still rejects an unindexed actor bot LIKE predicate", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT actor_login FROM gh_actor_daily WHERE actor_login LIKE '%[bot]%'`
    );
    expect(hits.some((h) => h.id === "leading-wildcard-like" && h.severity === "P1")).toBe(true);
  });

  it("function-wrapped-predicate (P1) — lower(time) or toString(created_at) in WHERE", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT * FROM hackernews WHERE lower(time) = '2026-07-01' LIMIT 5`
    );
    expect(hits.some((h) => h.id === "function-wrapped-predicate" && h.severity === "P1")).toBe(true);
  });

  it("correlated-scalar-subquery (P1) — max() in WHERE without WITH binding", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT * FROM gh_repo_hourly WHERE hour > (SELECT max(hour) FROM gh_repo_hourly) - INTERVAL 24 HOUR`
    );
    expect(hits.some((h) => h.id === "correlated-scalar-subquery" && h.severity === "P1")).toBe(true);
  });

  it("raw-table-full-scan (P2) — raw.hackernews with no time predicate", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT id, title FROM raw.hackernews FINAL WHERE type = 'story' LIMIT 20`
    );
    const hit = hits.find((h) => h.id === "raw-table-full-scan");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("P2");
  });

  it("left-join-raw-event-view (P2) — LEFT JOIN gh_repo_activity_feed", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT a.repo, b.cnt
       FROM gh_repo_daily a
       LEFT JOIN gh_repo_activity_feed b ON a.repo_name = b.repo_name
       LIMIT 5`
    );
    expect(hits.some((h) => h.id === "left-join-raw-event-view" && h.severity === "P2")).toBe(true);
  });

  it("numeric-to-string-roundtrip (P3) — toString(round()) AS alias ORDER BY toFloat64(alias)", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT repo_name, toString(round(stars)) AS score FROM gh_repo_daily ORDER BY toFloat64(score) DESC LIMIT 10`
    );
    expect(hits.some((h) => h.id === "numeric-to-string-roundtrip" && h.severity === "P3")).toBe(true);
  });

  it("ilike-leading-wildcard (P3) — ILIKE '%[bot]%'", () => {
    const hits = analyzeQueryAntipatterns(
      `SELECT * FROM gh_actor_daily WHERE author ILIKE '%[bot]%' LIMIT 5`
    );
    const hit = hits.find((h) => h.id === "ilike-leading-wildcard");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("P3");
  });
});

describe("query-antipatterns — formatAntipatternHint output shape", () => {
  it("is empty when there are no P1 hits", () => {
    expect(formatAntipatternHint([])).toBe("");
    expect(
      formatAntipatternHint([{ id: "p3", severity: "P3", title: "x", why: "y", evidence: "z", fix: "w" }])
    ).toBe("");
  });

  it("includes the rule id + fix in the gate message", () => {
    const sql = `SELECT title FROM raw.hackernews WHERE title LIKE '%htmx%'`;
    const hint = formatAntipatternHint(analyzeQueryAntipatterns(sql));
    expect(hint).toMatch(/blocked by the antipattern analyzer/);
    expect(hint).toMatch(/leading-wildcard-like/);
    expect(hint).toMatch(/position\(.*?\).*?>\s*0/);
  });
});

describe("query-antipatterns — log_comment build/parse (round-trip)", () => {
  it("builds the stable pipe-tag and round-trips it", () => {
    const tag = buildLogComment({
      runId: "run_abc",
      chatId: "chat_xyz",
      turn: 3,
      step: 2,
      toolName: "runReadOnlyQuery",
      surface: "htmx-divergence",
      queryId: "qid9f1",
    });
    expect(tag).toBe(
      "attn | run=run_abc | chat=chat_xyz | turn=3 | step=2 | tool=runReadOnlyQuery | surface=htmx-divergence | qid=qid9f1"
    );
    const parsed = parseLogComment(tag);
    expect(parsed.isAttentionQuery).toBe(true);
    expect(parsed.runId).toBe("run_abc");
    expect(parsed.chatId).toBe("chat_xyz");
    expect(parsed.turn).toBe(3);
    expect(parsed.step).toBe(2);
    expect(parsed.toolName).toBe("runReadOnlyQuery");
    expect(parsed.surface).toBe("htmx-divergence");
    expect(parsed.queryId).toBe("qid9f1");
  });

  it("omits empty fields and still parses", () => {
    const tag = buildLogComment({ toolName: "describeTable" });
    expect(tag).toBe("attn | tool=describeTable");
    const parsed = parseLogComment(tag);
    expect(parsed.toolName).toBe("describeTable");
    expect(parsed.runId).toBeUndefined();
  });

  it("parses a non-attn log_comment as not an attention query", () => {
    const parsed = parseLogComment("some random server comment");
    expect(parsed.isAttentionQuery).toBe(false);
  });

  it("parses null/undefined/empty without throwing", () => {
    expect(parseLogComment(null).isAttentionQuery).toBe(false);
    expect(parseLogComment(undefined).isAttentionQuery).toBe(false);
    expect(parseLogComment("").isAttentionQuery).toBe(false);
  });
});
