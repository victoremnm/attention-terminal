// Idempotent backfill/reconcile for gh_actor_daily (issue #41).
//
// gh_actor_daily is an AggregatingMergeTree fed by a materialized view
// (migration 20260720000012_gh_actor_daily_rollup.sql). An MV only sees inserts
// that arrive AFTER it is created, so every github_events row already in the
// table when the migration ran is missing from the rollup until backfilled
// (CLAUDE.md: "New MVs need a manual INSERT ... SELECT backfill"). Until this
// runs, devScatter() / the Real Builders deck reads an empty rollup.
//
// This rebuilds every COMPLETE day (day < today) authoritatively from
// github_events, which retains the full ~30-day window (CLAUDE.md). It DELETEs
// the historical range and reinserts it rather than skipping days already
// present, because the live MV writes only PARTIAL coverage for some historical
// days:
//   - the migration day, where the MV started mid-day and has none of that day's
//     pre-migration hours;
//   - any older hour that ingest-gharchive catches up AFTER the MV was created.
// A presence check would treat those partial days as done and leave them
// permanently undercounted. DELETE + reinsert makes each run reconcile the whole
// history from source, so the task is idempotent and safe to re-run (e.g. after
// midnight UTC to fold in the migration day, or after a gharchive catch-up).
//
// today() is left entirely to the live MV: deleting/reinserting it would race the
// MV's concurrent writes. The migration day heals on the next run, once it has
// become a complete day < today().
//
// The aggregation mirrors gh_actor_daily_mv's SELECT byte-for-byte; if the MV
// definition changes, change both.
import { logger, metadata, task } from "@trigger.dev/sdk";
import { clickhouse, selectRows } from "../lib/clickhouse";

export const backfillActorDaily = task({
  id: "backfill-actor-daily",
  maxDuration: 600,
  // Singleton. Two runs overlapping would each DELETE then INSERT the same
  // range; because an AggregatingMergeTree SUMS the inserted -State values,
  // overlapping runs would double-count every actor/day instead of being
  // idempotent. concurrencyLimit: 1 serializes them.
  queue: { concurrencyLimit: 1 },
  run: async () => {
    // Wipe the historical range first so the reinsert is a replace, not a sum.
    // mutations_sync = 2 blocks until the delete mutation is fully materialized,
    // so the INSERT below can't race it.
    await clickhouse.command({
      query: "ALTER TABLE gh_actor_daily DELETE WHERE day < today() SETTINGS mutations_sync = 2",
    });

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
        FROM raw.github_events
        WHERE actor_login != ''
          AND toDate(created_at) < today()
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
    };
    logger.log("gh_actor_daily backfill complete", result);
    metadata.set("backfill", result);
    return result;
  },
});
