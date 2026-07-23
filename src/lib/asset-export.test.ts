/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAssetAsHTML, exportAssetAsMarkdown, copyToClipboard } from "./asset-export";

describe("exportAssetAsMarkdown", () => {
  it("exports digest payload to clean Markdown table", () => {
    const md = exportAssetAsMarkdown(digestPayload);
    expect(md).toContain("### THE DAILY SKINNY");
    expect(md).toContain("htmx is hot");
    expect(md).toContain("ACCELERATING");
    expect(md).toContain("| Verdict | Subject | Share | Sources |");
  });

  it("exports ticker payload to Markdown table", () => {
    const md = exportAssetAsMarkdown(tickerPayload);
    expect(md).toContain("### BREAKOUT TICKER · repos");
    expect(md).toContain("alpha/repo");
    expect(md).toContain("beta/repo");
  });

  it("exports divergence payload to Markdown table", () => {
    const md = exportAssetAsMarkdown(divergencePayload);
    expect(md).toContain("### htmx vs alpine");
    expect(md).toContain("**DIVERGENT**");
    expect(md).toContain("| Day | Talk Volume | Code Activity |");
  });

  it("exports candles payload to Markdown table", () => {
    const md = exportAssetAsMarkdown(candlesPayload);
    expect(md).toContain("### react momentum");
    expect(md).toContain("**ACCELERATING**");
  });

  it("exports matrix payload to Markdown table", () => {
    const md = exportAssetAsMarkdown(matrixPayload);
    expect(md).toContain("MOMENTUM MATRIX");
    expect(md).toContain("htmx");
    expect(md).toContain("alpine");
  });

  it("exports repo-drilldown payload to Markdown summary", () => {
    const md = exportAssetAsMarkdown(repoDrilldownPayload);
    expect(md).toContain("### Repo Drilldown: [acme/widgets]");
    expect(md).toContain("alice");
  });
});
import type { RenderPayload } from "./render-payload";

const digestPayload: RenderPayload = {
  type: "digest",
  generatedAt: "2026-01-01T00:00:00Z",
  noiseFloor: 0.05,
  clusters: [
    {
      id: "c1",
      subject: "htmx is hot",
      verdict: "ACCELERATING",
      band: "shipping",
      skinny: "htmx is gaining traction",
      talkShare: 0.42,
      spark: [1, 2, 3, 4],
      sources: { hnThreads: 5, comments: 100, ghStars24h: 50, repos: 10 },
      links: { hn: "https://news.ycombinator.com/", github: "https://github.com/" },
    },
  ],
};

const tickerPayload: RenderPayload = {
  type: "ticker",
  filter: "repos",
  generatedAt: "2026-01-01T00:00:00Z",
  items: [
    { kicker: "STARS", name: "alpha/repo", metric: "stars_24h: 42", href: "https://github.com/alpha/repo" },
    { kicker: "FORKS", name: "beta/repo", metric: "forks_24h: 12", href: "https://github.com/beta/repo" },
  ],
};

const divergencePayload: RenderPayload = {
  type: "divergence",
  subject: "htmx vs alpine",
  verdict: { state: "DIVERGENT", metric: 2.5, metricLabel: "ratio", rule: "divergence detected" },
  days: ["2026-01-01", "2026-01-02", "2026-01-03"],
  talk: [10, 20, 30],
  code: [5, 15, 25],
  caption: "Talk outpaces code",
};

const candlesPayload: RenderPayload = {
  type: "candles",
  subject: "react momentum",
  verdict: { state: "ACCELERATING", metric: 1.5, metricLabel: "velocity", rule: "accelerating" },
  days: ["2026-01-01", "2026-01-02", "2026-01-03"],
  values: [10, 20, 30],
  caption: "React is accelerating",
};

const matrixPayload: RenderPayload = {
  type: "matrix",
  generatedAt: "2026-01-01T00:00:00Z",
  topics: [
    { name: "htmx", volume: 100, velocity: 2.5, ghShare: 0.6 },
    { name: "alpine", volume: 50, velocity: 1.2, ghShare: 0.3 },
  ],
};

const morphingPayload: RenderPayload = {
  type: "morphing-card",
  visualizationType: "Bar Chart" as never,
  generatedAt: "2026-01-01T00:00:00Z",
  chartConfig: {},
  summary: "Top repos by stars",
};

const skinnyDeckPayload: RenderPayload = {
  type: "skinny-deck",
  dateStr: "2026-01-01",
  generatedAt: "2026-01-01T00:00:00Z",
  cards: [
    {
      id: "card1",
      subject: "htmx is hot",
      verdict: "ACCELERATING",
      metric: "2.5x",
      metricLabel: "velocity",
      caption: "htmx is accelerating",
      sources: "5 HN · 10 repos",
      visual: { kind: "candles", days: ["d1", "d2"], values: [1, 2] },
      query: { sql: "SELECT 1", rowsRead: 100, elapsedMs: 50 },
    },
  ],
};

const repoDrilldownPayload: RenderPayload = {
  type: "repo-drilldown",
  repoName: "acme/widgets",
  generatedAt: "2026-01-01T00:00:00Z",
  metadata: {
    description: "Widget factory",
    language: "TypeScript",
    topics: ["widgets"],
    githubStars: 500,
    githubForks: 50,
    openIssues: 10,
  },
  kpis24h: {
    pushes: 10, commits: 20, distinctCommits: 15, forks: 2, stars: 5,
    issuesOpened: 1, prsOpened: 3, prsMerged: 1, actors: 4,
  },
  velocity: [
    { hour: "2026-01-01T00:00:00Z", pushes: 1, commits: 2, forks: 0, stars: 0, issuesOpened: 0, prsOpened: 0 },
    { hour: "2026-01-01T01:00:00Z", pushes: 2, commits: 3, forks: 1, stars: 1, issuesOpened: 0, prsOpened: 1 },
  ],
  topActors24h: [
    { actor: "alice", pushes: 5, commits: 10, distinctCommits: 8, prsOpened: 2, prsMerged: 1 },
  ],
  feed: [
    { at: "2026-01-01T00:00:00Z", actor: "alice", eventType: "PushEvent", action: "", commits: 2, distinctCommits: 2, merged: false },
  ],
  query: { sql: "SELECT 1", rowsRead: 200, elapsedMs: 100 },
};

describe("exportAssetAsHTML", () => {
  it("exports digest payload to self-contained HTML", () => {
    const html = exportAssetAsHTML(digestPayload);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>");
    expect(html).toContain("THE DAILY SKINNY");
    expect(html).toContain("htmx is hot");
    expect(html).toContain("ACCELERATING");
    expect(html).toContain("<svg");
  });

  it("exports ticker payload to HTML with card grid", () => {
    const html = exportAssetAsHTML(tickerPayload);
    expect(html).toContain("BREAKOUT TICKER");
    expect(html).toContain("alpha/repo");
    expect(html).toContain("beta/repo");
  });

  it("exports divergence payload to HTML with dual-line SVG", () => {
    const html = exportAssetAsHTML(divergencePayload);
    expect(html).toContain("htmx vs alpine");
    expect(html).toContain("DIVERGENT");
    expect(html).toContain("<svg");
    expect(html).toContain("polyline");
  });

  it("exports candles payload to HTML with area chart SVG", () => {
    const html = exportAssetAsHTML(candlesPayload);
    expect(html).toContain("react momentum");
    expect(html).toContain("ACCELERATING");
    expect(html).toContain("<polygon");
    expect(html).toContain("<polyline");
  });

  it("exports matrix payload to HTML with topic bars", () => {
    const html = exportAssetAsHTML(matrixPayload);
    expect(html).toContain("MOMENTUM MATRIX");
    expect(html).toContain("htmx");
    expect(html).toContain("alpine");
    expect(html).toContain("topic-bar");
  });

  it("exports morphing-card payload to HTML with summary", () => {
    const html = exportAssetAsHTML(morphingPayload);
    expect(html).toContain("BAR CHART");
    expect(html).toContain("Top repos by stars");
  });

  it("exports skinny-deck payload to HTML with card summaries", () => {
    const html = exportAssetAsHTML(skinnyDeckPayload);
    expect(html).toContain("DAILY SKINNY DECK");
    expect(html).toContain("htmx is hot");
    expect(html).toContain("2.5x");
  });

  it("exports repo-drilldown payload to HTML with KPIs and velocity chart", () => {
    const html = exportAssetAsHTML(repoDrilldownPayload);
    expect(html).toContain("REPO DRILL-DOWN");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("pushes 24h");
    expect(html).toContain("<svg");
    expect(html).toContain("alice");
  });

  it("all exports are self-contained (inline styles, no external resources)", () => {
    const payloads = [digestPayload, tickerPayload, divergencePayload, candlesPayload, matrixPayload, morphingPayload, skinnyDeckPayload, repoDrilldownPayload];
    for (const p of payloads) {
      const html = exportAssetAsHTML(p);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<style>");
      expect(html).not.toContain('href="http');
      expect(html).not.toMatch(/<link[^>]*>/);
    }
  });
});

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.stubGlobal("ClipboardItem", class {
      constructor(items: Record<string, Blob>) {
        Object.assign(this, items);
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses ClipboardItem with text/html and text/plain when available", async () => {
    const writeSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy, writeText: vi.fn(() => Promise.resolve()) },
    });

    await copyToClipboard("<p>hello</p>", "html");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const items = (writeSpy.mock.calls[0] as unknown[])[0] as unknown[];
    expect(items).toHaveLength(1);
  });

  it("falls back to writeText when ClipboardItem is unavailable", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const writeTextSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextSpy, write: vi.fn(() => Promise.resolve()) },
    });

    await copyToClipboard("<p>hello</p>");
    expect(writeTextSpy).toHaveBeenCalledWith("<p>hello</p>");
  });

  it("throws when clipboard API is completely unavailable", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: undefined });

    await expect(copyToClipboard("<p>hello</p>")).rejects.toThrow("Clipboard API unavailable");
  });
});

const tablePayload: RenderPayload = {
  type: "table",
  columns: [
    { key: "repo", label: "Repository", type: "string" },
    { key: "stars", label: "Stars", type: "number" },
    { key: "forks", label: "Forks", type: "number" },
    { key: "url", label: "URL", type: "link" },
  ],
  rows: [
    { repo: "acme/widgets", stars: 1500, forks: 300, url: "https://github.com/acme/widgets" },
    { repo: "acme/tools", stars: 800, forks: 120, url: "https://github.com/acme/tools" },
    { repo: "acme/libs", stars: 250, forks: 45, url: "https://github.com/acme/libs" },
  ],
  totals: { stars: 2550, forks: 465 },
  summary: "Top ACME repositories by engagement",
  query: { sql: "SELECT repo, stars, forks FROM repos ORDER BY stars DESC", rowsRead: 500, elapsedMs: 30 },
};

describe("table payload export", () => {
  it("exports table payload to self-contained HTML with column types and alignment", () => {
    const html = exportAssetAsHTML(tablePayload);
    expect(html).toContain("DATA TABLE");
    expect(html).toContain("Repository");
    expect(html).toContain("Stars");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("1,500");
    expect(html).toContain("<a href=");
    expect(html).toContain("Total");
    expect(html).toContain("2,550");
    expect(html).toContain("Top ACME");
  });

  it("exports table payload to Markdown table with right-aligned number columns", () => {
    const md = exportAssetAsMarkdown(tablePayload);
    expect(md).toContain("DATA TABLE");
    expect(md).toContain("Repository");
    expect(md).toContain("acme/widgets");
    expect(md).toContain("1,500");
    expect(md).toContain("---:");
    expect(md).toContain("**Total**");
    expect(md).toContain("**2,550**");
  });
});