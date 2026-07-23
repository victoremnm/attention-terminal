/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RenderedAnswer } from "./RenderedAnswer";
import type { MorphingCardPayload } from "@/lib/render-payload";

// Coverage for issue #143 (progressive-enhancement payload: summary + data
// render immediately, visualization lazy-loads) and issue #144/#141 (no
// literal "[Morphing Canvas ...]" placeholder ever reaches the user).

function basePayload(overrides: Partial<MorphingCardPayload> = {}): MorphingCardPayload {
  return {
    type: "morphing-card",
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RenderedAnswer / morphing-card", () => {
  it("never renders the legacy canvas placeholder text", () => {
    const { container } = render(
      <RenderedAnswer
        payload={basePayload({
          summary: "htmx chatter is up 3x this week.",
          data: [{ repo: "bigskysoftware/htmx", stars: 42 }],
        })}
      />
    );
    expect(container.textContent).not.toContain("Morphing Canvas");
    expect(container.textContent).not.toContain("[");
  });

  it("renders the summary immediately via markdown", () => {
    render(<RenderedAnswer payload={basePayload({ summary: "**bold** takeaway" })} />);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders data as an HTML table with the right rows and columns", () => {
    const { container } = render(
      <RenderedAnswer
        payload={basePayload({
          data: [
            { repo: "a/a", stars: 10 },
            { repo: "b/b", stars: 20 },
          ],
        })}
      />
    );
    const table = container.querySelector("table.agent-data-table");
    expect(table).toBeInTheDocument();
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("a/a")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("renders a freshness badge when present", () => {
    render(<RenderedAnswer payload={basePayload({ summary: "x", freshness: "github_events · 12m old" })} />);
    expect(screen.getByText("github_events · 12m old")).toBeInTheDocument();
  });

  it("renders a supported chart type (Bar Chart) instead of a placeholder", () => {
    const { container } = render(
      <RenderedAnswer
        payload={basePayload({
          data: [
            { repo: "a/a", stars: 10 },
            { repo: "b/b", stars: 20 },
          ],
          visualization: {
            visualizationType: "Bar Chart",
            chartConfig: { axesMapping: { x: "repo", y: "stars" } },
          },
        })}
      />
    );
    // jsdom has no IntersectionObserver, so the lazy wrapper falls back to
    // rendering eagerly rather than hiding the chart forever.
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("falls back to the data table (no chart, no placeholder) for an unsupported chart type", () => {
    const { container } = render(
      <RenderedAnswer
        payload={basePayload({
          data: [{ from: "a", to: "b", value: 5 }],
          visualization: {
            visualizationType: "Sankey Diagram",
            chartConfig: {},
          },
        })}
      />
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.querySelector("table.agent-data-table")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Morphing Canvas");
  });

  it("supports the legacy top-level visualizationType/chartConfig shape for backward compatibility", () => {
    const legacy = {
      type: "morphing-card" as const,
      generatedAt: new Date().toISOString(),
      visualizationType: "Bar Chart" as const,
      chartConfig: { axesMapping: { x: "repo", y: "stars" } },
      summary: "legacy shape",
      data: [
        { repo: "a/a", stars: 10 },
        { repo: "b/b", stars: 20 },
      ],
    };
    const { container } = render(<RenderedAnswer payload={legacy} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Morphing Canvas");
  });

  it("shows an explicit empty state instead of nothing when the payload has no content", () => {
    render(<RenderedAnswer payload={basePayload({})} />);
    expect(screen.getByText(/no structured data returned/i)).toBeInTheDocument();
  });
});

describe("RenderedAnswer / freshness on existing answer types", () => {
  it("renders freshness on a divergence payload when present", () => {
    render(
      <RenderedAnswer
        payload={{
          type: "divergence",
          subject: "htmx",
          verdict: { state: "BREAKOUT", metric: 3, metricLabel: "x talk", rule: "z>2" },
          days: ["2026-07-01", "2026-07-02"],
          talk: [1, 2],
          code: [1, 1],
          caption: "talk is outpacing code.",
          freshness: "hackernews · 2m old",
        }}
      />
    );
    expect(screen.getByText("hackernews · 2m old")).toBeInTheDocument();
  });
});
