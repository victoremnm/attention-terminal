/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelDistributionSummary } from "@/lib/telemetry-queries";
import { ModelDistributionChart } from "./ModelDistributionChart";

function makeSummary({ model, latencies }: { model: string; latencies: number[] }): ModelDistributionSummary {
  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  return {
    model,
    count,
    minLatencyMs: sorted[0],
    q1LatencyMs: sorted[Math.floor(count * 0.25)],
    medianLatencyMs: sorted[Math.floor(count * 0.5)],
    q3LatencyMs: sorted[Math.floor(count * 0.75)],
    maxLatencyMs: sorted[count - 1],
    latencies: sorted,
    avgInputTokens: 100,
    avgOutputTokens: 200,
    totalCostUsd: 1,
    avgCostUsd: 0.01,
    successRate: 100,
  };
}

describe("ModelDistributionChart", () => {
  afterEach(() => cleanup());

  it("renders nothing for empty stats", () => {
    const { container } = render(<ModelDistributionChart stats={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("plots a single outlier as a diamond marker rather than stretching the axis", () => {
    // A tight cluster around 1000ms plus one extreme 60s outlier.
    const latencies = [980, 990, 1000, 1000, 1010, 1020, 1030, 60000];
    const stats = [makeSummary({ model: "claude", latencies })];

    const { container, getAllByText } = render(<ModelDistributionChart stats={stats} />);

    const outlierMarker = container.querySelector('path[stroke-width="1.5"][fill="none"]');
    expect(outlierMarker).toBeTruthy();
    expect(outlierMarker?.querySelector("title")?.textContent).toContain("outlier");

    // The axis domain is driven by the fenced core range (~1s), not the 60s
    // outlier -- if the outlier were allowed to set the domain, the largest
    // tick label would read in the tens of seconds instead of ~1s.
    const tickLabels = getAllByText(/^\d/).map((el) => el.textContent);
    expect(tickLabels.some((label) => /^(60|59|58)\.\ds$/.test(label ?? ""))).toBe(false);
  });

  it("does not flag any points as outliers for a tight, evenly-spread distribution", () => {
    const latencies = [900, 950, 1000, 1000, 1050, 1100, 1150];
    const stats = [makeSummary({ model: "gpt", latencies })];

    const { container } = render(<ModelDistributionChart stats={stats} />);

    const outlierMarkers = container.querySelectorAll('path[stroke-width="1.5"][fill="none"]');
    expect(outlierMarkers.length).toBe(0);
  });

  it("switches to a log-scaled axis when models differ by more than 10x", () => {
    const fast = makeSummary({ model: "gemini", latencies: [90, 95, 100, 100, 105, 110, 115] });
    const slow = makeSummary({ model: "glm", latencies: [9000, 9500, 10000, 10000, 10500, 11000, 11500] });

    const { getByText } = render(<ModelDistributionChart stats={[fast, slow]} />);
    expect(getByText(/log-scaled/i)).toBeInTheDocument();
  });

  it("stays on a linear axis when models are within a similar range", () => {
    const a = makeSummary({ model: "gemini", latencies: [900, 950, 1000, 1000, 1050, 1100, 1150] });
    const b = makeSummary({ model: "glm", latencies: [1200, 1250, 1300, 1300, 1350, 1400, 1450] });

    const { queryByText } = render(<ModelDistributionChart stats={[a, b]} />);
    expect(queryByText(/log-scaled/i)).not.toBeInTheDocument();
  });
});
