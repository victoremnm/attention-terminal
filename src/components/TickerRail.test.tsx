/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TickerLanes } from "@/lib/queries";
import type { RepoDrilldownPayload } from "@/lib/render-payload";
import { TickerRail } from "./TickerRail";

vi.mock("./useIngestPulse", () => ({
  useIngestPulse: () => ({ lastIngestAt: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lanes(): TickerLanes {
  return {
    newRepos: [{ kicker: "NEW REPOS", name: "acme/widget", metric: "42 pushes", repoName: "acme/widget" }],
    topForked: [],
    shippingVelocity: [],
    starBreakouts: [],
    provenance: [],
    fetchedAt: "2026-07-23T00:00:00.000Z",
  };
}

function drilldown(): RepoDrilldownPayload {
  return {
    type: "repo-drilldown",
    repoName: "acme/widget",
    generatedAt: "2026-07-23T00:00:00.000Z",
    metadata: { description: "A widget repo", language: "TypeScript", topics: [], githubStars: 12, githubForks: 3, openIssues: 1 },
    kpis24h: { pushes: 2, commits: 2, distinctCommits: 2, forks: 0, stars: 1, issuesOpened: 0, prsOpened: 0, prsMerged: 0, actors: 1 },
    velocity: [],
    topActors24h: [],
    feed: [],
    query: { sql: "SELECT 1", rowsRead: 1, elapsedMs: 1 },
  };
}

describe("TickerRail", () => {
  it("renders the ticker lanes without actor leaderboard", () => {
    render(<TickerRail initial={lanes()} />);
    expect(screen.queryByText("PROLIFIC ACTORS · 24H")).not.toBeInTheDocument();
  });

  it("opens repo details in an accessible window without rendering below the feed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => drilldown() }));
    render(<TickerRail initial={lanes()} />);

    act(() => screen.getByRole("button", { name: /open live clickhouse details for acme\/widget/i }).click());

    expect(screen.getByRole("dialog", { name: "REPO DETAILS" })).toBeInTheDocument();
    expect(screen.getByText("loading acme/widget details...")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "acme/widget" })).toBeInTheDocument());
    expect(screen.getByText("NEW REPOS")).toBeInTheDocument();
    expect(screen.queryByText("rendered below")).not.toBeInTheDocument();
  });

  it("does not dismiss on outside click and closes only through explicit controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => drilldown() }));
    render(<TickerRail initial={lanes()} />);
    act(() => screen.getByRole("button", { name: /open live clickhouse details for acme\/widget/i }).click());
    await waitFor(() => expect(screen.getByRole("heading", { name: "acme/widget" })).toBeInTheDocument());

    act(() => fireEvent.click(document.querySelector(".ticker-drilldown-backdrop")!));
    expect(screen.getByRole("dialog", { name: "REPO DETAILS" })).toBeInTheDocument();
    expect(screen.getByText("NEW REPOS")).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: "Close repository details" }).click());
    expect(screen.queryByRole("dialog", { name: "REPO DETAILS" })).not.toBeInTheDocument();
    expect(screen.getByText("NEW REPOS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open live clickhouse details for acme\/widget/i })).toHaveFocus();
  });

  it("supports Escape without clearing the loaded details state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => drilldown() }));
    render(<TickerRail initial={lanes()} />);
    act(() => screen.getByRole("button", { name: /open live clickhouse details for acme\/widget/i }).click());
    await waitFor(() => expect(screen.getByRole("heading", { name: "acme/widget" })).toBeInTheDocument());

    act(() => fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "REPO DETAILS" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open live clickhouse details for acme\/widget/i })).toHaveFocus();
  });
});
