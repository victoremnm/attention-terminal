import { describe, expect, it } from "vitest";
import { buildEventFeedQuery, parseEventFeedRequest } from "./event-feed-query";

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
  it("filters before the hard top-100 limit and orders deterministically", () => {
    const sql = buildEventFeedQuery({
      window: "7d",
      eventTypes: ["PushEvent"],
      repo: "owner/repo",
      actor: "octocat",
      ref: "main",
      search: "release",
    });

    expect(sql.indexOf("WHERE")).toBeLessThan(sql.indexOf("LIMIT 100"));
    expect(sql).toContain("event_type IN {eventTypes: Array(String)}");
    expect(sql).toContain("repo_name = {repo: String}");
    expect(sql).toContain("actor_login = {actor: String}");
    expect(sql).toContain("JSONExtractString(payload, 'ref')");
    expect(sql).toContain("ORDER BY created_at DESC, event_id DESC");
    expect(sql).toContain("toString(event_id) AS event_id");
    expect(sql).not.toContain("SELECT *");
  });
});
