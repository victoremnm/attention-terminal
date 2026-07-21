// One-time (idempotent, re-runnable) backfill for gh_actor_daily (issue #41).
//
// gh_actor_daily is an AggregatingMergeTree fed by a materialized view
// (migration 20260720000012_gh_actor_daily_rollup.sql). An MV only sees inserts
// that arrive AFTER it is created, so every github_events row already in the
// table when the migration ran is missing from the rollup until backfilled
// (CLAUDE.md: "New MVs need a manual INSERT ... SELECT backfill"). Until this
// runs, devScatter() / the Real Builders deck reads an empty rollup.
//
// This is deliberately a Trigger.dev task rather than a raw manual INSERT so the
// backfill is observable (run logs/metadata), retryable, and — most importantly
// — idempotent:
//   - It fills only COMPLETE days (< today). Today's partial day is left to the
//     live MV; it ages into the 7d/30d window naturally.
//   - It skips any day already present in gh_actor_daily (populated by the MV
//     since migration, or by a prior run of this task). Re-inserting a day would
//     double-count it — an AggregatingMergeTree sums the -State values, so an
//     overlapping backfill silently inflates every aggregate.
// Together those two rules make the historical backfill and the live MV cover
// disjoint day ranges, so this can be triggered as many times as needed safely.
//
// The aggregation below mirrors gh_actor_daily_mv's SELECT byte-for-byte; if the
// MV definition changes, change both. github_events retains ~30 days (CLAUDE.md),
// so this is one bounded server-side INSERT ... SELECT, not a catch-up loop.
import { logger, metadata, task } from "@trigger.dev/sdk";
import { clickhouse, selectRows } from "../lib/clickhouse";

export const backfillActorDaily = task({
  id: "backfill-actor-daily",
  maxDuration: 600,
  run: async () => {
    // Days the rollup already has — skip them so re-running never double-counts.
    const present = await selectRows<{ day: string }>(
      "SELECT DISTINCT toString(day) AS day FROM gh_actor_daily ORDER BY day"
    );
    const presentDays = present.map((r) => r.day);
    logger.log("gh_actor_daily days already present", {
      count: presentDays.length,
      days: presentDays,
    });
    metadata.set("backfill", { presentDays: presentDays.length });

    // day-granular exclusion; the list is at most ~30 entries (30d retention).
    const excludeClause = presentDays.length
      ? `AND toDate(created_at) NOT IN (${presentDays.map((d) => `toDate('${d}')`).join(", ")})`
      : "";

    // Single server-side INSERT ... SELECT: ClickHouse does the aggregation, no
    // rows cross the wire. -State combinators write the AggregateFunction states
    // the AggregatingMergeTree expects (same as the MV).
    await clickhouse.command({
      query: `
        INSERT INTO gh_actor_daily
        SELECT
            toDate(created_at) AS day,
            actor_login,
            countState() AS events,
            uniqState(repo_name) AS repos,
            sumSimpleState(toUInt64(event_type = 'PushEvent')) AS pushes,
            sumSimpleState(toUInt64(commit_count)) AS commits,
            sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')) AS prs_opened,
            sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed' AND pr_merged = 1)) AS prs_merged
        FROM github_events
        WHERE actor_login != ''
          AND toDate(created_at) < today()
          ${excludeClause}
        GROUP BY day, actor_login
      `,
    });

    // Report the resulting table shape so the run log shows what landed.
    const [summary] = await selectRows<{ rows: string; days: string; first: string; last: string }>(
      "SELECT count() AS rows, uniqExact(day) AS days, toString(min(day)) AS first, toString(max(day)) AS last FROM gh_actor_daily"
    );
    const result = {
      totalRows: Number(summary?.rows ?? 0),
      totalDays: Number(summary?.days ?? 0),
      firstDay: summary?.first ?? null,
      lastDay: summary?.last ?? null,
      daysSkipped: presentDays.length,
    };
    logger.log("gh_actor_daily backfill complete", result);
    metadata.set("backfill", result);
    return result;
  },
});
