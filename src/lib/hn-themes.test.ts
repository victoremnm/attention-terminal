import { describe, expect, it } from "vitest";
import { extractDiscussionThemes, HN_THEME_EXTRACTION_LIMITS, stripHtml } from "./hn-themes";

describe("stripHtml", () => {
  it("removes HTML tags and decodes common entities", () => {
    const raw = "<p>Here is a link to <a href='https://example.com'>Example</a> website &amp; more.</p>";
    expect(stripHtml(raw)).toBe("Here is a link to Example website & more.");
  });

  it("strips pre and code blocks safely", () => {
    const raw = "Check this snippet: <pre>const x = 10;</pre> and continue.";
    expect(stripHtml(raw)).toBe("Check this snippet: and continue.");
  });

  it("removes quoted blocks and encoded URL text before theme extraction", () => {
    const raw = "<blockquote>&gt; quoted reply</blockquote><p>Actual comment with https:&#x2F;&#x2F;github.com&#x2F;org&#x2F;repo</p>";
    expect(stripHtml(raw)).toBe("Actual comment with");
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

  it("orders themes by boosted phrase score", () => {
    const comments = [
      { id: 1, text: "Database enables reliable analytics today." },
      { id: 2, text: "Database supports reliable deployments now." },
      { id: 3, text: "Database powers reliable systems everywhere." },
      { id: 4, text: "The query planner improves performance for complex workloads." },
      { id: 5, text: "A query planner helps optimize distributed systems." },
    ];

    const themes = extractDiscussionThemes(comments);

    expect(themes[0]?.label).toBe("query planner");
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

  it("deduplicates reinserted comment rows before calculating coverage", () => {
    const comments = [
      { id: 1, text: "The query planner is fast." },
      { id: 1, text: "The query planner is still fast after an update." },
      { id: 2, text: "We rely on the query planner for production workloads." },
      { id: 3, text: "The query planner handles our workload well." },
    ];

    const theme = extractDiscussionThemes(comments).find((item) => item.label === "query planner");
    expect(theme?.count).toBe(3);
    expect(theme?.coverage).toBe(1);
    expect(theme?.representativeCommentIds).toEqual([1, 2, 3]);
  });

  it("suppresses configured taxonomy tokens as standalone themes", () => {
    const comments = [
      { id: 1, text: "Agents make the workflow easier to automate." },
      { id: 2, text: "Agents are useful when the workflow is reproducible." },
      { id: 3, text: "Agents help teams keep the workflow observable." },
    ];

    const themes = extractDiscussionThemes(comments, undefined, 5, ["agents", "workflow"]);
    expect(themes.find((theme) => theme.label === "agents")).toBeUndefined();
    expect(themes.find((theme) => theme.label === "workflow")).toBeUndefined();
  });

  it("keeps extraction bounded even when callers provide a large sample", () => {
    const comments = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      text: `${"repeated phrase ".repeat(200)} ${index}`,
    }));

    const themes = extractDiscussionThemes(comments, undefined, 100);
    expect(themes.length).toBeLessThanOrEqual(HN_THEME_EXTRACTION_LIMITS.maxThemes);
    expect(themes.every((theme) => theme.label.split(" ").length <= HN_THEME_EXTRACTION_LIMITS.maxPhraseWords)).toBe(true);
  });

  it("keeps the full valid-comment denominator when the byte sample is truncated", () => {
    const comments = [
      { id: 1, text: "The query planner is fast." },
      { id: 2, text: "We rely on the query planner every day." },
      { id: 3, text: "The query planner handles our workload." },
      { id: 4, text: "x".repeat(HN_THEME_EXTRACTION_LIMITS.maxInputBytes) },
    ];

    const theme = extractDiscussionThemes(comments).find((item) => item.label === "query planner");
    expect(theme?.count).toBe(3);
    expect(theme?.coverage).toBe(0.75);
  });

  it("does not emit URL fragments or generic filler as themes", () => {
    const comments = [
      { id: 1, text: "The implementation uses https:&#x2F;&#x2F;github.com&#x2F;acme and improves request latency." },
      { id: 2, text: "This implementation uses https:&#x2F;&#x2F;github.com&#x2F;acme to reduce request latency." },
      { id: 3, text: "Our implementation uses https:&#x2F;&#x2F;github.com&#x2F;acme for predictable request latency." },
    ];

    const themes = extractDiscussionThemes(comments);
    expect(themes.some((theme) => /x2f|github|com|uses/.test(theme.label))).toBe(false);
    expect(themes.every((theme) => !theme.label.split(" ").some((word) => ["uses", "from", "the"].includes(word)))).toBe(true);
    expect(themes.some((theme) => theme.label === "request latency")).toBe(true);
  });
});
