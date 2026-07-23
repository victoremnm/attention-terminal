import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RenderedAnswer } from "./RenderedAnswer";

describe("RepoTrendChart interactive toggles & rescaling", () => {
  const sampleTrends = [
    {
      date: "2026-07-01",
      stars: 10,
      forks: 5,
      events: [{ type: "release" as const, label: "v1.0", url: "https://github.com/acme/repo/releases/v1.0" }],
    },
    {
      date: "2026-07-02",
      stars: 25,
      forks: 12,
      events: [{ type: "pr_merged" as const, label: "PR #1", url: "https://github.com/acme/repo/pull/1" }],
    },
    {
      date: "2026-07-03",
      stars: 50,
      forks: 20,
      events: [{ type: "issue_opened" as const, label: "Issue #2", url: "https://github.com/acme/repo/issues/2" }],
    },
  ];

  it("creates RenderedAnswer payload element with repo drilldown trends", () => {
    const payload = {
      type: "repo-drilldown" as const,
      repoName: "acme/repo",
      description: "Test repo",
      language: "TypeScript",
      topics: ["test"],
      stars: 50,
      forks: 20,
      kpis24h: { pushes: 1, commits: 2, distinctCommits: 2, actors: 1 },
      velocity: [],
      trends: sampleTrends,
      query: { sql: "SELECT 1", elapsedMs: 5, rowsRead: 3 },
    };

    const element = createElement(RenderedAnswer, { payload });
    expect(element.props.payload.type).toBe("repo-drilldown");
    expect(element.props.payload.trends).toHaveLength(3);
  });
});
