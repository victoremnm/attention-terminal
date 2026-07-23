// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HorizontalBarChart,
  PieChart,
  StackedBarChart,
  TreemapChart,
  WaterfallChart,
} from "./charts";

describe("SVG Chart Primitives Snapshot Regression Suite", () => {
  it("PieChart matches baseline SVG snapshot", () => {
    const { container } = render(
      <PieChart
        items={[
          { label: "Category A", value: 400 },
          { label: "Category B", value: 300 },
          { label: "Category C", value: 200 },
          { label: "Category D", value: 100 },
        ]}
        title="Distribution Snapshot"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("StackedBarChart matches baseline SVG snapshot", () => {
    const { container } = render(
      <StackedBarChart
        items={[
          {
            category: "repo-alpha",
            segments: [
              { key: "commits", label: "Commits", value: 100 },
              { key: "pushes", label: "Pushes", value: 50 },
            ],
          },
          {
            category: "repo-beta",
            segments: [
              { key: "commits", label: "Commits", value: 80 },
              { key: "pushes", label: "Pushes", value: 30 },
            ],
          },
        ]}
        title="Stacked Breakdown Snapshot"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("WaterfallChart matches baseline SVG snapshot", () => {
    const { container } = render(
      <WaterfallChart
        steps={[
          { label: "Base", delta: 100, type: "baseline" },
          { label: "Add", delta: 50, type: "change" },
          { label: "Sub", delta: -20, type: "change" },
          { label: "Total", delta: 130, type: "total" },
        ]}
        title="Waterfall Snapshot"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("TreemapChart matches baseline SVG snapshot", () => {
    const { container } = render(
      <TreemapChart
        items={[
          { label: "Tile 1", value: 5000 },
          { label: "Tile 2", value: 3000 },
          { label: "Tile 3", value: 2000 },
        ]}
        title="Treemap Snapshot"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("HorizontalBarChart matches baseline SVG snapshot", () => {
    const { container } = render(
      <HorizontalBarChart
        items={[
          { label: "repo-1", value: 1500 },
          { label: "repo-2", value: 1200 },
        ]}
        title="Bar Chart Snapshot"
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
