import { beforeEach, describe, expect, it, vi } from "vitest";

const { eventFeed } = vi.hoisted(() => ({ eventFeed: vi.fn() }));

vi.mock("@/lib/event-feed-query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/event-feed-query")>("@/lib/event-feed-query");
  return { ...actual, eventFeed };
});

import { GET } from "../../app/api/events/route";

function request(query: string) {
  return { nextUrl: { searchParams: new URLSearchParams(query) } } as never;
}

describe("GET /api/events", () => {
  beforeEach(() => eventFeed.mockReset());

  it("rejects invalid filters before querying", async () => {
    const response = await GET(request("eventType=not-an-event"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "eventType contains an invalid value" });
    expect(eventFeed).not.toHaveBeenCalled();
  });

  it("returns rows, freshness, filters, and query provenance", async () => {
    eventFeed.mockResolvedValue({
      data: [{ event_id: "42", event_key: "github:42" }],
      sql: "SELECT ... LIMIT 100",
      rowsRead: 321,
      elapsedMs: 12,
    });

    const response = await GET(request("window=24h&eventType=PushEvent&repo=owner/repo"));
    expect(response.status).toBe(200);
    expect(eventFeed).toHaveBeenCalledWith({
      window: "24h",
      eventTypes: ["PushEvent"],
      repo: "owner/repo",
      actor: "",
      ref: "",
      search: "",
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: [{ event_id: "42", event_key: "github:42" }],
      filters: { window: "24h", eventTypes: ["PushEvent"], repo: "owner/repo" },
      provenance: {
        sql: "SELECT ... LIMIT 100",
        sourceTables: ["default.github_events_firehose"],
        rowsRead: 321,
        elapsedMs: 12,
      },
    });
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("returns an explicit empty data set when no rows match", async () => {
    eventFeed.mockResolvedValue({ data: [], sql: "SELECT ... LIMIT 100", rowsRead: 0, elapsedMs: 4 });
    const response = await GET(request("window=1h&search=does-not-exist"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });

});
