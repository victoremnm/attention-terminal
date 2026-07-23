/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sparkline } from "./charts";

describe("Sparkline", () => {
  it("renders nothing when data has fewer than 2 points", () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders nothing when data is empty", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders an SVG with polyline for valid data", () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelector("polyline")).toBeInTheDocument();
    expect(svg?.querySelectorAll("circle").length).toBe(4);
  });

  it("uses aria-label when label prop is provided", () => {
    render(<Sparkline data={[1, 2, 3, 4, 5]} label="Repo-X activity trend, 5 days, 15 total events" />);
    expect(screen.getByRole("img", { name: /Repo-X activity trend/ })).toBeInTheDocument();
  });

  it("generates default aria-label when no label is provided", () => {
    const { container } = render(<Sparkline data={[3, 1, 2, 0, 4]} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-label");
    expect(svg?.getAttribute("aria-label")).toContain("trending");
  });

  it("detects upward trend direction", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("up");
  });

  it("detects downward trend direction", () => {
    const { container } = render(<Sparkline data={[5, 3, 1]} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("down");
  });

  it("detects stable trend direction", () => {
    const { container } = render(<Sparkline data={[4, 4, 4]} />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("stable");
  });

  it("applies custom dimensions", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} w={200} h={50} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "200");
    expect(svg).toHaveAttribute("height", "50");
  });
});
