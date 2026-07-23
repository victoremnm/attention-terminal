import { describe, expect, it } from "vitest";
import { shouldForceRenderAnswer } from "./agent-render-enforcement";

describe("shouldForceRenderAnswer", () => {
  it("never forces a turn that hasn't fetched any data (idle chit-chat)", () => {
    expect(shouldForceRenderAnswer([], 5)).toBe(false);
    expect(shouldForceRenderAnswer(["listTables"], 1)).toBe(false); // listTables alone, too early
  });

  it("does not force before renderAnswer has had a fair chance (early steps)", () => {
    expect(shouldForceRenderAnswer(["runReadOnlyQuery"], 1)).toBe(false);
    expect(shouldForceRenderAnswer(["runReadOnlyQuery"], 2)).toBe(false);
  });

  it("forces renderAnswer once data was fetched and several steps have passed without it", () => {
    expect(
      shouldForceRenderAnswer(["listTables", "describeTable", "runReadOnlyQuery"], 3)
    ).toBe(true);
    expect(shouldForceRenderAnswer(["runDataRetrieval"], 4)).toBe(true);
  });

  it("never forces once renderAnswer has already been called", () => {
    expect(
      shouldForceRenderAnswer(["runReadOnlyQuery", "renderAnswer"], 5)
    ).toBe(false);
  });
});
