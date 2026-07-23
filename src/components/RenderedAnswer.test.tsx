/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RenderPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";

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
    expect(container.querySelector("figure.chart.bar-chart-vertical svg")).toBeInTheDocument();
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

  it("falls back to the data table for unsupported visualization types (e.g. Pie Chart)", () => {
    const payload: RenderPayload = {
      type: "morphing-card",
      visualizationType: "Pie Chart",
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
        mark: { type: "arc" },
      },
    } as RenderPayload;

    const { container } = render(<RenderedAnswer payload={payload} />);

    expect(container.querySelector("figure.chart")).not.toBeInTheDocument();
    expect(screen.getByText(/previewing arc markup/i)).toBeInTheDocument();
    expect(screen.getByText("alpha/repo")).toBeInTheDocument();
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

      expect(container.querySelector("figure.chart.bar-chart-vertical svg")).toBeInTheDocument();
      expect(container.querySelectorAll("figure.chart svg rect").length).toBeGreaterThan(0);
      expect(screen.queryByText(/previewing .* markup/i)).not.toBeInTheDocument();
    });
  });
});
