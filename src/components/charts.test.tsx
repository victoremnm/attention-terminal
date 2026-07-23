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

  it("is aria-hidden when no label is provided", () => {
    const { container } = render(<Sparkline data={[3, 1, 2, 0, 4]} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("sets role=img with aria-label when label is provided", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} label="Upward trend" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Upward trend");
  });

  it("detects upward trend direction in label", () => {
    render(<Sparkline data={[1, 2, 3]} label="upward" />);
    expect(screen.getByRole("img", { name: /upward/ })).toBeInTheDocument();
  });

  it("detects downward trend direction in label", () => {
    render(<Sparkline data={[5, 3, 1]} label="downward" />);
    expect(screen.getByRole("img", { name: /downward/ })).toBeInTheDocument();
  });

  it("detects stable trend direction in label", () => {
    render(<Sparkline data={[4, 4, 4]} label="stable" />);
    expect(screen.getByRole("img", { name: /stable/ })).toBeInTheDocument();
  });

  it("applies custom dimensions", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} w={200} h={50} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "200");
    expect(svg).toHaveAttribute("height", "50");
  });
});
