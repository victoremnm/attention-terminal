// Shared GitHub REST fetch + row-mapping logic for `gh_repo_metadata` (issue #56).
// Used by both `src/trigger/refresh-repo-metadata.ts` (the scheduled bulk refresh) and
// `src/lib/queries.ts` (`repoDrilldown`'s on-demand single-repo enrichment) so the two
// call sites never drift. Deliberately has no `@trigger.dev/sdk` import - it needs to stay
// safe to import from a Next.js server context, so logging here is plain console.* rather
// than the Trigger.dev `logger`.

const GITHUB_API = "https://api.github.com";

export interface GitHubRepo {
  name?: string;
  full_name?: string;
  owner?: { login?: string; type?: string };
  description?: string | null;
  language?: string | null;
  homepage?: string | null;
  license?: { spdx_id?: string | null } | null;
  created_at?: string;
  pushed_at?: string;
  archived?: boolean;
  fork?: boolean;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  message?: string; // present on error responses (e.g. "Not Found")
}

export interface GitHubTopics {
  names?: string[];
}

// Mirrors the `gh_repo_metadata` table shape (migrations/20260720000009_gh_repo_metadata.sql).
export interface GhRepoMetadataRow {
  repo_name: string;
  owner: string;
  owner_type: string;
  description: string;
  language: string;
  topics: string[];
  homepage: string;
  license: string;
  created_at: string;
  pushed_at: string;
  archived: number;
  fork: number;
  github_stars: number;
  github_forks: number;
  open_issues: number;
  fetched_at: string;
}

export function chDateTime(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "1970-01-01 00:00:00";
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function authHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

// Sleeps until the rate-limit window resets when GitHub reports we're out of
// requests (secondary or primary rate limit), rather than hammering the API.
export async function respectRateLimit(res: Response) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 || res.status === 429 || remaining === "0") {
    const retryAfter = res.headers.get("retry-after");
    const resetAt = res.headers.get("x-ratelimit-reset");
    let waitMs = 30_000;
    if (retryAfter) waitMs = Number(retryAfter) * 1000;
    else if (resetAt) waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 1000;
    waitMs = Math.min(waitMs, 60_000);
    console.log("[github-repo] GitHub rate limit hit, backing off", { waitMs, status: res.status });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return true;
  }
  return false;
}

export async function fetchRepo(repoName: string): Promise<GitHubRepo | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GITHUB_API}/repos/${repoName}`, { headers: authHeaders() });
    if (res.status === 404 || res.status === 451) return null; // deleted, renamed, or DMCA-taken-down
    if (await respectRateLimit(res)) continue;
    if (!res.ok) {
      console.log("[github-repo] GitHub repo fetch failed", { repoName, status: res.status });
      return null;
    }
    return (await res.json()) as GitHubRepo;
  }
  return null;
}

export async function fetchTopics(repoName: string): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GITHUB_API}/repos/${repoName}/topics`, { headers: authHeaders() });
    if (res.status === 404 || res.status === 451) return [];
    if (await respectRateLimit(res)) continue;
    if (!res.ok) return [];
    const body = (await res.json()) as GitHubTopics;
    return body.names ?? [];
  }
  return [];
}

export function toRow(
  repoName: string,
  repo: GitHubRepo,
  topics: string[],
  fetchedAt: Date
): GhRepoMetadataRow {
  return {
    repo_name: repoName,
    owner: repo.owner?.login ?? repoName.split("/")[0] ?? "",
    owner_type: repo.owner?.type ?? "",
    description: repo.description ?? "",
    language: repo.language ?? "",
    topics: topics.slice(0, 40),
    homepage: repo.homepage ?? "",
    license: repo.license?.spdx_id ?? "",
    created_at: chDateTime(repo.created_at),
    pushed_at: chDateTime(repo.pushed_at),
    archived: repo.archived ? 1 : 0,
    fork: repo.fork ? 1 : 0,
    github_stars: Math.max(0, Math.trunc(repo.stargazers_count ?? 0)),
    github_forks: Math.max(0, Math.trunc(repo.forks_count ?? 0)),
    open_issues: Math.max(0, Math.trunc(repo.open_issues_count ?? 0)),
    fetched_at: chDateTime(fetchedAt.toISOString()),
  };
}

// Convenience wrapper for single-repo, end-to-end enrichment (used by the
// drilldown's on-demand path). Batch callers (the scheduled refresh task) use
// `fetchRepo`/`fetchTopics`/`toRow` directly so they can pipeline concurrency
// across many repos.
export async function fetchRepoRow(
  repoName: string,
  fetchedAt: Date = new Date()
): Promise<GhRepoMetadataRow | null> {
  const repo = await fetchRepo(repoName);
  if (!repo) return null;
  const topics = await fetchTopics(repoName);
  return toRow(repoName, repo, topics, fetchedAt);
}
