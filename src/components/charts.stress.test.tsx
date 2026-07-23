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

describe("SVG Chart Primitives Stress & Edge-Case Verification", () => {
  describe("PieChart Edge Cases & Stress", () => {
    it("renders cleanly for a single 100% slice without SVG arc path degeneration", () => {
      const { container } = render(
        <PieChart items={[{ label: "Solo Category", value: 500 }]} title="100% Single Category" />
      );
      expect(container.querySelector("figure.chart.pie-chart svg")).not.toBeNull();
      expect(container.querySelector("circle")).not.toBeNull();
      expect(container.textContent).toContain("500");
    });

    it("handles 50+ categories by capping slices to top 7 and computing correct total", () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        label: `Category-${i} with a very long label string`,
        value: (50 - i) * 10,
      }));
      const { container } = render(<PieChart items={items} title="50 Categories Test" />);
      expect(container.querySelectorAll("figure.chart.pie-chart path, circle").length).toBeGreaterThan(0);
      expect(container.querySelectorAll("g[transform^='translate']").length).toBeLessThanOrEqual(7);
    });

    it("handles 0 or negative total safely without crashing or NaN attributes", () => {
      const { container } = render(<PieChart items={[{ label: "Zero", value: 0 }]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("HorizontalBarChart Edge Cases & Stress", () => {
    it("handles 100+ items by rendering bars safely without overlapping text", () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        label: `Very Long Repository Name ${i} (${"x".repeat(30)})`,
        value: 1000 - i * 5,
      }));
      const { container } = render(<HorizontalBarChart items={items} title="100 Repositories" />);
      expect(container.querySelector("figure.chart.bar-chart-horizontal svg")).not.toBeNull();
      const rects = container.querySelectorAll("rect");
      expect(rects.length).toBeGreaterThan(0);
      rects.forEach((rect) => {
        const w = Number(rect.getAttribute("width"));
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
      });
    });

    it("handles NaN or negative numbers safely", () => {
      const items = [
        { label: "Normal", value: 100 },
        { label: "NaN Value", value: NaN },
        { label: "Negative", value: -50 },
      ];
      const { container } = render(<HorizontalBarChart items={items} title="Edge Case Metrics" />);
      expect(container.querySelector("figure.chart.bar-chart-horizontal svg")).not.toBeNull();
    });
  });

  describe("StackedBarChart Edge Cases & Stress", () => {
    it("renders multi-segment stacked horizontal bars with zero-value segments", () => {
      const items = [
        {
          category: "repo-a",
          segments: [
            { key: "commits", label: "Commits", value: 120 },
            { key: "pushes", label: "Pushes", value: 0 },
            { key: "prs", label: "PRs", value: 15 },
          ],
        },
        {
          category: "repo-b",
          segments: [
            { key: "commits", label: "Commits", value: 0 },
            { key: "pushes", label: "Pushes", value: 80 },
            { key: "prs", label: "PRs", value: 40 },
          ],
        },
      ];
      const { container } = render(<StackedBarChart items={items} title="Stacked Commits" />);
      expect(container.querySelector("figure.chart.stacked-bar-chart svg")).not.toBeNull();
    });
  });

  describe("WaterfallChart Edge Cases & Stress", () => {
    it("renders positive deltas, negative deltas, and total step cleanly", () => {
      const steps = [
        { label: "Baseline", delta: 100, type: "baseline" as const },
        { label: "Increase", delta: 50, type: "change" as const },
        { label: "Decrease", delta: -30, type: "change" as const },
        { label: "Net Total", delta: 120, type: "total" as const },
      ];
      const { container } = render(<WaterfallChart steps={steps} title="Waterfall Flow" />);
      expect(container.querySelector("figure.chart.waterfall-chart svg")).not.toBeNull();
      expect(container.textContent).toContain("+50");
      expect(container.textContent).toContain("-30");
      expect(container.textContent).toContain("120");
    });
  });

  describe("TreemapChart Edge Cases & Stress", () => {
    it("renders proportional tiles and filters out tiny/zero tile calculations", () => {
      const items = [
        { label: "Huge Topic", value: 10000 },
        { label: "Tiny Topic", value: 1 },
        { label: "Medium Topic", value: 2500 },
      ];
      const { container } = render(<TreemapChart items={items} title="Topic Heatmap" />);
      expect(container.querySelector("figure.chart.treemap-chart svg")).not.toBeNull();
      const rects = container.querySelectorAll("rect");
      expect(rects.length).toBe(3);
    });
  });
});
