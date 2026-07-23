/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import {
  BoxplotChart,
  BubbleChart,
  ChoroplethMap,
  DataTable,
  DotPlot,
  FlowChart,
  GanttChart,
  SankeyDiagram,
  Scatterplot,
  Slopegraph,
  SpiderChart,
  UnitChart,
  WaffleChart,
  BulletGraph,
} from "./charts";

describe("new chart primitives", () => {
  it("renders a spider chart", () => {
    const { container } = render(
      <SpiderChart
        axes={["speed", "quality", "uptime"]}
        series={[{ label: "team-a", values: [4, 3, 5] }]}
        title="Spider"
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("polygon").length).toBeGreaterThan(0);
  });

  it("renders a slopegraph", () => {
    const { container } = render(
      <Slopegraph
        items={[{ label: "repo-a", start: 10, end: 25 }]}
        startLabel="start"
        endLabel="end"
        title="Slope"
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("line").length).toBeGreaterThan(0);
  });

  it("renders a gantt chart", () => {
    const { container } = render(
      <GanttChart
        items={[
          { label: "plan", start: "2026-07-01", end: "2026-07-05" },
          { label: "ship", start: "2026-07-06", end: "2026-07-10" },
        ]}
        title="Gantt"
      />
    );
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("renders a dot plot", () => {
    const { container } = render(<DotPlot items={[{ label: "alpha", value: 10 }]} title="Dot" />);
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("renders a bullet graph", () => {
    const { container } = render(
      <BulletGraph items={[{ label: "goal", value: 72, target: 90 }]} title="Bullet" />
    );
    expect(container.querySelectorAll("line").length).toBeGreaterThan(0);
  });

  it("renders a waffle chart", () => {
    const { container } = render(<WaffleChart value={37} total={100} label="Usage" title="Waffle" />);
    expect(container.querySelectorAll("rect").length).toBe(100);
    expect(container.textContent).toContain("37%");
  });

  it("renders a unit chart", () => {
    const { container } = render(<UnitChart items={[{ label: "units", value: 7 }]} title="Unit" />);
    expect(container.querySelectorAll("rect").length).toBe(7);
  });

  it("renders a boxplot", () => {
    const { container } = render(
      <BoxplotChart
        items={[{ label: "dist", min: 1, q1: 2, median: 3, q3: 4, max: 5 }]}
        title="Boxplot"
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("renders a scatterplot", () => {
    const { container } = render(
      <Scatterplot points={[{ x: 1, y: 2, label: "pt" }]} xLabel="x" yLabel="y" title="Scatter" />
    );
    expect(container.querySelectorAll("circle").length).toBe(1);
    expect(screen.getByText("pt")).toBeInTheDocument();
  });

  it("renders a bubble chart", () => {
    const { container } = render(
      <BubbleChart points={[{ x: 2, y: 3, size: 9, label: "bubble" }]} xLabel="x" yLabel="y" title="Bubble" />
    );
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("renders a sankey diagram", () => {
    const { container } = render(
      <SankeyDiagram
        links={[
          { source: "A", target: "B", value: 10 },
          { source: "A", target: "C", value: 5 },
        ]}
        title="Sankey"
      />
    );
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("renders a flow chart", () => {
    const { container } = render(
      <FlowChart
        nodes={[
          { id: "start", label: "Start", kind: "start" },
          { id: "check", label: "Check", kind: "decision" },
          { id: "end", label: "End", kind: "output" },
        ]}
        edges={[
          { from: "start", to: "check", label: "next" },
          { from: "check", to: "end", label: "yes" },
        ]}
        title="Flow"
      />
    );
    expect(container.querySelectorAll("polygon, rect").length).toBeGreaterThan(0);
    expect(screen.getByText("next")).toBeInTheDocument();
  });

  it("renders a choropleth map", () => {
    const { container } = render(
      <ChoroplethMap
        regions={[
          { id: "r1", label: "North", value: 10, path: "M 10 10 h 20 v 20 h -20 Z" },
          { id: "r2", label: "South", value: 20, path: "M 40 10 h 20 v 20 h -20 Z" },
        ]}
        title="Map"
      />
    );
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  it("renders a data table with hyperlinks", () => {
    render(
      <DataTable
        title="Data"
        rows={[{ name: "repo-a", url: "https://example.com", stars: 10 }]}
        columns={[
          { key: "name", label: "Name", type: "string" },
          { key: "url", label: "URL", type: "link" },
          { key: "stars", label: "Stars", type: "number" },
        ]}
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com" })).toBeInTheDocument();
  });
});
