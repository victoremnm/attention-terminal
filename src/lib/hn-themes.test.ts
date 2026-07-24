import { describe, expect, it } from "vitest";
import { extractDiscussionThemes, stripHtml } from "./hn-themes";

describe("stripHtml", () => {
  it("removes HTML tags and decodes common entities", () => {
    const raw = "<p>Here is a link to <a href='https://example.com'>Example</a> website &amp; more.</p>";
    expect(stripHtml(raw)).toBe("Here is a link to Example website & more.");
  });

  it("strips pre and code blocks safely", () => {
    const raw = "Check this snippet: <pre>const x = 10;</pre> and continue.";
    expect(stripHtml(raw)).toBe("Check this snippet: and continue.");
  });
});

describe("extractDiscussionThemes", () => {
  it("returns empty array for sparse discussions with less than 3 comments", () => {
    const comments = [
      { id: 101, text: "Great performance benchmark." },
      { id: 102, text: "Interesting implementation details." },
    ];
    const themes = extractDiscussionThemes(comments, "ClickHouse Performance");
    expect(themes).toEqual([]);
  });

  it("extracts recurring technical phrases and attributes comment IDs", () => {
    const comments = [
      { id: 1, text: "The memory footprint of this database engine is surprisingly low in production." },
      { id: 2, text: "We tested memory footprint under heavy write load and observed great results." },
      { id: 3, text: "Memory footprint matters most when running on small cloud instances." },
      { id: 4, text: "Cold starts were minimal after optimization." },
    ];

    const themes = extractDiscussionThemes(comments, "Database Benchmarks");
    expect(themes.length).toBeGreaterThan(0);

    const memoryTheme = themes.find((t) => t.label.includes("memory footprint"));
    expect(memoryTheme).toBeDefined();
    expect(memoryTheme?.count).toBe(3);
    expect(memoryTheme?.representativeCommentIds).toEqual([1, 2, 3]);
  });

  it("suppresses story title tokens from dominating extracted themes", () => {
    const comments = [
      { id: 1, text: "ClickHouse performance is incredible for large scale analytics." },
      { id: 2, text: "We migrated our ClickHouse cluster last week for better performance." },
      { id: 3, text: "ClickHouse handles massive query throughput with ease." },
      { id: 4, text: "Cold starts remained low during the test." },
      { id: 5, text: "Cold starts take under 50ms now." },
    ];

    // Story title contains "ClickHouse"
    const themes = extractDiscussionThemes(comments, "ClickHouse Performance Benchmarks");
    const singleClickhouseTheme = themes.find((t) => t.label === "clickhouse");

    // Single title token "clickhouse" should be suppressed from single-word output
    expect(singleClickhouseTheme).toBeUndefined();
  });

  it("ignores deleted, dead, and short non-text comments", () => {
    const comments = [
      { id: 1, text: "[deleted]" },
      { id: 2, text: "thx" },
      { id: 3, text: "Real comment 1 about developer experience." },
      { id: 4, text: "Real comment 2 about developer experience." },
    ];

    const themes = extractDiscussionThemes(comments);
    expect(themes).toEqual([]); // only 2 valid comments >= 10 chars
  });
});
