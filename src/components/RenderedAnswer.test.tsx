/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";

afterEach(() => cleanup());

describe("RenderedAnswer", () => {
  afterEach(() => {
    cleanup();
  });

  it("parses numeric values without reading the 30 out of field names", () => {
    const payload: RenderPayload = {
      type: "ticker",
      filter: "repos",
      generatedAt: "2026-07-23T08:00:00.000Z",
      items: [
        { kicker: "FORKED 24H", name: "alpha/repo", metric: "pushes_30d: 4", href: "https://example.com/alpha" },
        { kicker: "FORKED 24H", name: "beta/repo", metric: "pushes_30d: 9", href: "https://example.com/beta" },
      ],
    };

    const { container } = render(<RenderedAnswer payload={payload} />);
    const chart = container.querySelector("figure.chart svg");

    expect(chart).toBeInTheDocument();
    expect(chart?.textContent).toContain("4");
    expect(chart?.textContent).toContain("9");
    expect(chart?.textContent).not.toContain("30");
    expect(container.querySelectorAll("rect[fill='var(--cyan)']").length).toBeGreaterThan(0);
  });

  it("renders a real bar chart (not the placeholder table caption) for a Bar Chart morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      summary: "Top forked skills repos",
      query: {
        sql: "SELECT repo, github_forks FROM example ORDER BY github_forks DESC LIMIT 8",
        rowsRead: 4321,
        elapsedMs: 87,
      },
      chartConfig: {
        title: 'Top forked "skills" repos',
        encoding: {
          x: { field: "repo", type: "nominal", sort: "-y" },
          y: { field: "github_forks", type: "quantitative", title: "GitHub forks" },
          tooltip: [
            { field: "repo", title: "Repo" },
            { field: "github_forks", title: "Forks" },
            { field: "github_stars", title: "Stars" },
            { field: "pushes_30d", title: "Pushes (30d)" },
          ],
        },
        data: {
          values: [
            { repo: "mattpocock/mattpocock/skills", github_forks: 15667, github_stars: 183203, pushes_30d: 0 },
            { repo: "coreyhaines31/coreyhaines31/marketingskills", github_forks: 6505, github_stars: 41221, pushes_30d: 4 },
          ],
        },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(screen.getByText('Top forked "skills" repos')).toBeInTheDocument();
    // Real chart renders instead of the placeholder.
    expect(container.querySelector("figure.chart.bar-chart-horizontal svg")).toBeInTheDocument();
    expect(container.querySelectorAll("figure.chart svg rect").length).toBeGreaterThan(0);
    expect(screen.queryByText(/previewing .* markup/i)).not.toBeInTheDocument();
    // Table headers/data are still present, just collapsed inside <details>.
    const table = container.querySelector(".telemetry-table");
    expect(table).toBeInTheDocument();
    const tableScope = within(table as HTMLElement);
    expect(tableScope.getByText("Repo")).toBeInTheDocument();
    expect(tableScope.getByText("Forks")).toBeInTheDocument();
    expect(tableScope.getByText("Stars")).toBeInTheDocument();
    expect(tableScope.getByText("Pushes (30d)")).toBeInTheDocument();
    expect(tableScope.getByText("mattpocock/mattpocock/skills")).toBeInTheDocument();
    // Query analytics block is unchanged.
    expect(screen.getByText(/4,321 rows read · 87ms/i)).toBeInTheDocument();
  });

  it("renders a real area/line chart for a Line Graph morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Line Graph",
      generatedAt: "2026-07-23T08:27:40.000Z",
      summary: "HackerNews story volume, last 8 days",
      chartConfig: {
        title: "HN story volume",
        encoding: {
          x: { field: "day", type: "temporal" },
          y: { field: "stories", type: "quantitative", title: "stories" },
        },
        data: {
          values: [
            { day: "2026-07-16", stories: 553 },
            { day: "2026-07-17", stories: 812 },
            { day: "2026-07-18", stories: 940 },
            { day: "2026-07-19", stories: 1104 },
            { day: "2026-07-20", stories: 1367 },
            { day: "2026-07-21", stories: 1602 },
            { day: "2026-07-22", stories: 1890 },
            { day: "2026-07-23", stories: 2202 },
          ],
        },
        mark: { type: "line" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart svg polyline")).toBeInTheDocument();
    expect(screen.queryByText(/previewing .* markup/i)).not.toBeInTheDocument();
  });

  it("renders a PieChart for Pie Chart visualizationType", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Pie Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "github_forks",
        encoding: {
          x: { field: "repo", type: "nominal" },
          y: { field: "github_forks", type: "quantitative" },
        },
        data: {
          values: [
            { repo: "alpha/repo", github_forks: 100 },
            { repo: "beta/repo", github_forks: 200 },
          ],
        },
        mark: { type: "arc" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.pie-chart")).toBeInTheDocument();
    expect(screen.getAllByText("alpha/repo").length).toBeGreaterThan(0);
  });

  it("charts a tool-built Bar Chart card whose metric field is a numeric string with only a tooltip encoding", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        // buildMorphingCard (src/lib/agent-tools.ts) only emits encoding.tooltip,
        // never encoding.y -- and ClickHouse aggregates often serialize as strings.
        encoding: { tooltip: [{ field: "day" }, { field: "stories" }] },
        data: {
          values: [
            { day: "2026-07-22", stories: "1890" },
            { day: "2026-07-23", stories: "2202" },
          ],
        },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.bar-chart-horizontal svg")).toBeInTheDocument();
    expect(container.querySelectorAll("figure.chart svg rect").length).toBeGreaterThan(0);
  });

  it("renders an SVG chart for Stacked Bar Chart visualizationType", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Stacked Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        encoding: {
          x: { field: "repo", type: "nominal" },
          y: { field: "github_forks", type: "quantitative" },
        },
        data: {
          values: [
            { repo: "alpha/repo", github_forks: 100 },
            { repo: "beta/repo", github_forks: 200 },
          ],
        },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart")).toBeInTheDocument();
    expect(screen.getAllByText("alpha/repo").length).toBeGreaterThan(0);
  });

  it("renders a Spider Chart morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Spider Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "Builder profile",
        data: {
          values: [
            { name: "alpha", speed: 5, quality: 3, uptime: 4 },
            { name: "beta", speed: 2, quality: 4, uptime: 5 },
          ],
        },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.spider-chart svg")).toBeInTheDocument();
    expect(screen.queryByText(/previewing .* markup/i)).not.toBeInTheDocument();
  });

  it("renders a Scatterplot morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Scatterplot",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "Correlation",
        encoding: {
          x: { field: "repos", type: "quantitative" },
          y: { field: "pushes", type: "quantitative" },
        },
        data: {
          values: [
            { actor: "alpha", repos: 2, pushes: 10 },
            { actor: "beta", repos: 6, pushes: 4 },
          ],
        },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.scatterplot svg")).toBeInTheDocument();
  });

  it("labels scatterplot points with the repo field when no explicit encoding is provided", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Scatterplot",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "Correlation",
        data: {
          values: [
            { repo_name: "alpha/repo", github_stars: 2, github_forks: 10, language: "TypeScript" },
            { repo_name: "beta/repo", github_stars: 6, github_forks: 4, language: "Python" },
          ],
        },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);
    const chart = container.querySelector("figure.chart.scatterplot");

    expect(chart).toBeInTheDocument();
    expect(within(chart as HTMLElement).getByText("alpha/repo")).toBeInTheDocument();
    expect(within(chart as HTMLElement).getByText("beta/repo")).toBeInTheDocument();
  });

  it("renders a Gantt Chart morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Gantt Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "Timeline",
        data: {
          values: [
            { task: "Plan", start: "2026-07-01", end: "2026-07-03" },
            { task: "Ship", start: "2026-07-04", end: "2026-07-07" },
          ],
        },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.gantt-chart svg")).toBeInTheDocument();
  });

  it("renders a Bubble Chart morphing card", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bubble Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        title: "Three variables",
        encoding: {
          x: { field: "repos", type: "quantitative" },
          y: { field: "pushes", type: "quantitative" },
          size: { field: "commits", type: "quantitative" },
        },
        data: {
          values: [
            { actor: "alpha", repos: 2, pushes: 10, commits: 30 },
            { actor: "beta", repos: 6, pushes: 4, commits: 80 },
          ],
        },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart.bubble-chart svg")).toBeInTheDocument();
  });

  it("does not crash and does not chart when data.values is empty or insufficient", () => {
    const baseEncoding = {
      x: { field: "repo", type: "nominal" },
      y: { field: "github_forks", type: "quantitative" },
    };

    const emptyPayload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        encoding: baseEncoding,
        data: { values: [] },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    expect(() => render(<RenderedAnswer payload={emptyPayload} />)).not.toThrow();
    const { container: emptyContainer } = render(<RenderedAnswer payload={emptyPayload} />);
    expect(emptyContainer.querySelector("figure.chart")).not.toBeInTheDocument();

    const oneRowPayload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Bar Chart",
      generatedAt: "2026-07-23T08:27:40.000Z",
      chartConfig: {
        encoding: baseEncoding,
        data: { values: [{ repo: "alpha/repo", github_forks: 100 }] },
        mark: { type: "bar" },
      },
    } as RenderPayload;

    const { container: oneRowContainer } = render(<RenderedAnswer payload={oneRowPayload} />);
    expect(oneRowContainer.querySelector("figure.chart")).not.toBeInTheDocument();
  });

  describe("morphing-card regression #180", () => {
    it("renders a real chart for the exact confirmed-live-production Bar Chart payload (HN story volume, last 7 days)", () => {
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Bar Chart",
        generatedAt: "2026-07-23T09:00:00.000Z",
        summary: "HackerNews story volume over the last 7 days",
        chartConfig: {
          title: "HN story volume — last 7 days",
          encoding: {
            x: { field: "day", type: "nominal" },
            y: { field: "stories", type: "quantitative", title: "stories" },
          },
          data: {
            values: [
              { day: "2026-07-16", stories: 553 },
              { day: "2026-07-17", stories: 812 },
              { day: "2026-07-18", stories: 940 },
              { day: "2026-07-19", stories: 1104 },
              { day: "2026-07-20", stories: 1367 },
              { day: "2026-07-21", stories: 1602 },
              { day: "2026-07-22", stories: 1890 },
              { day: "2026-07-23", stories: 2202 },
            ],
          },
          mark: { type: "bar" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);

      expect(container.querySelector("figure.chart.bar-chart-horizontal svg")).toBeInTheDocument();
      expect(container.querySelectorAll("figure.chart svg rect").length).toBeGreaterThan(0);
      expect(screen.queryByText(/previewing .* markup/i)).not.toBeInTheDocument();
    });

    it("caps high-cardinality nominal Bar Chart items instead of crowding bars", () => {
      // Reproduces the reported "bar chart looks bad" regression: 28 unrelated
      // repos trimmed to top 15.
      const values = Array.from({ length: 28 }, (_, i) => ({
        repo: `owner${i}/repo-${i}`,
        stars: i === 0 ? 50_000 : 1 + (i % 5),
      }));
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Bar Chart",
        generatedAt: "2026-07-23T09:00:00.000Z",
        chartConfig: {
          encoding: {
            x: { field: "repo", type: "nominal" },
            y: { field: "stars", type: "quantitative" },
          },
          data: { values },
          mark: { type: "bar" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);

      const bars = container.querySelectorAll("figure.chart.bar-chart-horizontal svg g.bar-row");
      expect(bars.length).toBeLessThanOrEqual(15);
      for (const bar of Array.from(bars)) {
        const rects = bar.querySelectorAll("rect");
        expect(rects.length).toBeGreaterThan(0);
        const width = Number(rects[rects.length - 1]?.getAttribute("width"));
        expect(width).toBeGreaterThan(2);
      }
    });

    it("renders SVG PieChart for Pie Chart morphing cards", () => {
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Pie Chart",
        generatedAt: "2026-07-23T09:00:00.000Z",
        chartConfig: {
          title: "Share of Activity by Category",
          encoding: {
            x: { field: "category", type: "nominal" },
            y: { field: "share", type: "quantitative" },
          },
          data: {
            values: [
              { category: "React Ecosystem", share: 450 },
              { category: "AI & ML", share: 320 },
              { category: "Databases & Storage", share: 210 },
            ],
          },
          mark: { type: "arc" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);
      expect(container.querySelector("figure.chart.pie-chart svg")).toBeInTheDocument();
      expect(container.querySelectorAll("figure.chart.pie-chart path").length).toBe(3);
    });

    it("renders SVG StackedBarChart for Stacked Bar Chart morphing cards", () => {
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Stacked Bar Chart",
        generatedAt: "2026-07-23T09:00:00.000Z",
        chartConfig: {
          title: "Commits vs Pushes by Repo",
          encoding: {
            x: { field: "repo", type: "nominal" },
            y: { field: "count", type: "quantitative" },
            color: { field: "metric", type: "nominal" },
          },
          data: {
            values: [
              { repo: "clickhouse/clickhouse", metric: "commits", count: 120 },
              { repo: "clickhouse/clickhouse", metric: "pushes", count: 45 },
              { repo: "vercel/next.js", metric: "commits", count: 90 },
              { repo: "vercel/next.js", metric: "pushes", count: 30 },
            ],
          },
          mark: { type: "bar" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);
      expect(container.querySelector("figure.chart.stacked-bar-chart svg")).toBeInTheDocument();
    });

    it("renders SVG WaterfallChart for Waterfall Chart morphing cards", () => {
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Waterfall Chart",
        generatedAt: "2026-07-23T09:00:00.000Z",
        chartConfig: {
          title: "Activity Progression",
          encoding: {
            x: { field: "step", type: "nominal" },
            y: { field: "delta", type: "quantitative" },
            color: { field: "type", type: "nominal" },
          },
          data: {
            values: [
              { step: "Start", delta: 0, type: "baseline" },
              { step: "Pushes", delta: 120, type: "change" },
              { step: "PRs", delta: 45, type: "change" },
              { step: "Total", delta: 165, type: "total" },
            ],
          },
          mark: { type: "bar" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);
      expect(container.querySelector("figure.chart.waterfall-chart svg")).toBeInTheDocument();
    });

    it("renders SVG TreemapChart for Treemap morphing cards", () => {
      const payload: RenderPayload = {
        type: "morphing-card",
        visualizationType: "Treemap",
        generatedAt: "2026-07-23T09:00:00.000Z",
        chartConfig: {
          title: "Topic Volume Heatmap",
          encoding: {
            x: { field: "topic", type: "nominal" },
            y: { field: "volume", type: "quantitative" },
          },
          data: {
            values: [
              { topic: "vector-search", volume: 850 },
              { topic: "llm-inference", volume: 620 },
              { topic: "sql-engine", volume: 410 },
            ],
          },
          mark: { type: "rect" },
        },
      } as RenderPayload;

      const { container } = render(<RenderedAnswer payload={payload} />);
      expect(container.querySelector("figure.chart.treemap-chart svg")).toBeInTheDocument();
    });
  });
});

describe("RenderedAnswer copy-as-HTML button", () => {
  const tickerPayload: RenderPayload = {
    type: "ticker",
    filter: "repos",
    generatedAt: "2026-07-23T08:00:00.000Z",
    items: [
      { kicker: "STARS", name: "alpha/repo", metric: "stars_24h: 42", href: "https://github.com/alpha/repo" },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("ClipboardItem", class {
      constructor(items: Record<string, Blob>) {
        Object.assign(this, items);
      }
    });
    vi.stubGlobal("navigator", {
      clipboard: {
        write: vi.fn(() => Promise.resolve()),
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Copy as Markdown and Copy as HTML buttons", () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    expect(screen.getAllByRole("button", { name: "Copy as Markdown" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Copy as HTML" }).length).toBeGreaterThan(0);
  });

  it("shows Copied MD! feedback after clicking Copy as Markdown", async () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as Markdown" });
    await act(() => fireEvent.click(btns[0]));
    expect(screen.getByText("Copied MD!")).toBeInTheDocument();
  });

  it("calls clipboard.write with a ClipboardItem containing text/html for HTML copy", async () => {
    const writeSpy = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      clipboard: { write: writeSpy, writeText: vi.fn(() => Promise.resolve()) },
    });
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as HTML" });
    await act(() => fireEvent.click(btns[0]));
    await waitFor(() => expect(writeSpy).toHaveBeenCalledTimes(1));
    const items = (writeSpy.mock.calls[0] as unknown[])[0] as unknown[];
    expect(items).toHaveLength(1);
  });

  it("reverts to Copy as Markdown label after 2 seconds", async () => {
    render(<RenderedAnswer payload={tickerPayload} />);
    const btns = screen.getAllByRole("button", { name: "Copy as Markdown" });
    await act(() => fireEvent.click(btns[0]));
    expect(screen.getByText("Copied MD!")).toBeInTheDocument();
  });
});

describe("RenderedAnswer table payload", () => {
  const tablePayload: RenderPayload = {
    type: "table",
    columns: [
      { key: "repo", label: "Repository", type: "string" },
      { key: "stars", label: "Stars", type: "number" },
      { key: "url", label: "URL", type: "link" },
    ],
    rows: [
      { repo: "acme/widgets", stars: 1500, url: "https://github.com/acme/widgets" },
      { repo: "acme/tools", stars: 800, url: "https://github.com/acme/tools" },
    ],
    totals: { stars: 2300 },
    summary: "Top ACME repos",
  };

  it("renders column headers from table payload", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("Repository")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("renders table cell values", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });

  it("renders link columns as anchor tags", () => {
    const { container } = render(<RenderedAnswer payload={tablePayload} />);
    const links = container.querySelectorAll("a[href='https://github.com/acme/widgets']");
    expect(links.length).toBeGreaterThan(0);
  });

  it("renders totals row", () => {
    const { container } = render(<RenderedAnswer payload={tablePayload} />);
    const tfoot = container.querySelector("tfoot");
    expect(tfoot).toBeInTheDocument();
    expect(tfoot?.textContent).toContain("Total");
    expect(tfoot?.textContent).toContain("2,300");
  });

  it("renders summary when provided", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText("Top ACME repos")).toBeInTheDocument();
  });

  it("shows column count and row count in header", () => {
    render(<RenderedAnswer payload={tablePayload} />);
    expect(screen.getByText(/3 columns/)).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
  });

  it("shows empty state when rows array is empty", () => {
    const empty: RenderPayload = {
      type: "table",
      columns: [{ key: "col", label: "Column", type: "string" }],
      rows: [],
    };
    render(<RenderedAnswer payload={empty} />);
    expect(screen.getByText("no rows returned")).toBeInTheDocument();
  });

  it("limits displayed rows to 20 and shows count note for larger datasets", () => {
    const manyRows = Array.from({ length: 25 }, (_, i) => ({ col: `row ${i + 1}` }));
    const big: RenderPayload = {
      type: "table",
      columns: [{ key: "col", label: "Col", type: "string" }],
      rows: manyRows,
    };
    const { container } = render(<RenderedAnswer payload={big} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(20);
    expect(screen.getByText(/showing 20 of 25/)).toBeInTheDocument();
  });

  it("renders Data Table morphing-card without previewing message", () => {
    const dtPayload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Data Table",
      generatedAt: "2026-07-23T08:27:40.000Z",
      summary: "Repo list",
      chartConfig: {
        data: {
          values: [
            { repo: "acme/widgets", stars: 1500 },
          ],
        },
        encoding: {
          tooltip: [
            { field: "repo", title: "Repo" },
            { field: "stars", title: "Stars" },
          ],
        },
      },
    };
    render(<RenderedAnswer payload={dtPayload} />);
    expect(screen.getByText("DATA TABLE")).toBeInTheDocument();
    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.queryByText(/previewing/)).not.toBeInTheDocument();
  });

  describe("Answer spec v1 — enhanced DualLine (4b)", () => {
    const divergencePayload: RenderPayload = {
      type: "divergence",
      subject: "htmx",
      verdict: { state: "DIVERGENT", metric: 2.4, metricLabel: "talk/code spread", rule: "7d avg >= 3x prior-23d avg" },
      days: ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"],
      talk: [1, 3, 5, 8, 10],
      code: [1, 1, 2, 2, 3],
      caption: "Chatter is outrunning shipping — reads as hype, not adoption.",
    };

    it("renders the enhanced chart idiom (area, band, peak, endpoint dots, maxGuide)", () => {
      const { container } = render(<RenderedAnswer payload={divergencePayload} />);
      const fig = container.querySelector("figure.chart.chart-enhanced");
      expect(fig).toBeInTheDocument();
      // area fill + divergence band polygons
      expect(container.querySelectorAll("figure.chart-enhanced svg polygon.ch-area").length).toBe(1);
      expect(container.querySelectorAll("figure.chart-enhanced svg polygon.ch-band").length).toBe(1);
      // two endpoint dots (one per series)
      expect(container.querySelectorAll("figure.chart-enhanced svg circle.ch-dot").length).toBe(2);
      // peak marker group with a "peak" label
      expect(container.querySelector("figure.chart-enhanced svg g.ch-peak")).not.toBeNull();
      expect(screen.getByText("peak")).toBeInTheDocument();
      // 30d max guide
      expect(screen.getByText("30d max")).toBeInTheDocument();
      // two lines (cyan talk + magenta code), each tagged with pathLength=1
      const lines = container.querySelectorAll("figure.chart-enhanced svg polyline.ch-line");
      expect(lines.length).toBe(2);
      expect(Array.from(lines).every((l) => l.getAttribute("pathLength") === "1")).toBe(true);
    });

    it("divergence band closes along the code series without mirroring it", () => {
      // Regression: the band polygon used to reverse only the x positions of the
      // code series, which mapped nb[0] onto x(last) — making the band mirror
      // the magenta line on asymmetric series. The polygon now traces back
      // along the actual code values (nb[last] -> nb[0]) at the reversed xs.
      const { container } = render(<RenderedAnswer payload={divergencePayload} />);
      const band = container.querySelector("figure.chart-enhanced svg polygon.ch-band") as Element | null;
      expect(band).not.toBeNull();
      const pts = (band?.getAttribute("points") ?? "").split(/\s+/).filter(Boolean);
      // 5 forward (talk) + 5 back (code) = 10 vertices for a 5-day series.
      expect(pts.length).toBe(divergencePayload.days.length * 2);
      // The first half traces talk (a) forward: pts[0] shares x with pts[1].
      // The reversed half closes back along code (b): its last vertex must
      // share its x with the first talk vertex (the polygon closes the loop).
      const first = pts[0].split(",");
      const last = pts[pts.length - 1].split(",");
      expect(last[0]).toBe(first[0]);
    });

    it("still renders the verdict + caption (anatomy steps 2 + 4)", () => {
      render(<RenderedAnswer payload={divergencePayload} />);
      expect(screen.getByText("DIVERGENT")).toBeInTheDocument();
      expect(screen.getByText("Chatter is outrunning shipping — reads as hype, not adoption.")).toBeInTheDocument();
    });

    it("echoes the question as a › prompt when the `question` prop is supplied (anatomy step 1)", () => {
      render(<RenderedAnswer payload={divergencePayload} question="is htmx hype or real?" />);
      const echo = screen.getByText(/is htmx hype or real\?/);
      expect(echo.className).toContain("agent-question-echo");
    });
  });

  describe("Answer spec v1 — fold all-zero KPIs (2a preview)", () => {
    function repoDrilldown(kpis24h: Record<string, number>): RenderPayload {
      return {
        type: "repo-drilldown",
        repoName: "langgenius/dify",
        generatedAt: new Date().toISOString(),
        metadata: { description: "x", language: "Python", topics: [], githubStars: 0, githubForks: 0, openIssues: 0 },
        kpis24h: {
          pushes: 0, commits: 0, distinctCommits: 0, forks: 0, stars: 0,
          issuesOpened: 0, prsOpened: 0, prsMerged: 0, actors: 0, ...kpis24h,
        },
        velocity: [],
        topActors24h: [],
        feed: [],
        query: { sql: "SELECT 1", rowsRead: 0, elapsedMs: 0 },
      } as RenderPayload;
    }

    it("folds an all-zero KPI strip to one muted chip line", () => {
      const { container } = render(<RenderedAnswer payload={repoDrilldown({})} />);
      // No nonzero KPI tiles when every KPI is zero.
      expect(container.querySelectorAll(".repo-kpi").length).toBe(0);
      // And exactly one muted fold-chip summarizing the flat window.
      const fold = container.querySelector(".repo-kpi-fold");
      expect(fold).not.toBeNull();
      expect(fold?.textContent ?? "").toMatch(/0 · 24h$/);
    });

    it("keeps nonzero KPIs as tiles and folds the remaining zeros to a chip", () => {
      const { container } = render(<RenderedAnswer payload={repoDrilldown({ pushes: 15, actors: 14 })} />);
      // 2 nonzero KPIs render as tiles (pushes, actors).
      expect(container.querySelectorAll(".repo-kpi").length).toBe(2);
      // The remaining 5 all-zero KPIs (stars, forks, PRs, merged, issues) fold to the chip.
      const fold = container.querySelector(".repo-kpi-fold");
      expect(fold).not.toBeNull();
      expect(fold?.textContent ?? "").toContain("stars");
      expect(fold?.textContent ?? "").toContain("issues");
      expect(fold?.textContent ?? "").toMatch(/0 · 24h$/);
    });
  });
});
