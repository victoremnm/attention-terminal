import { describe, expect, it } from "vitest";
import {
  ACTIVE_CONTRIBUTION_DEFAULT_LIMIT,
  parseActiveContributionRequest,
} from "./active-contribution-query";

describe("active contribution query contract", () => {
  it("defaults to a 1d window, commits sort, and the default limit", () => {
    expect(parseActiveContributionRequest(new URLSearchParams(""))).toEqual({
      window: "1d",
      sort: "commits",
      limit: ACTIVE_CONTRIBUTION_DEFAULT_LIMIT,
    });
  });

  it("parses supported window, sort, and limit parameters", () => {
    expect(parseActiveContributionRequest(new URLSearchParams("window=30d&sort=pushes&limit=25"))).toEqual({
      window: "30d",
      sort: "pushes",
      limit: 25,
    });
  });

  it.each([
    ["window=90d", "window"],
    ["sort=events", "sort"],
    ["sort=raw_sql", "sort"],
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=-1", "limit"],
    ["limit=abc", "limit"],
  ])("rejects unsupported query input (%s)", (query, field) => {
    expect(() => parseActiveContributionRequest(new URLSearchParams(query))).toThrow(field);
  });
});
