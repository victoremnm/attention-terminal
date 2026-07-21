// GitHub Activity REST client (issue #79 track #80).
//
// Fetches recent commits, PRs, releases, and issues for a repo via Octokit —
// the content the GH Archive firehose structurally lacks (commit messages, PR
// titles, release tags/bodies, issue titles). Mirrors the `github-repo.ts`
// conventions (auth from GITHUB_TOKEN, rate-limit backoff, `fast` mode for
// request-time callers) but uses Octokit for pagination and typed responses.
// No git clone — pure REST, matching the changelog-generator example pattern.
//
// Row shapes match the ClickHouse tables in
// migrations/20260722000001_gh_repo_activity_rest.sql.

import { Octokit } from "octokit";
import { chDateTime, type FetchOptions } from "./github-repo";

const FAST_MODE_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_ITEMS = 100;
const RELEASE_BODY_MAX_CHARS = 500;

let octokitSingleton: Octokit | undefined;

function octokit(): Octokit {
  if (octokitSingleton) return octokitSingleton;
  octokitSingleton = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    request: { fetch },
  });
  return octokitSingleton;
}

function splitRepo(repoName: string): { owner: string; repo: string } {
  const [owner, repo] = repoName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo name: ${repoName}`);
  return { owner, repo };
}

function abortSignal(options?: FetchOptions): AbortSignal | undefined {
  return options?.fast ? AbortSignal.timeout(FAST_MODE_TIMEOUT_MS) : undefined;
}

// Octokit's built-in throttling handles 403/429 with automatic retry; for
// `fast` mode we cap the per-request timeout and let callers fail fast.
// For non-fast mode we rely on Octokit's throttle plugin behavior, which
// sleeps on rate-limit responses up to its configured maxRetries.

export interface CommitRow {
  repo_name: string;
  sha: string;
  author: string;
  author_date: string; // ClickHouse DateTime string
  message: string; // first line only
  inserted_at: string;
}

export interface PRRow {
  repo_name: string;
  number: number;
  title: string;
  state: string; // 'open' | 'closed'
  author: string;
  created_at: string;
  merged_at: string; // '1970-01-01 00:00:00' if null
  closed_at: string; // '1970-01-01 00:00:00' if null
  labels: string[];
  inserted_at: string;
}

export interface ReleaseRow {
  repo_name: string;
  tag: string;
  name: string;
  author: string;
  published_at: string;
  body: string; // truncated to RELEASE_BODY_MAX_CHARS
  inserted_at: string;
}

export interface IssueRow {
  repo_name: string;
  number: number;
  title: string;
  state: string; // 'open' | 'closed'
  author: string;
  created_at: string;
  closed_at: string; // '1970-01-01 00:00:00' if null
  labels: string[];
  comments: number;
  inserted_at: string;
}

function firstLine(message: string | undefined): string {
  if (!message) return "";
  const idx = message.indexOf("\n");
  return idx === -1 ? message : message.slice(0, idx);
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export async function listRecentCommits(
  repoName: string,
  since: Date,
  options: FetchOptions & { maxItems?: number } = {},
): Promise<CommitRow[]> {
  const { owner, repo } = splitRepo(repoName);
  const max = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const sinceIso = since.toISOString();
  const signal = abortSignal(options);
  const insertedAt = chDateTime(new Date().toISOString());
  const rows: CommitRow[] = [];
  let page = 1;
  try {
    while (rows.length < max) {
      const { data } = await octokit().rest.repos.listCommits({
        owner,
        repo,
        since: sinceIso,
        per_page: 100,
        page,
        request: signal ? { signal } : undefined,
      });
      if (data.length === 0) break;
      for (const c of data) {
        rows.push({
          repo_name: repoName,
          sha: c.sha,
          author: c.commit.author?.name ?? c.author?.login ?? "",
          author_date: chDateTime(c.commit.author?.date),
          message: firstLine(c.commit.message),
          inserted_at: insertedAt,
        });
        if (rows.length >= max) break;
      }
      if (data.length < 100) break;
      page++;
    }
  } catch (err) {
    if (options?.fast) return rows; // request-time: return what we have
    throw err;
  }
  return rows;
}

export async function listRecentPRs(
  repoName: string,
  since: Date,
  options: FetchOptions & { maxItems?: number } = {},
): Promise<PRRow[]> {
  const { owner, repo } = splitRepo(repoName);
  const max = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const sinceMs = since.getTime();
  const signal = abortSignal(options);
  const insertedAt = chDateTime(new Date().toISOString());
  const rows: PRRow[] = [];
  let page = 1;
  try {
    while (rows.length < max) {
      const { data } = await octokit().rest.pulls.list({
        owner,
        repo,
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
        request: signal ? { signal } : undefined,
      });
      if (data.length === 0) break;
      for (const p of data) {
        // Pull requests are sorted by updated_at desc; stop when we cross the
        // `since` threshold to avoid scanning the full PR history.
        const updatedMs = p.updated_at ? new Date(p.updated_at).getTime() : 0;
        if (updatedMs && updatedMs < sinceMs) {
          return rows;
        }
        rows.push({
          repo_name: repoName,
          number: p.number,
          title: p.title ?? "",
          state: p.state ?? "open",
          author: p.user?.login ?? "",
          created_at: chDateTime(p.created_at),
          merged_at: p.merged_at ? chDateTime(p.merged_at) : "1970-01-01 00:00:00",
          closed_at: p.closed_at ? chDateTime(p.closed_at) : "1970-01-01 00:00:00",
          labels: (p.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
          inserted_at: insertedAt,
        });
        if (rows.length >= max) break;
      }
      if (data.length < 100) break;
      page++;
    }
  } catch (err) {
    if (options?.fast) return rows;
    throw err;
  }
  return rows;
}

export async function listRecentReleases(
  repoName: string,
  options: FetchOptions & { maxItems?: number } = {},
): Promise<ReleaseRow[]> {
  const { owner, repo } = splitRepo(repoName);
  const max = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const signal = abortSignal(options);
  const insertedAt = chDateTime(new Date().toISOString());
  const rows: ReleaseRow[] = [];
  let page = 1;
  try {
    while (rows.length < max) {
      const { data } = await octokit().rest.repos.listReleases({
        owner,
        repo,
        per_page: 100,
        page,
        request: signal ? { signal } : undefined,
      });
      if (data.length === 0) break;
      for (const r of data) {
        if (r.draft) continue; // skip drafts
        rows.push({
          repo_name: repoName,
          tag: r.tag_name ?? "",
          name: r.name ?? r.tag_name ?? "",
          author: r.author?.login ?? "",
          published_at: chDateTime(r.published_at ?? undefined),
          body: truncate(r.body, RELEASE_BODY_MAX_CHARS),
          inserted_at: insertedAt,
        });
        if (rows.length >= max) break;
      }
      if (data.length < 100) break;
      page++;
    }
  } catch (err) {
    if (options?.fast) return rows;
    throw err;
  }
  return rows;
}

export async function listRecentIssues(
  repoName: string,
  since: Date,
  options: FetchOptions & { maxItems?: number } = {},
): Promise<IssueRow[]> {
  const { owner, repo } = splitRepo(repoName);
  const max = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const signal = abortSignal(options);
  const insertedAt = chDateTime(new Date().toISOString());
  const rows: IssueRow[] = [];
  let page = 1;
  try {
    while (rows.length < max) {
      // GitHub's issues endpoint includes PRs; filter them out by `pull_request`.
      const { data } = await octokit().rest.issues.listForRepo({
        owner,
        repo,
        state: "all",
        since: since.toISOString(),
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
        request: signal ? { signal } : undefined,
      });
      if (data.length === 0) break;
      for (const i of data) {
        if (i.pull_request) continue; // PRs are tracked separately
        rows.push({
          repo_name: repoName,
          number: i.number,
          title: i.title ?? "",
          state: i.state ?? "open",
          author: i.user?.login ?? "",
          created_at: chDateTime(i.created_at),
          closed_at: i.closed_at ? chDateTime(i.closed_at) : "1970-01-01 00:00:00",
          labels: (i.labels ?? []).map((l) => (typeof l === "object" ? l.name ?? "" : l)).filter(Boolean),
          comments: Math.max(0, Math.trunc(i.comments ?? 0)),
          inserted_at: insertedAt,
        });
        if (rows.length >= max) break;
      }
      if (data.length < 100) break;
      page++;
    }
  } catch (err) {
    if (options?.fast) return rows;
    throw err;
  }
  return rows;
}

// Fetch all four activity kinds for a repo in parallel. Used by the poller
// (issue #82) so each repo costs ~4 concurrent REST calls, not 4 sequential.
export interface RepoActivity {
  commits: CommitRow[];
  prs: PRRow[];
  releases: ReleaseRow[];
  issues: IssueRow[];
}

export async function fetchRepoActivity(
  repoName: string,
  since: Date,
  options: FetchOptions & { maxItems?: number } = {},
): Promise<RepoActivity> {
  const [commits, prs, releases, issues] = await Promise.all([
    listRecentCommits(repoName, since, options),
    listRecentPRs(repoName, since, options),
    listRecentReleases(repoName, options),
    listRecentIssues(repoName, since, options),
  ]);
  return { commits, prs, releases, issues };
}