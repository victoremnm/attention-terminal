import { describe, expect, it } from "vitest";
import { parseEventPayload } from "./event-payload-parser";

describe("parseEventPayload", () => {
  it("returns structured PushEvent fields", () => {
    const raw = JSON.stringify({
      ref: "refs/heads/main",
      before: "abc123def456abc123def456abc123def456abc1",
      head: "def789abc012def789abc012def789abc012def7",
      size: 2,
      distinct_size: 2,
      commits: [
        { sha: "def789abc012def789abc012def789abc012def7", message: "fix: resolve NPE", url: "https://api.github.com/repos/user/repo/commits/def789abc012def789abc012def789abc012def7" },
      ],
      repository: { full_name: "user/repo" },
    });
    const result = parseEventPayload("PushEvent", "", raw);
    expect(result.structured).toHaveProperty("type", "PushEvent");
    expect(result.structured).toHaveProperty("ref", "refs/heads/main");
    expect(result.structured).toHaveProperty("compare_url", "https://github.com/user/repo/compare/abc123def456abc123def456abc123def456abc1...def789abc012def789abc012def789abc012def7");
    expect(result.truncated).toBe(false);
    expect(result.rawPayload).toBe(raw);
  });

  it("uses the timeline repository when the GH Archive payload omits repository metadata", () => {
    const raw = JSON.stringify({ ref: "refs/heads/main", before: "abc", head: "def", commits: [] });
    const result = parseEventPayload("PushEvent", "", raw, "owner/repo");
    expect(result.structured).toHaveProperty("compare_url", "https://github.com/owner/repo/compare/abc...def");
  });

  it("returns structured PullRequestEvent fields", () => {
    const raw = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 42,
        title: "feat: add event drilldown",
        html_url: "https://github.com/user/repo/pull/42",
        merged: false,
        draft: false,
        head: { ref: "feat/event-detail", sha: "abc123" },
        base: { ref: "main", sha: "def456" },
      },
    });
    const result = parseEventPayload("PullRequestEvent", "opened", raw);
    expect(result.structured).toHaveProperty("type", "PullRequestEvent");
    expect(result.structured).toHaveProperty("number", 42);
    expect(result.structured).toHaveProperty("title", "feat: add event drilldown");
    expect(result.structured).toHaveProperty("merged", false);
    expect(result.structured).toHaveProperty("draft", false);
  });

  it("returns structured IssuesEvent fields", () => {
    const raw = JSON.stringify({
      action: "opened",
      issue: {
        number: 101,
        title: "bug: blank screen on login",
        html_url: "https://github.com/user/repo/issues/101",
        state: "open",
        labels: [{ name: "bug" }, { name: "frontend" }],
      },
    });
    const result = parseEventPayload("IssuesEvent", "opened", raw);
    expect(result.structured).toHaveProperty("type", "IssuesEvent");
    expect(result.structured).toHaveProperty("number", 101);
    expect((result.structured as unknown as Record<string, unknown>).labels).toEqual(["bug", "frontend"]);
  });

  it("returns structured ReleaseEvent fields", () => {
    const raw = JSON.stringify({
      action: "published",
      release: {
        tag_name: "v1.0.0",
        name: "Initial release",
        html_url: "https://github.com/user/repo/releases/tag/v1.0.0",
        prerelease: false,
        draft: false,
        body: "First stable release",
      },
    });
    const result = parseEventPayload("ReleaseEvent", "published", raw);
    expect(result.structured).toHaveProperty("type", "ReleaseEvent");
    expect(result.structured).toHaveProperty("tag_name", "v1.0.0");
    expect(result.structured).toHaveProperty("draft", false);
    expect(result.structured).toHaveProperty("prerelease", false);
  });

  it("returns structured ForkEvent fields", () => {
    const raw = JSON.stringify({
      forkee: { full_name: "forker/repo", html_url: "https://github.com/forker/repo" },
    });
    const result = parseEventPayload("ForkEvent", "", raw);
    expect(result.structured).toHaveProperty("type", "ForkEvent");
    expect(result.structured).toHaveProperty("forkee_full_name", "forker/repo");
  });

  it("returns MinimalEventFields for WatchEvent", () => {
    const result = parseEventPayload("WatchEvent", "started", "{}");
    expect(result.structured).toHaveProperty("type", "WatchEvent");
  });

  it("returns null structured for unknown event type", () => {
    const result = parseEventPayload("UnknownEvent", "", "{}");
    expect(result.structured).toBeNull();
  });

  it("returns null structured for unparseable JSON", () => {
    const result = parseEventPayload("PushEvent", "", "{invalid");
    expect(result.structured).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("truncates raw payload over 64KB", () => {
    const big = "x".repeat(70000);
    const raw = JSON.stringify({ data: big });
    const result = parseEventPayload("PushEvent", "", raw);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.rawPayload).byteLength).toBeLessThanOrEqual(65536);
  });

  it("truncates raw payload by UTF-8 bytes without splitting a multibyte character", () => {
    const raw = JSON.stringify({ data: "🙂".repeat(30000) });
    const result = parseEventPayload("PushEvent", "", raw);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.rawPayload).byteLength).toBeLessThanOrEqual(65536);
    expect(result.rawPayload.endsWith("...")).toBe(true);
    expect(() => JSON.stringify(result.rawPayload)).not.toThrow();
  });

  it("handles missing nested objects gracefully (PushEvent without repository)", () => {
    const raw = JSON.stringify({ ref: "refs/heads/main", before: "a", head: "b", commits: [] });
    const result = parseEventPayload("PushEvent", "", raw);
    expect(result.structured).toHaveProperty("type", "PushEvent");
    expect(result.structured).toHaveProperty("compare_url");
  });

  it("extracts labels from issue comment event", () => {
    const raw = JSON.stringify({
      action: "created",
      issue: { number: 55, html_url: "https://github.com/user/repo/issues/55" },
      comment: { body: "nice catch!", html_url: "https://github.com/user/repo/issues/55#issuecomment-1" },
    });
    const result = parseEventPayload("IssueCommentEvent", "created", raw);
    expect(result.structured).toHaveProperty("type", "IssueCommentEvent");
    expect(result.structured).toHaveProperty("issue_number", 55);
  });

  it("parses PullRequestReviewEvent", () => {
    const raw = JSON.stringify({
      action: "submitted",
      pull_request: { number: 9 },
      review: { state: "approved", body: "LGTM", html_url: "https://github.com/user/repo/pull/9#pullrequestreview-1" },
    });
    const result = parseEventPayload("PullRequestReviewEvent", "submitted", raw);
    expect(result.structured).toHaveProperty("type", "PullRequestReviewEvent");
    expect(result.structured).toHaveProperty("review_state", "approved");
    expect(result.structured).toHaveProperty("pr_number", 9);
  });

  it("parses PullRequestReviewCommentEvent", () => {
    const raw = JSON.stringify({
      action: "created",
      pull_request: { number: 9 },
      comment: { body: "inline comment", path: "src/lib/foo.ts", html_url: "https://github.com/user/repo/pull/9#discussion_r1" },
    });
    const result = parseEventPayload("PullRequestReviewCommentEvent", "created", raw);
    expect(result.structured).toHaveProperty("type", "PullRequestReviewCommentEvent");
    expect(result.structured).toHaveProperty("path", "src/lib/foo.ts");
    expect(result.structured).toHaveProperty("pr_number", 9);
  });

  it("parses CreateEvent and DeleteEvent", () => {
    const raw = JSON.stringify({ ref: "feat/new", ref_type: "branch", master_branch: "main" });
    const created = parseEventPayload("CreateEvent", "", raw);
    expect(created.structured).toHaveProperty("type", "CreateEvent");
    expect(created.structured).toHaveProperty("ref_type", "branch");

    const deleted = parseEventPayload("DeleteEvent", "", raw);
    expect(deleted.structured).toHaveProperty("type", "DeleteEvent");
    expect(deleted.structured).toHaveProperty("ref", "feat/new");
  });

  it("parses DiscussionEvent", () => {
    const raw = JSON.stringify({
      action: "created",
      discussion: { number: 3, title: "RFC: event drilldown", html_url: "https://github.com/user/repo/discussions/3" },
    });
    const result = parseEventPayload("DiscussionEvent", "created", raw);
    expect(result.structured).toHaveProperty("type", "DiscussionEvent");
    expect(result.structured).toHaveProperty("number", 3);
  });

  it("parses MemberEvent", () => {
    const raw = JSON.stringify({
      action: "added",
      member: { login: "newuser" },
    });
    const result = parseEventPayload("MemberEvent", "added", raw);
    expect(result.structured).toHaveProperty("type", "MemberEvent");
    expect(result.structured).toHaveProperty("member_login", "newuser");
  });

  it("parses CommitCommentEvent", () => {
    const raw = JSON.stringify({
      action: "created",
      comment: { body: "review note", commit_id: "abc123", path: "src/main.rs", html_url: "https://github.com/user/repo/commit/abc123#commitcomment-1" },
    });
    const result = parseEventPayload("CommitCommentEvent", "created", raw);
    expect(result.structured).toHaveProperty("type", "CommitCommentEvent");
    expect(result.structured).toHaveProperty("commit_id", "abc123");
  });

  it("limits commits to 20", () => {
    const commits = Array.from({ length: 30 }, (_, i) => ({ sha: `sha${i}`, message: `msg${i}`, url: `https://api.github.com/repos/user/repo/commits/sha${i}` }));
    const raw = JSON.stringify({ ref: "refs/heads/main", before: "a", head: "b", size: 30, distinct_size: 30, commits, repository: { full_name: "user/repo" } });
    const result = parseEventPayload("PushEvent", "", raw);
    const s = result.structured as unknown as Record<string, unknown>;
    expect((s as Record<string, unknown[]>).commits).toHaveLength(20);
  });
});
