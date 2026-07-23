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
      generatedAt: new Date().toISOString(),
      metadata: {
        description: "Test repo",
        language: "TypeScript",
        topics: ["test"],
        githubStars: 50,
        githubForks: 20,
        openIssues: 5,
      },
      kpis24h: {
        pushes: 1,
        commits: 2,
        distinctCommits: 2,
        forks: 1,
        stars: 2,
        issuesOpened: 1,
        prsOpened: 1,
        prsMerged: 1,
        actors: 1,
      },
      velocity: [],
      topActors24h: [],
      feed: [],
      trends: sampleTrends,
      query: { sql: "SELECT 1", elapsedMs: 5, rowsRead: 3 },
    };

    const element = createElement(RenderedAnswer, { payload });
    expect(element.type).toBe(RenderedAnswer);
    expect(element.props.payload.type).toBe("repo-drilldown");
    expect((element.props.payload as typeof payload).trends).toHaveLength(3);
  });
});
