/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveContributionRow, RepoWindow, RepoWindowRow } from "@/lib/queries";
import { RepoRankings } from "./RepoRankings";

function attentionRow(overrides: Partial<RepoWindowRow> = {}): RepoWindowRow {
  return {
    repo_name: "acme/widgets",
    owner: "acme",
    description: "Widget factory",
    language: "TypeScript",
    topics: ["widgets"],
    github_stars: 500,
    events: 100,
    actors: 8,
    pushes: 40,
    commits: 60,
    stars: 10,
    forks: 3,
    prsOpened: 5,
    prsMerged: 2,
    spark: [1, 2, 3],
    ...overrides,
  };
}

function activeRow(overrides: Partial<ActiveContributionRow> = {}): ActiveContributionRow {
  return {
    repoName: "acme/widgets",
    commits: 70,
    distinctCommits: 55,
    pushes: 40,
    substantivePushBuckets: 22,
    pushers: 4,
    humanPushers: 3,
    botPushers: 1,
    prsOpened: 5,
    prsMerged: 2,
    activityScore: 500,
    branchScope: "unknown",
    dependencyUpdateAttribution: "unknown",
    ...overrides,
  };
}

function seedWindows(): Record<RepoWindow, RepoWindowRow[]> {
  const rows = [attentionRow(), attentionRow({ repo_name: "acme/gizmos", events: 50, forks: 9, stars: 1 })];
  return { "1d": rows, "7d": rows, "30d": rows, td: rows };
}

// Repo names appear both as the ranked row (a <button> whose aria-label
// starts with "<repo>.") and, for the current leader, inside the summary
// card - so row lookups match on the row's own accessible name instead of
// bare text to stay unambiguous.
function repoRowName(name: string) {
  return new RegExp(`^${name.replace(/[/.]/g, "\\$&")}\\.`);
}

function findRepoRow(name: string) {
  return screen.findByRole("button", { name: repoRowName(name) });
}

function queryRepoRow(name: string) {
  return screen.queryByRole("button", { name: repoRowName(name) });
}

describe("RepoRankings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/trending") {
        return {
          ok: true,
          json: async () => ({ data: [attentionRow({ repo_name: "fetched/repo" })], proof: {} }),
        } as Response;
      }
      if (url.pathname === "/api/trending-active") {
        return {
          ok: true,
          json: async () => ({ data: [activeRow()], proof: {} }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the seeded attention-mode rows without an extra network round trip", async () => {
    render(<RepoRankings windows={seedWindows()} />);
    expect(await findRepoRow("acme/widgets")).toBeInTheDocument();
    expect(queryRepoRow("acme/gizmos")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the ranking mode selector with attention active by default", async () => {
    const { container } = render(<RepoRankings windows={seedWindows()} />);
    const attentionButton = await screen.findByRole("button", { name: "Attention" });
    expect(attentionButton).toHaveAttribute("aria-pressed", "true");
    const caption = container.querySelector(".rankings-mode-caption");
    expect(caption).toHaveTextContent(/combined github \+ hn event volume/i);
  });

  it("switching to Stars mode fetches the stars-sorted server ranking", async () => {
    render(<RepoRankings windows={seedWindows()} />);
    await findRepoRow("acme/widgets");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stars" }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [calledUrl] = fetchMock.mock.calls[0];
    const params = new URL(String(calledUrl), "http://localhost").searchParams;
    expect(params.get("sort")).toBe("stars");
    expect(params.get("direction")).toBe("desc");

    await findRepoRow("fetched/repo");
    expect(screen.getByRole("button", { name: "Stars" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switching to an active-contribution mode hides pagination and shows anti-noise columns", async () => {
    render(<RepoRankings windows={seedWindows()} />);
    await findRepoRow("acme/widgets");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Active (commits)" }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [calledUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(calledUrl), "http://localhost");
    expect(url.pathname).toBe("/api/trending-active");
    expect(url.searchParams.get("sort")).toBe("commits");

    await findRepoRow("acme/widgets");
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.getByText(/not paginated/i)).toBeInTheDocument();
  });

  it("clicking a measure header toggles sort direction and re-queries the server", async () => {
    const { container } = render(<RepoRankings windows={seedWindows()} />);
    await findRepoRow("acme/widgets");

    function commitsChipHeader() {
      const head = container.querySelector(".rank-stats-head");
      return within(head as HTMLElement).getByRole("button", { name: /sort by commits/i });
    }

    await act(async () => {
      fireEvent.click(commitsChipHeader());
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    let params = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams;
    expect(params.get("sort")).toBe("commits");
    expect(params.get("direction")).toBe("desc");

    fetchMock.mockClear();
    await act(async () => {
      fireEvent.click(commitsChipHeader());
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    params = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams;
    expect(params.get("direction")).toBe("asc");
  });

  it("hides a column when unchecked in the Filters & Columns panel and persists the choice", async () => {
    render(<RepoRankings windows={seedWindows()} />);
    await findRepoRow("acme/widgets");

    expect(screen.getAllByText("commits").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /filters & columns/i }));
    const panel = await screen.findByRole("region", { name: /filters and columns/i });
    const commitsCheckbox = within(panel).getByLabelText("commits");
    fireEvent.click(commitsCheckbox);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem("attention-terminal:rankings-preferences:v1") ?? "{}");
      expect(stored.attentionColumns).not.toContain("commits");
    });
  });

  it("filters rows client-side by search text", async () => {
    render(<RepoRankings windows={seedWindows()} />);
    await findRepoRow("acme/widgets");
    expect(queryRepoRow("acme/gizmos")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /search repos/i }), {
      target: { value: "gizmos" },
    });

    await waitFor(() => expect(queryRepoRow("acme/widgets")).not.toBeInTheDocument());
    expect(queryRepoRow("acme/gizmos")).toBeInTheDocument();
  });
});
