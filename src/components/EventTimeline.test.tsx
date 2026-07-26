/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventTimeline } from "./EventTimeline";

const mockRows = [
  {
    event_id: "1",
    event_type: "PushEvent",
    action: "",
    repo_name: "user/repo",
    actor_login: "alice",
    actor_avatar: "",
    created_at: "2026-07-26T12:00:00Z",
    title: null,
    number: "0",
    payload_summary: "2 commits to main",
  },
  {
    event_id: "2",
    event_type: "WatchEvent",
    action: "started",
    repo_name: "user/repo",
    actor_login: "bob",
    actor_avatar: "",
    created_at: "2026-07-26T12:01:00Z",
    title: null,
    number: "0",
    payload_summary: "starred the repo",
  },
];

const mockDetail = {
  type: "event-drilldown",
  eventType: "PushEvent",
  action: "",
  repoName: "user/repo",
  actorLogin: "alice",
  actorAvatar: "",
  createdAt: "2026-07-26T12:00:00Z",
  structured: {
    type: "PushEvent",
    ref: "refs/heads/main",
    before: "abc",
    head: "def",
    size: 2,
    distinct_size: 2,
    commits: [{ sha: "def", message: "commit msg", url: "https://github.com/user/repo/commit/def" }],
    compare_url: "https://github.com/user/repo/compare/abc...def",
  },
  rawPayload: '{"ref":"refs/heads/main"}',
  rawPayloadTruncated: false,
  query: { sql: "SELECT ...", rowsRead: 1, elapsedMs: 5 },
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => mockDetail,
  } as Response);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventTimeline", () => {
  it("renders all rows", () => {
    render(<EventTimeline rows={mockRows} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("2 commits to main")).toBeInTheDocument();
    expect(screen.getByText("starred the repo")).toBeInTheDocument();
  });

  it("shows empty state when rows is empty", () => {
    render(<EventTimeline rows={[]} />);
    expect(screen.getByText(/No events ingested/)).toBeInTheDocument();
  });

  it("opens detail drawer on click and fetches event detail", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await screen.findByText("commit msg");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/event-detail?event_id=1&event_type=PushEvent&repo_name=user%2Frepo&created_at=2026-07-26T12%3A00%3A00Z",
      expect.any(Object)
    );
  });

  it("renders structured fields after fetch resolves", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    await screen.findByText("commit msg");
  });

  it("closes drawer on backdrop click", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const backdrop = document.querySelector(".event-detail-backdrop") as HTMLElement;
    await act(async () => {
      backdrop.click();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes drawer on Escape key", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    expect(await screen.findByText(/! Network error/)).toBeInTheDocument();
  });

  it("shows error state when fetch returns non-ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Event not found" }),
    } as Response);
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    expect(await screen.findByText(/! Event not found/)).toBeInTheDocument();
  });

  it("dispatches a new request when a different row is clicked", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    const secondRow = screen.getByLabelText("Inspect WatchEvent by bob");
    await act(async () => {
      firstRow.click();
    });
    await screen.findByText("commit msg");
    await act(async () => {
      secondRow.click();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/event-detail?event_id=2&event_type=WatchEvent&repo_name=user%2Frepo&created_at=2026-07-26T12%3A01%3A00Z",
      expect.any(Object)
    );
  });

  it("restores focus to the opener when drawer closes", async () => {
    render(<EventTimeline rows={mockRows} />);
    const firstRow = screen.getByLabelText("Inspect PushEvent by alice");
    await act(async () => {
      firstRow.click();
    });
    const closeBtn = screen.getByLabelText("Close event details");
    await act(async () => {
      closeBtn.click();
    });
    expect(firstRow).toHaveFocus();
  });

  describe("eventTypeFilter", () => {
    const filteredFeedResponse = {
      data: [
        {
          event_id: "3",
          event_type: "PushEvent",
          action: "",
          repo_name: "other/repo",
          actor_login: "charlie",
          actor_avatar: "",
          created_at: "2026-07-26T13:00:00Z",
          title: null,
          number: "0",
          payload_summary: "pushed to main",
        },
      ],
    };

    it("fetches from /api/events when filter is set", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => filteredFeedResponse,
      } as Response);

      render(<EventTimeline rows={mockRows} eventTypeFilter={["PushEvent"]} />);

      await act(async () => {});
      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining("/api/events?eventType=PushEvent"),
          expect.any(Object)
        );
      });
    });

    it("shows filtered rows from the API response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => filteredFeedResponse,
      } as Response);

      render(<EventTimeline rows={mockRows} eventTypeFilter={["PushEvent"]} />);

      expect(await screen.findByText("charlie")).toBeInTheDocument();
    });

    it("shows empty filter message when API returns no rows", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      render(<EventTimeline rows={mockRows} eventTypeFilter={["NonExistentEvent"]} />);

      expect(await screen.findByText(/No events match the selected filter/)).toBeInTheDocument();
    });

    it("calls onFilterLoading callback when fetching", async () => {
      const onFilterLoading = vi.fn();
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => filteredFeedResponse,
      } as Response);

      render(
        <EventTimeline
          rows={mockRows}
          eventTypeFilter={["PushEvent"]}
          onFilterLoading={onFilterLoading}
        />
      );

      await act(async () => {});
      expect(onFilterLoading).toHaveBeenCalled();
    });

    it("shows initial rows when filter fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network failure"));

      render(<EventTimeline rows={mockRows} eventTypeFilter={["PushEvent"]} />);

      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(screen.queryByText(/No events match/)).not.toBeInTheDocument();
    });
  });
});
