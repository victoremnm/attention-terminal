import { describe, expect, it } from "vitest";
import { buildEventFeedQuery, eventFeedSourceTables, parseEventFeedRequest } from "./event-feed-query";

describe("event feed request validation", () => {
  it("normalizes the supported filters and repeated event types", () => {
    expect(parseEventFeedRequest(new URLSearchParams(
      "window=24h&eventType=PushEvent&eventType=IssuesEvent&repo=owner/repo&actor=octocat&ref=main&search=release"
    ))).toEqual({
      window: "24h",
      eventTypes: ["PushEvent", "IssuesEvent"],
      repo: "owner/repo",
      actor: "octocat",
      ref: "main",
      search: "release",
    });
  });

  it.each([
    ["window=2d", "window is not supported"],
    ["eventType=not-an-event", "eventType contains an invalid value"],
    ["repo=not-a-repo", "repo must be an owner/repo name"],
    ["search=%00", "search contains invalid control characters"],
  ])("rejects invalid parameters (%s)", (query, message) => {
    expect(() => parseEventFeedRequest(new URLSearchParams(query))).toThrow(message);
  });
});

describe("event feed SQL contract", () => {
  it("uses the time-ordered timeline for normal filters", () => {
    const sql = buildEventFeedQuery({
      window: "7d",
      eventTypes: ["PushEvent"],
      repo: "owner/repo",
      actor: "octocat",
      ref: "",
      search: "release",
    });

    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("LIMIT 100"));
    expect(sql).toContain("event_type IN {eventTypes: Array(String)}");
    expect(sql).toContain("repo_name = {repo: String}");
    expect(sql).toContain("actor_login = {actor: String}");
    expect(sql).toContain("FROM curated.event_timeline AS timeline");
    expect(sql).toContain("ORDER BY timeline.created_at DESC, timeline.event_id DESC");
    expect(sql).toContain("toString(timeline.event_id) AS event_id");
    expect(sql).not.toContain("SELECT *");
    expect(eventFeedSourceTables({ window: "7d", eventTypes: [], repo: "", actor: "", ref: "", search: "" }))
      .toEqual(["curated.event_timeline"]);
  });

  it("uses raw firehose only for actual ref matching", () => {
    const sql = buildEventFeedQuery({
      window: "7d",
      eventTypes: [],
      repo: "",
      actor: "",
      ref: "main",
      search: "",
    });

    expect(sql).toContain("FROM default.github_events_firehose AS raw");
    expect(sql).toContain("raw.created_at >= now() - INTERVAL 7 DAY");
    expect(sql).toContain("positionCaseInsensitiveUTF8(JSONExtractString(raw.payload, 'ref'), {ref: String}) > 0");
    expect(eventFeedSourceTables({ window: "7d", eventTypes: [], repo: "", actor: "", ref: "main", search: "" }))
      .toEqual(["default.github_events_firehose"]);
  });
});
