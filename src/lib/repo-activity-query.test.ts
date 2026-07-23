import { describe, expect, it } from "vitest";
import {
  normalizeRepoActivityOptions,
  parseRepoActivityRequest,
  REPO_ACTIVITY_DEFAULT_LIMIT,
} from "./repo-activity-query";

describe("repo activity query contract", () => {
  it("defaults to a bounded top-100 query with deterministic event ordering", () => {
    expect(normalizeRepoActivityOptions()).toEqual({
      limit: REPO_ACTIVITY_DEFAULT_LIMIT,
      offset: 0,
      sort: "events",
      direction: "desc",
      search: "",
    });
  });

  it("parses supported pagination, sorting, and search parameters", () => {
    expect(parseRepoActivityRequest(new URLSearchParams(
      "window=30d&limit=25&offset=50&sort=commits&direction=asc&search=vector"
    ))).toEqual({
      window: "30d",
      options: {
        limit: 25,
        offset: 50,
        sort: "commits",
        direction: "asc",
        search: "vector",
      },
    });
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["offset=-1", "offset"],
    ["sort=unknown", "sort"],
    ["direction=sideways", "direction"],
    ["window=90d", "window"],
  ])("rejects unsupported query input (%s)", (query, field) => {
    expect(() => parseRepoActivityRequest(new URLSearchParams(query))).toThrow(field);
  });

  it("rejects unbounded search input", () => {
    expect(() => normalizeRepoActivityOptions({ search: "x".repeat(101) })).toThrow("search");
  });
});
