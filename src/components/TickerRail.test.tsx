/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TickerLanes } from "@/lib/queries";
import { TickerRail } from "./TickerRail";

vi.mock("./useIngestPulse", () => ({
  useIngestPulse: () => ({ lastIngestAt: undefined }),
}));

afterEach(() => cleanup());

function lanes(): TickerLanes {
  return {
    newRepos: [],
    topForked: [],
    shippingVelocity: [],
    starBreakouts: [],
    provenance: [],
    fetchedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("TickerRail", () => {
  it("renders the ticker lanes without actor leaderboard", () => {
    render(<TickerRail initial={lanes()} />);
    expect(screen.queryByText("PROLIFIC ACTORS · 24H")).not.toBeInTheDocument();
  });
});
