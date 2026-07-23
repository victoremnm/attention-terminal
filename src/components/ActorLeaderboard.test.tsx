/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { ActorLeaderboardSurface } from "./ActorLeaderboard";

describe("ActorLeaderboardSurface", () => {
  afterEach(() => cleanup());

  it("renders separate human and bot leaderboards", () => {
    render(
      <ActorLeaderboardSurface
        humans={[
          {
            actor_login: "alice",
            events: 12,
            repos: 4,
            pushes: 6,
            prs_opened: 2,
            prs_merged: 1,
            score: 37.5,
          },
        ]}
        bots={[
          {
            actor_login: "robot[bot]",
            events: 40,
            repos: 11,
            pushes: 40,
            prs_opened: 0,
            prs_merged: 0,
            score: 40,
          },
        ]}
      />
    );

    expect(screen.getByText(/prolific actors over the last 24h/i)).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("robot[bot]")).toBeInTheDocument();
    expect(screen.getByText("37.5")).toBeInTheDocument();
    expect(screen.getByText("40.0")).toBeInTheDocument();
  });
});
