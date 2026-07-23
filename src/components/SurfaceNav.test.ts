import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SurfaceNav } from "./SurfaceNav";

describe("SurfaceNav component", () => {
  it("accepts home as a valid active surface prop", () => {
    const element = createElement(SurfaceNav, { active: "home" });
    expect(element.props.active).toBe("home");
  });

  it("accepts trending as a valid active surface prop for Repo Rankings", () => {
    const element = createElement(SurfaceNav, { active: "trending" });
    expect(element.props.active).toBe("trending");
  });
});
