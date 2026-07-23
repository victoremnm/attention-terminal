import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";
import { fetchRepoActivity } from "../lib/github-activity";

// Watchlist poller (issue #79 track #82).
//
// Fetches recent commits/PRs/releases/issues for watched repos via the Octokit
// client (issue #80) and persists to the REST-activity tables (issue #81).
// The firehose is push-dominated and carries no commit messages, PR titles,
// release tags/bodies, or issue titles (CLAUDE.md gotcha #4) — this poller
// fills that gap for the drilldown's activity + trends queries (issue #83).
//
// Pattern follows `refresh-repo-metadata.ts`: budget-bounded candidate picker,
// concurrency-limited fetch, deadline buffer so an in-flight batch can finish
// and the final ClickHouse insert can still run before Trigger.dev's hard
// maxDuration kill.

const FETCH_CONCURRENCY = 4; // 4 repos in parallel × 4 endpoints = 16 concurrent REST calls
const MAX_REPOS_PER_RUN = 50; // 50 repos × 4 endpoints = 200 REST calls (~4% of 5000/hr)
const MAX_DURATION_SECONDS = 900;
const RUN_DEADLINE_BUFFER_MS = 150_000;
const ACTIVITY_WINDOW_DAYS = 7; // REST fetch window (matches the drilldown's activity list window)

// Auto-seed buckets: top-50 across 4 categories over 30 days, deduped.
const SEED_BUCKET_LIMIT = 50;
const SEED_WINDOW_DAYS = 30;

interface WatchlistRow {
  repo_name: string;
  added_at: string;
  added_by: string;
  source: string;
  priority: number;
  inserted_at: string;
}

async function watchlistCount(): Promise<number> {
  const rows = await selectRows<{ c: number | string }>(
    `SELECT count() AS c FROM watchlist`
  );
  return Number(rows[0]?.c ?? 0);
}

// First-run auto-seed: 4 buckets (top-50 by stars/forks/pushes/commits over
// 30 days), deduped, inserted into `watchlist` with source='auto-seed'.
async function autoSeedWatchlist(): Promise<number> {
  const sinceClause = `day >= today() - ${SEED_WINDOW_DAYS}`;
  const [stars, forks, pushes, commits] = await Promise.all([
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(stars) AS s FROM gh_repo_daily WHERE ${sinceClause} AND repo_name != '' GROUP BY repo_name ORDER BY s DESC LIMIT ${SEED_BUCKET_LIMIT}`
    ),
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(forks) AS s FROM gh_repo_daily WHERE ${sinceClause} AND repo_name != '' GROUP BY repo_name ORDER BY s DESC LIMIT ${SEED_BUCKET_LIMIT}`
    ),
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(pushes) AS s FROM gh_repo_daily WHERE ${sinceClause} AND repo_name != '' GROUP BY repo_name ORDER BY s DESC LIMIT ${SEED_BUCKET_LIMIT}`
    ),
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(commits) AS s FROM gh_repo_daily WHERE ${sinceClause} AND repo_name != '' GROUP BY repo_name ORDER BY s DESC LIMIT ${SEED_BUCKET_LIMIT}`
    ),
  ]);

  const valid = (name?: string) => !!name && name.includes("/");
  const picked = new Set<string>();
  for (const r of [...stars, ...forks, ...pushes, ...commits]) {
    if (valid(r.repo_name)) picked.add(r.repo_name);
  }
  if (picked.size === 0) return 0;

  const now = new Date();
  const insertedAt = now.toISOString().slice(0, 19).replace("T", " ");
  const rows: WatchlistRow[] = Array.from(picked).map((repo_name) => ({
    repo_name,
    added_at: insertedAt,
    added_by: "system",
    source: "auto-seed",
    priority: 1,
    inserted_at: insertedAt,
  }));

  await clickhouseInsert.insert({ table: "watchlist", values: rows, format: "JSONEachRow" });
  logger.log("Auto-seeded watchlist", { count: rows.length });
  return rows.length;
}

// Hourly candidate picker: union of (a) repos on the watchlist and (b) a small
// rolling-activity top-N from the firehose (so new hot repos enter and stale
// ones age out). Capped at MAX_REPOS_PER_RUN.
async function pickRepos(): Promise<string[]> {
  const [watched, activity] = await Promise.all([
    selectRows<{ repo_name: string }>(
      `SELECT repo_name FROM watchlist ORDER BY priority DESC, added_at ASC LIMIT ${MAX_REPOS_PER_RUN}`
    ),
    selectRows<{ repo_name: string }>(
      `SELECT repo_name,
              uniqExactIf(actor_login, lower(actor_login) NOT LIKE '%[bot]%') AS human_actors
       FROM github_events
       WHERE created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 7 DAY
         AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')
         AND repo_name != ''
       GROUP BY repo_name
       ORDER BY human_actors DESC
       LIMIT ${Math.floor(MAX_REPOS_PER_RUN / 2)}`
    ),
  ]);

  const picked = new Set<string>();
  for (const r of watched) picked.add(r.repo_name);
  for (const r of activity) picked.add(r.repo_name);
  return Array.from(picked).slice(0, MAX_REPOS_PER_RUN);
}

export const refreshRepoActivity = schedules.task({
  id: "refresh-repo-activity",
  cron: "30 * * * *",
  maxDuration: MAX_DURATION_SECONDS,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    if (!process.env.GITHUB_TOKEN) {
      logger.log("GITHUB_TOKEN is not set - GitHub REST activity poller cannot run without it (60/hr unauthenticated limit is too small for 4 endpoints × 50 repos)");
      metadata.set("ingest", { source: "gh-repo-activity", inserted: 0, candidates: 0, error: "no GITHUB_TOKEN" });
      return { inserted: 0, candidates: 0, error: "no GITHUB_TOKEN" };
    }

    // First-run auto-seed.
    const wlCount = await watchlistCount();
    let seeded = 0;
    if (wlCount === 0) {
      seeded = await autoSeedWatchlist();
      if (seeded === 0) {
        logger.log("Watchlist empty and auto-seed found no candidates (gh_repo_daily may be empty)");
        metadata.set("ingest", { source: "gh-repo-activity", inserted: 0, candidates: 0, seeded: 0 });
        return { inserted: 0, candidates: 0, seeded: 0 };
      }
    }

    const repoNames = await pickRepos();
    if (repoNames.length === 0) {
      metadata.set("ingest", { source: "gh-repo-activity", inserted: 0, candidates: 0, seeded });
      logger.log("No repos to poll this run", { seeded });
      return { inserted: 0, candidates: 0, seeded };
    }

    const runStart = Date.now();
    const runDeadlineMs = MAX_DURATION_SECONDS * 1000 - RUN_DEADLINE_BUFFER_MS;
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    let processed = 0;
    let skippedForTimeBudget = 0;
    const counts = { commits: 0, prs: 0, releases: 0, issues: 0 };
    let reposWithData = 0;

    for (let i = 0; i < repoNames.length; i += FETCH_CONCURRENCY) {
      if (Date.now() - runStart > runDeadlineMs) {
        skippedForTimeBudget = repoNames.length - i;
        logger.log("Stopping early to fit the run's time budget", {
          processed,
          candidates: repoNames.length,
          skippedForTimeBudget,
        });
        break;
      }

      const batch = repoNames.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (repoName) => {
          try {
            return await fetchRepoActivity(repoName, since, { maxItems: 100 });
          } catch (err) {
            logger.log("Failed to fetch activity for repo", { repoName, error: String(err) });
            return null;
          }
        })
      );

      const commitsRows: unknown[] = [];
      const prsRows: unknown[] = [];
      const releasesRows: unknown[] = [];
      const issuesRows: unknown[] = [];

      for (const act of results) {
        if (!act) continue;
        if (act.commits.length || act.prs.length || act.releases.length || act.issues.length) {
          reposWithData++;
        }
        counts.commits += act.commits.length;
        counts.prs += act.prs.length;
        counts.releases += act.releases.length;
        counts.issues += act.issues.length;
        commitsRows.push(...act.commits);
        prsRows.push(...act.prs);
        releasesRows.push(...act.releases);
        issuesRows.push(...act.issues);
      }

      // Bulk insert per table via the batching insert client (async_insert
      // settings) — plain HTTP query bulk loads die at the load balancer
      // (CLAUDE.md gotcha #2).
      if (commitsRows.length) await clickhouseInsert.insert({ table: "gh_repo_commits", values: commitsRows, format: "JSONEachRow" });
      if (prsRows.length) await clickhouseInsert.insert({ table: "gh_repo_prs", values: prsRows, format: "JSONEachRow" });
      if (releasesRows.length) await clickhouseInsert.insert({ table: "gh_repo_releases", values: releasesRows, format: "JSONEachRow" });
      if (issuesRows.length) await clickhouseInsert.insert({ table: "gh_repo_issues", values: issuesRows, format: "JSONEachRow" });

      processed = Math.min(i + FETCH_CONCURRENCY, repoNames.length);
      metadata.set("ingest", {
        source: "gh-repo-activity",
        processed,
        candidates: repoNames.length,
        reposWithData,
        counts,
        seeded,
      });
    }

    // Data-freshness marker for the UI ("data is Xs old").
    await clickhouseInsert.insert({
      table: "ingest_log",
      values: [{
        source: "gh-repo-activity",
        chunk_key: `hourly-${new Date().toISOString().slice(0, 13)}`,
        rows_ingested: counts.commits + counts.prs + counts.releases + counts.issues,
        watermark: 0,
      }],
      format: "JSONEachRow",
    });

    logger.log("Refreshed GitHub repo activity", {
      candidates: repoNames.length,
      processed,
      reposWithData,
      counts,
      seeded,
      skippedForTimeBudget,
    });
    return { inserted: counts.commits + counts.prs + counts.releases + counts.issues, candidates: repoNames.length, processed, reposWithData, counts, seeded, skippedForTimeBudget };
  },
});