import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouseInsert, selectRows } from "../lib/clickhouse";
import { fetchRepo, fetchTopics, toRow } from "../lib/github-repo";

// --- Budget (issue #48) -----------------------------------------------------
// Every repo costs 2 sequential REST calls (fetchRepo + fetchTopics). At the
// old MAX_REPOS_PER_RUN=300 / FETCH_CONCURRENCY=5 that's 600 calls; against
// GitHub's authenticated core-REST limit (5000/hr) that's only ~12% of quota,
// so the timeouts were not primary-quota exhaustion - they were either (a) the
// unauthenticated 60/hr fallback when GITHUB_TOKEN is unset (600 calls vs a
// 60/hr budget exhausts in ~30 calls, then nearly every remaining call sleeps
// on 403 - see the GITHUB_TOKEN check in `run` below), or (b) backoff sleeps
// (up to 60s each, up to 2 attempts/call) stacking across a bursty run.
//
// New values: MAX_REPOS_PER_RUN=240 keeps the REST budget at 480 calls/run
// (~10% of the 5000/hr authenticated quota, leaving room for retries).
// FETCH_CONCURRENCY=8 raises throughput per second without approaching
// GitHub's secondary/abuse-detection concurrency guidance. maxDuration=900
// (15 min) gives real headroom: nominal fetch time at these settings is
// ~30 batches * ~1s/batch = ~30s, so the extra 300s (900 vs the old 600) is
// pure backoff-absorption margin, not baseline need. Belt-and-suspenders: the
// run loop below also stops issuing new batches once RUN_DEADLINE_BUFFER_MS
// from the end of maxDuration, so a still-bad run degrades to "insert what we
// got + log the skip count" instead of a hard timeout with zero rows (the
// bug this issue reports).
const FETCH_CONCURRENCY = 8;
const MAX_REPOS_PER_RUN = 240;
const MAX_DURATION_SECONDS = 900;
// Reserved so an in-flight batch (worst case: every item double-sleeps on
// rate limits, ~120s) can finish and the final ClickHouse insert can still
// run before Trigger.dev's hard maxDuration kill.
const RUN_DEADLINE_BUFFER_MS = 150_000;
const STALE_DAYS = 7;

// Per-bucket caps: new-today repos are the freshest signal, activity (issue
// #48) surfaces prolific shipping repos that the sparse firehose star-event
// bucket misses (CLAUDE.md gotcha #4 - PostHog/posthog, llvm/llvm-project,
// elastic/kibana etc. never had enough WatchEvents to rank in top-by-stars),
// top-by-stars keeps the trending set enriched, stale re-fetches keep
// existing rows honest.
const NEW_TODAY_LIMIT = 80;
const TOP_STARS_LIMIT = 60;
const ACTIVITY_LIMIT = 150;
const STALE_LIMIT = 120;
const ACTIVITY_WINDOW_DAYS = 7;

async function pickRepos(): Promise<string[]> {
  const [newToday, topByStars, activity, stale] = await Promise.all([
    // New-today: repos that had a repository-creation event today per GH Archive.
    selectRows<{ repo_name: string }>(
      `SELECT DISTINCT repo_name
       FROM raw.github_events
       WHERE event_type = 'CreateEvent' AND ref_type = 'repository'
         AND created_at >= today() AND repo_name != ''
       LIMIT ${NEW_TODAY_LIMIT}`
    ),
    // Top-by-stars: highest star-event volume over the trailing 30 days. Kept
    // for trending-repo coverage, but the firehose is push-dominated (CLAUDE.md
    // gotcha #4) so this bucket alone misses prolific shipping repos - see the
    // activity bucket below.
    selectRows<{ repo_name: string }>(
      `SELECT repo_name, sum(stars) AS total_stars
       FROM gh_repo_daily
       WHERE day >= today() - 30 AND repo_name != ''
       GROUP BY repo_name
       ORDER BY total_stars DESC
       LIMIT ${TOP_STARS_LIMIT}`
    ),
    // Activity (issue #48, fixed in #56): rank by non-bot distinct actors
    // (collaboration signal), not push volume - ordering by sum(pushes) surfaces
    // push-spam/data-dump repos, not genuinely prolific ones. This reads
    // github_events directly rather than the gh_repo_daily rollup: that
    // rollup's `actors` (migrations/20260718000008_github_repo_period_rollups.sql,
    // gh_repo_daily_mv) is built as `uniqState(actor_login)` with no [bot]
    // predicate, and once merged into an AggregateFunction state there's no way
    // to exclude bots after the fact - the underlying per-actor rows are gone.
    // A scoped 7-day scan over github_events is acceptable cost here since this
    // is the occasional candidate-picker (runs hourly), not the hot /deck read
    // path. uniqExactIf(...) counts only actors whose login doesn't look like a
    // bot account; countIf(PushEvent) stays as a secondary tiebreaker. Verified
    // (issue #56) to surface PostHog/posthog, llvm/llvm-project, elastic/kibana
    // instead of push-spam/data-dump repos.
    selectRows<{ repo_name: string }>(
      `SELECT repo_name,
              uniqExactIf(actor_login, lower(actor_login) NOT LIKE '%[bot]%') AS human_actors,
              countIf(event_type = 'PushEvent') AS push_count
        FROM raw.github_events
        WHERE created_at > (SELECT max(created_at) FROM raw.github_events) - INTERVAL ${ACTIVITY_WINDOW_DAYS} DAY
         AND event_type IN ('PushEvent', 'PullRequestEvent', 'IssuesEvent')
         AND repo_name != ''
       GROUP BY repo_name
       ORDER BY human_actors DESC, push_count DESC
       LIMIT ${ACTIVITY_LIMIT}`
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

  // Reserve capacity for the activity and stale buckets so a full
  // new-today + top-by-stars set can't fill MAX_REPOS_PER_RUN and starve them
  // entirely (same reasoning as the original staleReserve, extended to cover
  // the new activity bucket).
  const staleReserve = Math.min(STALE_LIMIT, Math.floor(MAX_REPOS_PER_RUN / 4));
  const activityReserve = Math.min(ACTIVITY_LIMIT, Math.floor(MAX_REPOS_PER_RUN / 3));
  const freshBudget = MAX_REPOS_PER_RUN - staleReserve - activityReserve;

  const fresh = [...newToday, ...topByStars].map((r) => r.repo_name).filter(valid);
  const activityNames = activity.map((r) => r.repo_name).filter(valid);
  const staleNames = stale.map((r) => r.repo_name).filter(valid);

  const picked = new Set<string>();
  const addUpTo = (names: string[], cap: number) => {
    for (const name of names) {
      if (picked.size >= cap) break;
      picked.add(name);
    }
  };

  // 1. Fresh (new-today + top-by-stars) up to its reserved budget.
  addUpTo(fresh, freshBudget);
  // 2. Activity up to the fresh+activity budget.
  addUpTo(activityNames, freshBudget + activityReserve);
  // 3. Stale up to the overall cap.
  addUpTo(staleNames, MAX_REPOS_PER_RUN);
  // 4. Backfill any capacity a short bucket left idle with whatever remains,
  //    in priority order, so a small activity/stale set never leaves
  //    GitHub/Trigger capacity idle.
  addUpTo(fresh, MAX_REPOS_PER_RUN);
  addUpTo(activityNames, MAX_REPOS_PER_RUN);
  addUpTo(staleNames, MAX_REPOS_PER_RUN);

  return Array.from(picked);
}

export const refreshRepoMetadata = schedules.task({
  id: "refresh-repo-metadata",
  cron: "50 * * * *",
  maxDuration: MAX_DURATION_SECONDS,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    if (!process.env.GITHUB_TOKEN) {
      // Unauthenticated REST is capped at 60 req/hr - a run of any real size
      // exhausts that in a handful of calls, then spends the rest of its time
      // sleeping on 403s. This was very likely the actual root cause of the
      // "times out every run" reports (issue #48); wiring the token is a
      // separate ops task, but this makes the misconfiguration observable
      // instead of a silent 60/hr fallback.
      logger.log("GITHUB_TOKEN is not set - falling back to the unauthenticated 60 req/hr GitHub limit; a full run cannot complete on this budget");
    }

    const repoNames = await pickRepos();
    if (repoNames.length === 0) {
      metadata.set("ingest", { source: "gh-repo-metadata", inserted: 0, candidates: 0 });
      logger.log("No repos need enrichment this run");
      return { inserted: 0, candidates: 0 };
    }

    const runStart = Date.now();
    const runDeadlineMs = MAX_DURATION_SECONDS * 1000 - RUN_DEADLINE_BUFFER_MS;

    const fetchedAt = new Date();
    const rows: ReturnType<typeof toRow>[] = [];
    let notFound = 0;
    let processed = 0;
    let skippedForTimeBudget = 0;

    for (let i = 0; i < repoNames.length; i += FETCH_CONCURRENCY) {
      if (Date.now() - runStart > runDeadlineMs) {
        skippedForTimeBudget = repoNames.length - i;
        logger.log("Stopping early to fit the run's time budget - no silent truncation, this is logged and returned", {
          processed,
          candidates: repoNames.length,
          skippedForTimeBudget,
        });
        break;
      }

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
      processed = Math.min(i + FETCH_CONCURRENCY, repoNames.length);
      metadata.set("ingest", {
        source: "gh-repo-metadata",
        processed,
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
      processed,
      inserted: rows.length,
      notFound,
      skippedForTimeBudget,
    });
    return { inserted: rows.length, candidates: repoNames.length, processed, notFound, skippedForTimeBudget };
  },
});
