/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RenderPayload } from "@/lib/render-payload";
import { RenderedAnswer } from "./RenderedAnswer";

describe("RenderedAnswer", () => {
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

  it("renders a table fallback and query analytics for morphing cards", () => {
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

    render(<RenderedAnswer payload={payload} />);

    expect(screen.getByText('Top forked "skills" repos')).toBeInTheDocument();
    expect(screen.getByText("Repo")).toBeInTheDocument();
    expect(screen.getByText("Forks")).toBeInTheDocument();
    expect(screen.getByText("Stars")).toBeInTheDocument();
    expect(screen.getByText("Pushes (30d)")).toBeInTheDocument();
    expect(screen.getByText("mattpocock/mattpocock/skills")).toBeInTheDocument();
    expect(screen.getByText(/previewing bar markup/i)).toBeInTheDocument();
    expect(screen.getByText(/4,321 rows read · 87ms/i)).toBeInTheDocument();
  });
});
