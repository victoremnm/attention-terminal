#!/usr/bin/env node

import { createClient } from "@clickhouse/client";

const USAGE = `Usage:
  ./scripts/backfill-firehose-repo-signals.sh --writers-paused --rebuild [options]

Options:
  --writers-paused       Required acknowledgement that firehose writers are paused.
  --rebuild              Truncate hourly tables and drop affected partitions from daily/monthly before inserting the window.
  --cutoff <timestamp>   Exclusive UTC cutoff; defaults to ClickHouse now().
  --window-hours <n>     Number of hours before cutoff to rebuild (default: 168).
  --help                 Show this help.
`;

function parseArgs(argv) {
  const options = { windowHours: 168, writersPaused: false, rebuild: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--writers-paused") options.writersPaused = true;
    else if (arg === "--rebuild") options.rebuild = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--cutoff") options.cutoff = argv[++i];
    else if (arg === "--window-hours") options.windowHours = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; load the project .env first`);
  return value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.writersPaused) {
    throw new Error("Refusing to backfill while writers may be active. Pass --writers-paused after pausing the firehose writer.");
  }
  if (!options.rebuild) {
    throw new Error("Refusing an additive backfill. Pass --rebuild so reruns replace the selected aggregate window.");
  }
  if (!Number.isInteger(options.windowHours) || options.windowHours < 1 || options.windowHours > 24 * 30) {
    throw new Error("--window-hours must be an integer between 1 and 720");
  }

  const client = createClient({
    url: requireEnv("CLICKHOUSE_URL"),
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    database: process.env.CLICKHOUSE_DATABASE || "default",
  });

  try {
    let cutoff = options.cutoff;
    if (!cutoff) {
      const response = await client.query({
        query: "SELECT formatDateTime(now(), '%Y-%m-%d %H:%i:%S') AS cutoff",
        format: "JSONEachRow",
      });
      const rows = await response.json();
      cutoff = rows[0]?.cutoff;
    }

    if (!cutoff) throw new Error("Could not determine a runtime cutoff from ClickHouse");

    console.log(`[firehose-backfill] cutoff=${cutoff} window_hours=${options.windowHours}`);

    // Preflight: verify all 4 target tables exist before any destructive action.
    const preflight = await client.query({
      query: `
        SELECT count() AS cnt FROM system.tables
        WHERE database = 'curated'
          AND name IN (
            'firehose_repo_signal_hourly',
            'firehose_event_type_action_hourly',
            'firehose_event_type_action_daily',
            'firehose_event_type_action_monthly'
          )
        FORMAT JSONEachRow
      `,
      format: "JSONEachRow",
    }).then((r) => r.json());
    if (!preflight[0] || preflight[0].cnt !== "4") {
      throw new Error(
        "One or more curated aggregate targets are missing. " +
        "Run ./scripts/migrate.sh up through migration 00017 before backfilling."
      );
    }
    console.log("[firehose-backfill] all 4 aggregate targets present");

    // Truncate hourly tables (no partitioning — full rebuild of the window).
    await client.command({ query: "TRUNCATE TABLE curated.firehose_repo_signal_hourly" });
    await client.command({ query: "TRUNCATE TABLE curated.firehose_event_type_action_hourly" });

    // For monthly-partitioned tables, drop only affected partitions so older
    // monthly states outside the backfill window are preserved.
    const fromDt = new Date(
      new Date(cutoff).getTime() - options.windowHours * 3600 * 1000
    );
    const toDt = new Date(cutoff);
    const affectedMonths = new Set();
    const m = new Date(fromDt.getFullYear(), fromDt.getMonth(), 1);
    while (m < toDt) {
      affectedMonths.add(
        m.getFullYear() + String(m.getMonth() + 1).padStart(2, "0")
      );
      m.setMonth(m.getMonth() + 1);
    }
    for (const month of affectedMonths) {
      for (const table of [
        "curated.firehose_event_type_action_daily",
        "curated.firehose_event_type_action_monthly",
      ]) {
        await client
          .command({ query: `ALTER TABLE ${table} DROP PARTITION ID '${month}'` })
          .catch((err) => {
            if (!err.message?.includes("no partition")) throw err;
          });
      }
    }
    console.log(`[firehose-backfill] dropped ${affectedMonths.size} partition month(s) from daily+monthly`);

    const params = { cutoff, windowHours: options.windowHours };
    await client.command({
      query: `
        INSERT INTO curated.firehose_repo_signal_hourly
        SELECT
            toStartOfHour(created_at) AS hour,
            repo_name,
            sumSimpleState(toUInt64(event_type = 'PushEvent')),
            sumSimpleState(toUInt64(event_type = 'ForkEvent')),
            sumSimpleState(toUInt64(event_type = 'WatchEvent')),
            sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'opened')),
            sumSimpleState(toUInt64(event_type = 'PullRequestEvent' AND action = 'closed')),
            sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'opened')),
            sumSimpleState(toUInt64(event_type = 'IssuesEvent' AND action = 'closed')),
            sumSimpleState(toUInt64(event_type = 'ReleaseEvent')),
            sumSimpleState(toUInt64(event_type = 'CreateEvent' AND ref_type = 'branch')),
            sumSimpleState(toUInt64(event_type = 'DeleteEvent' AND ref_type = 'branch')),
            countState(),
            uniqState(actor_login)
        FROM default.github_events_firehose
        WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
          AND created_at < {cutoff: DateTime}
        GROUP BY hour, repo_name
      `,
      query_params: params,
    });

    await client.command({
      query: `
        INSERT INTO curated.firehose_event_type_action_hourly
        SELECT
            toStartOfHour(created_at) AS hour,
            repo_name,
            event_type,
            action,
            countState(),
            uniqState(actor_login)
        FROM default.github_events_firehose
        WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
          AND created_at < {cutoff: DateTime}
        GROUP BY hour, repo_name, event_type, action
      `,
      query_params: params,
    });

    await client.command({
      query: `
        INSERT INTO curated.firehose_event_type_action_daily
        SELECT
            toDate(created_at) AS day,
            repo_name,
            event_type,
            action,
            countState(),
            uniqState(actor_login)
        FROM default.github_events_firehose
        WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
          AND created_at < {cutoff: DateTime}
        GROUP BY day, repo_name, event_type, action
      `,
      query_params: params,
    });

    await client.command({
      query: `
        INSERT INTO curated.firehose_event_type_action_monthly
        SELECT
            toStartOfMonth(created_at) AS month,
            repo_name,
            event_type,
            action,
            countState(),
            uniqState(actor_login)
        FROM default.github_events_firehose
        WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
          AND created_at < {cutoff: DateTime}
        GROUP BY month, repo_name, event_type, action
      `,
      query_params: params,
    });

    const result = await client.query({
      query: `
        SELECT
          (SELECT count() FROM curated.firehose_repo_signal_hourly) AS repo_signal_rows,
          (SELECT count() FROM curated.firehose_event_type_action_hourly) AS hourly_rows,
          (SELECT count() FROM curated.firehose_event_type_action_daily) AS daily_rows,
          (SELECT count() FROM curated.firehose_event_type_action_monthly) AS monthly_rows
        FORMAT JSONEachRow
      `,
      format: "JSONEachRow",
    }).then((response) => response.json());

    console.log(`[firehose-backfill] complete ${JSON.stringify(result[0])}`);
    console.log("[firehose-backfill] verify the results before resuming writers");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[firehose-backfill] failed: ${error.message}`);
  console.error(USAGE);
  process.exitCode = 1;
});
