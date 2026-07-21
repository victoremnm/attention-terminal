import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";

const GITHUB_API = "https://api.github.com";
const FETCH_CONCURRENCY = 5;
const MAX_REPOS_PER_RUN = 300;
const STALE_DAYS = 7;

// Per-bucket caps: new-today repos are the freshest signal, top-by-stars keeps
// the trending set enriched, stale re-fetches keep existing rows honest.
const NEW_TODAY_LIMIT = 150;
const TOP_STARS_LIMIT = 150;
const STALE_LIMIT = 150;

interface GitHubRepo {
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

interface GitHubTopics {
  names?: string[];
}

function chDateTime(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "1970-01-01 00:00:00";
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function authHeaders(): HeadersInit {
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
async function respectRateLimit(res: Response) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 || res.status === 429 || remaining === "0") {
    const retryAfter = res.headers.get("retry-after");
    const resetAt = res.headers.get("x-ratelimit-reset");
    let waitMs = 30_000;
    if (retryAfter) waitMs = Number(retryAfter) * 1000;
    else if (resetAt) waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 1000;
    waitMs = Math.min(waitMs, 60_000);
    logger.log("GitHub rate limit hit, backing off", { waitMs, status: res.status });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return true;
  }
  return false;
}

async function fetchRepo(repoName: string): Promise<GitHubRepo | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${GITHUB_API}/repos/${repoName}`, { headers: authHeaders() });
    if (res.status === 404 || res.status === 451) return null; // deleted, renamed, or DMCA-taken-down
    if (await respectRateLimit(res)) continue;
    if (!res.ok) {
      logger.log("GitHub repo fetch failed", { repoName, status: res.status });
      return null;
    }
    return (await res.json()) as GitHubRepo;
  }
  return null;
}

async function fetchTopics(repoName: string): Promise<string[]> {
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

function toRow(repoName: string, repo: GitHubRepo, topics: string[], fetchedAt: Date) {
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

async function pickRepos(): Promise<string[]> {
  const [newToday, topByStars, stale] = await Promise.all([
    // New-today: repos that had a repository-creation event today per GH Archive.
    selectRows<{ repo_name: string }>(
      `SELECT DISTINCT repo_name
       FROM github_events
       WHERE event_type = 'CreateEvent' AND ref_type = 'repository'
         AND created_at >= today() AND repo_name != ''
       LIMIT ${NEW_TODAY_LIMIT}`
    ),
    // Top-by-stars: highest star-event volume over the trailing 30 days.
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(stars) AS total_stars
       FROM gh_repo_daily
       WHERE day >= today() - 30 AND repo_name != ''
       GROUP BY repo_name
       ORDER BY total_stars DESC
       LIMIT ${TOP_STARS_LIMIT}`
    ),
    // Stale: repos whose LATEST metadata version is over a week old. Group by
    // repo_name and test max(fetched_at) so a just-refreshed repo's older
    // ReplacingMergeTree versions (visible pre-merge) don't re-qualify it as stale.
    selectRows<{ repo_name: string }>(
      `SELECT repo_name
       FROM gh_repo_metadata
       GROUP BY repo_name
       HAVING max(fetched_at) < now() - INTERVAL ${STALE_DAYS} DAY
       ORDER BY max(fetched_at) ASC
       LIMIT ${STALE_LIMIT}`
    ),
  ]);

  const valid = (name?: string) => !!name && name.includes("/");

  // Reserve capacity for the stale bucket so a full new-today + top-by-stars set
  // can't fill MAX_REPOS_PER_RUN and starve stale refreshes entirely.
  const staleReserve = Math.min(STALE_LIMIT, Math.floor(MAX_REPOS_PER_RUN / 3));
  const freshBudget = MAX_REPOS_PER_RUN - staleReserve;

  const fresh = [...newToday, ...topByStars].map((r) => r.repo_name).filter(valid);
  const staleNames = stale.map((r) => r.repo_name).filter(valid);

  const picked = new Set<string>();
  // 1. Fresh up to the reserved fresh budget.
  for (const name of fresh) {
    if (picked.size >= freshBudget) break;
    picked.add(name);
  }
  // 2. Stale up to the overall cap.
  for (const name of staleNames) {
    if (picked.size >= MAX_REPOS_PER_RUN) break;
    picked.add(name);
  }
  // 3. Backfill any capacity the stale bucket didn't use with the remaining fresh
  //    candidates, so a small stale set never leaves GitHub/Trigger capacity idle.
  for (const name of fresh) {
    if (picked.size >= MAX_REPOS_PER_RUN) break;
    picked.add(name);
  }
  return Array.from(picked);
}

export const refreshRepoMetadata = schedules.task({
  id: "refresh-repo-metadata",
  cron: "50 * * * *",
  maxDuration: 600,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    const repoNames = await pickRepos();
    if (repoNames.length === 0) {
      metadata.set("ingest", { source: "gh-repo-metadata", inserted: 0, candidates: 0 });
      logger.log("No repos need enrichment this run");
      return { inserted: 0, candidates: 0 };
    }

    const fetchedAt = new Date();
    const rows: ReturnType<typeof toRow>[] = [];
    let notFound = 0;

    for (let i = 0; i < repoNames.length; i += FETCH_CONCURRENCY) {
      const batch = repoNames.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (repoName) => {
          const repo = await fetchRepo(repoName);
          if (!repo) return null;
          const topics = await fetchTopics(repoName);
          return toRow(repoName, repo, topics, fetchedAt);
        })
      );
      for (const row of results) {
        if (row) rows.push(row);
        else notFound += 1;
      }
      metadata.set("ingest", {
        source: "gh-repo-metadata",
        processed: Math.min(i + FETCH_CONCURRENCY, repoNames.length),
        candidates: repoNames.length,
        inserted: rows.length,
      });
    }

    if (rows.length > 0) {
      // Bulk insert via the batching insert client (async_insert settings) -
      // plain HTTP query bulk loads die at the load balancer (CLAUDE.md gotcha #2).
      await clickhouseInsert.insert({ table: "gh_repo_metadata", values: rows, format: "JSONEachRow" });
    }

    logger.log("Refreshed GitHub repo metadata", {
      candidates: repoNames.length,
      inserted: rows.length,
      notFound,
    });
    return { inserted: rows.length, candidates: repoNames.length, notFound };
  },
});
