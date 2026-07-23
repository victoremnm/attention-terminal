// Issue #40: gives DevScatter ("Real Builders") a real merged-PR signal.
// github_events (GH Archive firehose) is push-dominated and rarely carries
// merged-PR data (CLAUDE.md gotcha #4), so devScatter()'s sum(pr_merged) is
// ~empty on live data. This job enriches per-actor merged-PR counts via the
// GitHub search API for the actors devScatter() would surface, and lands them
// in gh_actor_pr_stats (migrations/20260721000012_gh_actor_pr_stats.sql) for
// queries.ts to LEFT JOIN. Mirrors refresh-repo-metadata.ts's enrichment-job
// shape (pick candidates -> fetch -> batch insert), but the GitHub *search*
// API has a much stricter rate limit (30 req/min authenticated, vs 5000/hr
// for core REST), so this job fetches sequentially with an explicit delay
// rather than refresh-repo-metadata's FETCH_CONCURRENCY batching.
import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";

const GITHUB_API = "https://api.github.com";

// Search-API budget: stay comfortably under GitHub's 30 req/min authenticated
// search rate limit (~1 request every 2s) even accounting for scheduler jitter.
const SEARCH_DELAY_MS = 2_500;
const MAX_ACTORS_PER_RUN = 45;
const STALE_DAYS = 3;

// Same mega-pusher threshold devScatter() uses for its 30d window (src/lib/queries.ts
// MEGA_PUSHER_THRESHOLD) - candidates here should match who devScatter() would
// actually keep, not a broader/narrower set.
const MEGA_PUSHER_THRESHOLD_30D = 400;

// Reserve capacity for re-checking actors whose count is going stale so a large
// pool of brand-new candidates can't starve stale refreshes forever.
const STALE_RESERVE = Math.min(20, Math.floor(MAX_ACTORS_PER_RUN / 2));

function chDateTime(value: Date) {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

// YYYY-MM-DD for GitHub search's `merged:>=` qualifier.
function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
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
// requests (primary or secondary), rather than hammering the API. Mirrors
// refresh-repo-metadata.ts's backoff helper.
async function respectRateLimit(res: Response) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (res.status === 403 || res.status === 429 || remaining === "0") {
    const retryAfter = res.headers.get("retry-after");
    const resetAt = res.headers.get("x-ratelimit-reset");
    let waitMs = 30_000;
    if (retryAfter) waitMs = Number(retryAfter) * 1000;
    else if (resetAt) waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 1000;
    waitMs = Math.min(waitMs, 90_000);
    logger.log("GitHub search rate limit hit, backing off", { waitMs, status: res.status });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return true;
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GitHub logins are alnum + single hyphens, but be defensive: a login containing
// search-operator-breaking characters would produce a malformed query (422)
// rather than a crash, so callers just skip it.
//
// `merged:>=${since}` scopes the count to PRs merged within the scatter window
// (issue #40 / PR #43 review): devScatter() divides this by p.prs, which is the
// selected 7d/30d window's opened-PR count, so a lifetime count would produce
// merge rates far above 100% and let prolific historical contributors outrank
// current-window builders. Bounding the numerator to the same window keeps the
// ratio meaningful.
function fetchMergedPrCount(actor: string, since: string) {
  const query = `type:pr is:merged author:${actor} merged:>=${since}`;
  return fetchSearchTotalCount(query);
}

async function fetchSearchTotalCount(searchQuery: string): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=1`,
      { headers: authHeaders() }
    );
    if (res.status === 422) return null; // malformed query (e.g. exotic login) - skip, don't crash the run
    if (await respectRateLimit(res)) continue;
    if (!res.ok) {
      logger.log("GitHub search fetch failed", { searchQuery, status: res.status });
      return null;
    }
    const body = (await res.json()) as { total_count?: number };
    return typeof body.total_count === "number" ? Math.max(0, Math.trunc(body.total_count)) : null;
  }
  return null;
}

interface CandidateRow {
  actor: string;
}

interface StatsRow {
  actor_login: string;
  fetched_at: string;
}

// Candidates: actors devScatter()'s 30d window would keep after its own bot /
// single-repo-mega-pusher filter (src/lib/queries.ts devScatterSql) - enriching
// an actor devScatter() throws away would waste search-API budget.
async function pickActors(): Promise<string[]> {
  const [candidates, existingStats] = await Promise.all([
    selectRows<CandidateRow>(
      `SELECT actor_login AS actor
       FROM (
         SELECT
           actor_login,
           lower(actor_login) LIKE '%[bot]%' AS is_bot,
           countIf(event_type = 'PushEvent') AS pushes,
           uniqExact(repo_name) AS repos,
           countIf(event_type = 'PullRequestEvent' AND action = 'opened') AS prs
         FROM github_events
         WHERE created_at > (SELECT max(created_at) FROM github_events) - INTERVAL 30 DAY
           AND actor_login != ''
         GROUP BY actor_login
       )
       WHERE NOT is_bot AND NOT (repos = 1 AND pushes >= ${MEGA_PUSHER_THRESHOLD_30D})
       ORDER BY prs DESC, pushes DESC
       LIMIT ${MAX_ACTORS_PER_RUN * 4}`
    ),
    // Existing stats rows, newest fetch per actor (table is a ReplacingMergeTree
    // on fetched_at, but pre-merge parts can hold older duplicate versions).
    selectRows<StatsRow>(
      `SELECT actor_login, max(fetched_at) AS fetched_at
       FROM gh_actor_pr_stats
       GROUP BY actor_login`
    ),
  ]);

  const lastFetched = new Map(existingStats.map((r) => [r.actor_login, r.fetched_at]));
  const staleCutoff = Date.now() - STALE_DAYS * 86_400_000;

  const neverFetched: string[] = [];
  const stale: string[] = [];
  for (const { actor } of candidates) {
    if (!actor) continue;
    const fetchedAt = lastFetched.get(actor);
    if (!fetchedAt) neverFetched.push(actor);
    else if (new Date(fetchedAt.replace(" ", "T") + "Z").getTime() < staleCutoff) stale.push(actor);
  }

  const freshBudget = MAX_ACTORS_PER_RUN - STALE_RESERVE;
  const picked: string[] = [];
  for (const actor of neverFetched) {
    if (picked.length >= freshBudget) break;
    picked.push(actor);
  }
  for (const actor of stale) {
    if (picked.length >= MAX_ACTORS_PER_RUN) break;
    picked.push(actor);
  }
  for (const actor of neverFetched) {
    if (picked.length >= MAX_ACTORS_PER_RUN) break;
    if (!picked.includes(actor)) picked.push(actor);
  }
  return picked;
}

export const refreshActorPrStats = schedules.task({
  id: "refresh-actor-pr-stats",
  // Offset from the other hourly enrichment/ingest crons (:10/:35/:50) and
  // spaced out since the search API budget only covers ~MAX_ACTORS_PER_RUN
  // actors per run - every 2 hours keeps counts reasonably fresh without
  // burning the whole search-API allowance on one repo's contributor set.
  cron: "5 */2 * * *",
  maxDuration: 600,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    const actors = await pickActors();
    if (actors.length === 0) {
      metadata.set("ingest", { source: "gh-actor-pr-stats", inserted: 0, candidates: 0 });
      logger.log("No actors need PR-stats enrichment this run");
      return { inserted: 0, candidates: 0 };
    }

    const fetchedAt = new Date();
    const since7d = isoDate(new Date(fetchedAt.getTime() - 7 * 86_400_000));
    const since30d = isoDate(new Date(fetchedAt.getTime() - 30 * 86_400_000));
    const rows: Array<{
      actor_login: string;
      merged_prs_7d: number;
      merged_prs_30d: number;
      fetched_at: string;
    }> = [];
    let notFound = 0;

    // Sequential, not batched: the search API's rate limit is per-minute and
    // much tighter than core REST, so concurrency here would just trip 403s.
    // Two windowed counts per actor (7d/30d) so each matches devScatter()'s
    // per-window denominator. The 7d count is a subset of the 30d count, so we
    // only spend the second search call when the 30d count is non-zero - most
    // candidates have no recent merged PRs, keeping us within the tight budget.
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      const merged30d = await fetchMergedPrCount(actor, since30d);
      if (merged30d === null) {
        notFound += 1;
      } else {
        let merged7d = 0;
        if (merged30d > 0) {
          await sleep(SEARCH_DELAY_MS);
          const fetched7d = await fetchMergedPrCount(actor, since7d);
          // A failed 7d refetch falls back to 0 rather than dropping the actor;
          // the 30d signal is still worth landing.
          merged7d = fetched7d ?? 0;
        }
        rows.push({
          actor_login: actor,
          merged_prs_7d: merged7d,
          merged_prs_30d: merged30d,
          fetched_at: chDateTime(fetchedAt),
        });
      }
      metadata.set("ingest", {
        source: "gh-actor-pr-stats",
        processed: i + 1,
        candidates: actors.length,
        inserted: rows.length,
      });
      if (i < actors.length - 1) await sleep(SEARCH_DELAY_MS);
    }

    if (rows.length > 0) {
      // Bulk insert via the batching insert client (async_insert settings) -
      // plain HTTP query bulk loads die at the load balancer (CLAUDE.md gotcha #2).
      await clickhouseInsert.insert({ table: "gh_actor_pr_stats", values: rows, format: "JSONEachRow" });
    }

    logger.log("Refreshed GitHub actor PR stats", {
      candidates: actors.length,
      inserted: rows.length,
      notFound,
    });
    return { inserted: rows.length, candidates: actors.length, notFound };
  },
});
