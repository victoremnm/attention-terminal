import { describe, expect, it } from "vitest";
import { mergeHNStoryStream, sanitizeExcerpt } from "./HNStoryStreamClient";
import type { HNStreamResult } from "@/lib/queries";

const stream = (stories: HNStreamResult["stories"]["data"], replies: HNStreamResult["replies"] = []): HNStreamResult => ({
  stories: { data: stories, sql: "", rowsRead: 0, elapsedMs: 0 },
  replies,
});

describe("HN story stream client helpers", () => {
  it("replaces the snapshot while keeping each story and reply unique", () => {
    const initial = stream([
      { id: "1", title: "old", score: "5", descendants: "1", by: "a", time: "1", url: "", velocity: "1" },
    ], [
      { story_id: "1", id: "10", by: "a", time: "1", text: "old", score: "1" },
    ]);
    const incoming = stream([
      { id: "1", title: "updated", score: "8", descendants: "2", by: "a", time: "1", url: "", velocity: "2" },
      { id: "2", title: "new", score: "6", descendants: "0", by: "b", time: "2", url: "", velocity: "3" },
    ], [
      { story_id: "1", id: "10", by: "a", time: "1", text: "updated", score: "2" },
      { story_id: "2", id: "20", by: "b", time: "2", text: "new", score: "1" },
    ]);

    const result = mergeHNStoryStream(initial, incoming);
    expect(result.stories.data.map((story) => story.id)).toEqual(["1", "2"]);
    expect(result.stories.data[0].title).toBe("updated");
    expect(result.replies).toHaveLength(2);
  });

  it("sanitizes HTML and bounds reply previews", () => {
    expect(sanitizeExcerpt("<b>Hello</b> &amp; goodbye")).toBe("Hello & goodbye");
    expect(sanitizeExcerpt("x".repeat(20), 10)).toBe("xxxxxxxxx…");
  });
});
