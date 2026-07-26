import { describe, expect, it } from "vitest";
import { boundedNumber } from "../../app/api/stories/route";

describe("stories API query bounds", () => {
  it("keeps configured defaults when parameters are absent or blank", () => {
    expect(boundedNumber(null, 6, 1, 24)).toBe(6);
    expect(boundedNumber("", 50, 1, 100)).toBe(50);
    expect(boundedNumber("  ", 50, 1, 100)).toBe(50);
  });
});
