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
    risingStories: [],
    actors: {
      humans: [
        {
          actor_login: "alice",
          events: 12,
          repos: 3,
          pushes: 8,
          prs_opened: 2,
          prs_merged: 1,
          score: 42.5,
        },
      ],
      bots: [
        {
          actor_login: "dependabot[bot]",
          events: 9,
          repos: 7,
          pushes: 3,
          prs_opened: 6,
          prs_merged: 0,
          score: 9,
        },
      ],
      provenance: [],
    },
    provenance: [],
    fetchedAt: "2026-07-23T00:00:00.000Z",
  };
}

describe("TickerRail", () => {
  it("renders the actor leaderboard as a ticker-rail card with tables", () => {
    render(<TickerRail initial={lanes()} />);

    expect(screen.getByText("PROLIFIC ACTORS · 24H")).toBeInTheDocument();
    expect(screen.getByText("Prolific actors over the last 24h")).toBeInTheDocument();
    expect(screen.getAllByText("Rank")).toHaveLength(1);
    expect(screen.getByText("Group")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("dependabot[bot]")).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });
});
