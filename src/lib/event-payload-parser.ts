const MAX_RAW_BYTES = 65536;
const MAX_COMMITS = 20;
const MAX_MESSAGE_CHARS = 200;

export interface PushEventFields {
  type: "PushEvent";
  ref: string;
  before: string;
  head: string;
  size: number;
  distinct_size: number;
  commits: Array<{ sha: string; message: string; url: string }>;
  compare_url: string;
}

export interface PullRequestEventFields {
  type: "PullRequestEvent";
  number: number;
  title: string;
  html_url: string;
  head_ref: string;
  head_sha: string;
  base_ref: string;
  base_sha: string;
  merged: boolean;
  draft: boolean;
}

export interface IssuesEventFields {
  type: "IssuesEvent";
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: string[];
}

export interface ReleaseEventFields {
  type: "ReleaseEvent";
  tag_name: string;
  name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  body: string;
}

export interface ForkEventFields {
  type: "ForkEvent";
  forkee_full_name: string;
  forkee_html_url: string;
}

export interface WatchEventFields {
  type: "WatchEvent";
}

export interface CreateEventFields {
  type: "CreateEvent";
  ref: string;
  ref_type: string;
  master_branch: string;
}

export interface DeleteEventFields {
  type: "DeleteEvent";
  ref: string;
  ref_type: string;
}

export interface PullRequestReviewEventFields {
  type: "PullRequestReviewEvent";
  review_state: string;
  review_body: string;
  pr_number: number;
  html_url: string;
}

export interface PullRequestReviewCommentEventFields {
  type: "PullRequestReviewCommentEvent";
  comment_body: string;
  pr_number: number;
  path: string;
  html_url: string;
}

export interface IssueCommentEventFields {
  type: "IssueCommentEvent";
  comment_body: string;
  issue_number: number;
  html_url: string;
}

export interface MemberEventFields {
  type: "MemberEvent";
  member_login: string;
  action: string;
}

export interface CommitCommentEventFields {
  type: "CommitCommentEvent";
  comment_body: string;
  commit_id: string;
  path: string;
  html_url: string;
}

export interface DiscussionEventFields {
  type: "DiscussionEvent";
  number: number;
  title: string;
  html_url: string;
}

export interface MinimalEventFields {
  type: "WatchEvent" | "PublicEvent" | "GollumEvent";
}

export type EventStructuredFields =
  | PushEventFields
  | PullRequestEventFields
  | IssuesEventFields
  | ReleaseEventFields
  | ForkEventFields
  | WatchEventFields
  | CreateEventFields
  | DeleteEventFields
  | PullRequestReviewEventFields
  | PullRequestReviewCommentEventFields
  | IssueCommentEventFields
  | MemberEventFields
  | CommitCommentEventFields
  | DiscussionEventFields
  | MinimalEventFields;

export function parseEventPayload(
  eventType: string,
  action: string,
  payloadRaw: string
): { structured: EventStructuredFields | null; rawPayload: string; truncated: boolean } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return { structured: null, rawPayload: payloadRaw.slice(0, MAX_RAW_BYTES), truncated: payloadRaw.length > MAX_RAW_BYTES };
  }

  let structured: EventStructuredFields | null = null;
  switch (eventType) {
    case "PushEvent":
      structured = parsePushEvent(parsed);
      break;
    case "PullRequestEvent":
      structured = parsePullRequestEvent(parsed);
      break;
    case "IssuesEvent":
      structured = parseIssuesEvent(parsed);
      break;
    case "ReleaseEvent":
      structured = parseReleaseEvent(parsed);
      break;
    case "ForkEvent":
      structured = parseForkEvent(parsed);
      break;
    case "WatchEvent":
      structured = { type: "WatchEvent" } as MinimalEventFields;
      break;
    case "PublicEvent":
      structured = { type: "PublicEvent" } as MinimalEventFields;
      break;
    case "GollumEvent":
      structured = { type: "GollumEvent" } as MinimalEventFields;
      break;
    case "CreateEvent":
      structured = parseCreateEvent(parsed);
      break;
    case "DeleteEvent":
      structured = parseDeleteEvent(parsed);
      break;
    case "PullRequestReviewEvent":
      structured = parsePullRequestReviewEvent(parsed);
      break;
    case "PullRequestReviewCommentEvent":
      structured = parsePullRequestReviewCommentEvent(parsed);
      break;
    case "IssueCommentEvent":
      structured = parseIssueCommentEvent(parsed);
      break;
    case "MemberEvent":
      structured = parseMemberEvent(parsed);
      break;
    case "CommitCommentEvent":
      structured = parseCommitCommentEvent(parsed);
      break;
    case "DiscussionEvent":
      structured = parseDiscussionEvent(parsed);
      break;
  }

  const payloadStr = JSON.stringify(parsed);
  return {
    structured,
    rawPayload: payloadStr.length > MAX_RAW_BYTES ? payloadStr.slice(0, MAX_RAW_BYTES) + "..." : payloadStr,
    truncated: payloadStr.length > MAX_RAW_BYTES,
  };
}

function safeStr(val: unknown): string {
  if (typeof val === "string") return val;
  if (val === null || val === undefined) return "";
  return String(val);
}

function safeInt(val: unknown): number {
  if (typeof val === "number") return Math.floor(val);
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
  return 0;
}

function safeBool(val: unknown): boolean {
  return val === true || val === "true";
}

function safeObj(val: unknown): Record<string, unknown> {
  if (val && typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  return {};
}

function buildGitHubUrl(repoName: string, path: string): string {
  return `https://github.com/${repoName}/${path}`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function parsePushEvent(payload: Record<string, unknown>): PushEventFields {
  const ref = safeStr(payload.ref);
  const commits = Array.isArray(payload.commits)
    ? (payload.commits as Record<string, unknown>[]).slice(0, MAX_COMMITS).map((c) => ({
        sha: safeStr(c.sha),
        message: truncate(safeStr(c.message), MAX_MESSAGE_CHARS),
        url: buildGitHubUrl(safeStr(c.url ?? "").replace("api.github.com/repos", "github.com").replace("/commits/", "/commit/")),
      }))
    : [];
  const repoName = safeStr(safeObj(payload.repository).full_name) || safeStr(safeObj(payload.repo).name);
  return {
    type: "PushEvent",
    ref,
    before: safeStr(payload.before),
    head: safeStr(payload.head),
    size: safeInt(payload.size),
    distinct_size: safeInt(payload.distinct_size),
    commits,
    compare_url: `https://github.com/${repoName}/compare/${safeStr(payload.before)}...${safeStr(payload.head)}`,
  };
}

function getPullRequest(payload: Record<string, unknown>): Record<string, unknown> {
  return safeObj(payload.pull_request);
}

function parsePullRequestEvent(payload: Record<string, unknown>): PullRequestEventFields {
  const pr = getPullRequest(payload);
  const head = safeObj(pr.head);
  const base = safeObj(pr.base);
  return {
    type: "PullRequestEvent",
    number: safeInt(payload.number || pr.number),
    title: safeStr(pr.title),
    html_url: safeStr(pr.html_url),
    head_ref: safeStr(head.ref),
    head_sha: safeStr(head.sha),
    base_ref: safeStr(base.ref),
    base_sha: safeStr(base.sha),
    merged: safeBool(pr.merged),
    draft: safeBool(pr.draft),
  };
}

function parseIssuesEvent(payload: Record<string, unknown>): IssuesEventFields {
  const issue = safeObj(payload.issue);
  return {
    type: "IssuesEvent",
    number: safeInt(issue.number || payload.number),
    title: safeStr(issue.title),
    html_url: safeStr(issue.html_url),
    state: safeStr(issue.state),
    labels: Array.isArray(issue.labels) ? (issue.labels as Record<string, unknown>[]).map((l) => safeStr(l.name)) : [],
  };
}

function parseReleaseEvent(payload: Record<string, unknown>): ReleaseEventFields {
  const release = safeObj(payload.release);
  return {
    type: "ReleaseEvent",
    tag_name: safeStr(release.tag_name),
    name: safeStr(release.name),
    html_url: safeStr(release.html_url),
    prerelease: safeBool(release.prerelease),
    draft: safeBool(release.draft),
    body: truncate(safeStr(release.body), 500),
  };
}

function parseForkEvent(payload: Record<string, unknown>): ForkEventFields {
  const forkee = safeObj(payload.forkee);
  return {
    type: "ForkEvent",
    forkee_full_name: safeStr(forkee.full_name),
    forkee_html_url: safeStr(forkee.html_url),
  };
}

function parseCreateEvent(payload: Record<string, unknown>): CreateEventFields {
  return {
    type: "CreateEvent",
    ref: safeStr(payload.ref),
    ref_type: safeStr(payload.ref_type),
    master_branch: safeStr(payload.master_branch),
  };
}

function parseDeleteEvent(payload: Record<string, unknown>): DeleteEventFields {
  return {
    type: "DeleteEvent",
    ref: safeStr(payload.ref),
    ref_type: safeStr(payload.ref_type),
  };
}

function parsePullRequestReviewEvent(payload: Record<string, unknown>): PullRequestReviewEventFields {
  const review = safeObj(payload.review);
  const pr = getPullRequest(payload);
  return {
    type: "PullRequestReviewEvent",
    review_state: safeStr(review.state),
    review_body: truncate(safeStr(review.body), 500),
    pr_number: safeInt(pr.number),
    html_url: safeStr(review.html_url),
  };
}

function parsePullRequestReviewCommentEvent(payload: Record<string, unknown>): PullRequestReviewCommentEventFields {
  const comment = safeObj(payload.comment);
  const pr = getPullRequest(payload);
  return {
    type: "PullRequestReviewCommentEvent",
    comment_body: truncate(safeStr(comment.body), 500),
    pr_number: safeInt(pr.number),
    path: safeStr(comment.path),
    html_url: safeStr(comment.html_url),
  };
}

function parseIssueCommentEvent(payload: Record<string, unknown>): IssueCommentEventFields {
  const comment = safeObj(payload.comment);
  const issue = safeObj(payload.issue);
  return {
    type: "IssueCommentEvent",
    comment_body: truncate(safeStr(comment.body || payload.body), 500),
    issue_number: safeInt(issue.number || safeObj(safeObj(comment.issue).pull_request).number),
    html_url: safeStr(comment.html_url),
  };
}

function parseMemberEvent(payload: Record<string, unknown>): MemberEventFields {
  const member = safeObj(payload.member);
  return {
    type: "MemberEvent",
    member_login: safeStr(member.login),
    action: safeStr(payload.action),
  };
}

function parseCommitCommentEvent(payload: Record<string, unknown>): CommitCommentEventFields {
  const comment = safeObj(payload.comment);
  return {
    type: "CommitCommentEvent",
    comment_body: truncate(safeStr(comment.body), 500),
    commit_id: safeStr(comment.commit_id),
    path: safeStr(comment.path),
    html_url: safeStr(comment.html_url),
  };
}

function parseDiscussionEvent(payload: Record<string, unknown>): DiscussionEventFields {
  const discussion = safeObj(payload.discussion);
  return {
    type: "DiscussionEvent",
    number: safeInt(discussion.number),
    title: safeStr(discussion.title),
    html_url: safeStr(discussion.html_url),
  };
}
