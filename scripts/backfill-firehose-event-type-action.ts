import { clickhouse } from "../src/lib/clickhouse";

const TARGET = "curated.firehose_event_type_action_hourly";
const SOURCE = "default.github_events_firehose";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function utcHour(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid --cutoff: ${value}`);
  if (date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    throw new Error("--cutoff must be an exact UTC hour (for example 2026-07-26T01:00:00Z)");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

const days = Number(option("--days") ?? "7");
if (!Number.isInteger(days) || days < 1 || days > 30) {
  throw new Error("--days must be an integer between 1 and 30");
}
if (!process.argv.includes("--writers-paused")) {
  throw new Error("Refusing to run without --writers-paused; pause firehose writers first");
}

// The next UTC hour includes the current partial hour in the replacement
// range. Operators may pass a stable cutoff to make a retry exact.
const defaultCutoff = new Date();
defaultCutoff.setUTCMinutes(0, 0, 0);
defaultCutoff.setUTCHours(defaultCutoff.getUTCHours() + 1);
const cutoff = utcHour(option("--cutoff") ?? defaultCutoff.toISOString());

async function run() {
  const params = { cutoff, days };
  console.log(`[firehose-event-mix] rebuilding ${days} days before ${cutoff} UTC`);

  // Writers must remain paused for the delete + insert pair. This makes a
  // rerun idempotent and prevents a source row from arriving between them.
  await clickhouse.command({
    query: `
      ALTER TABLE ${TARGET}
      DELETE WHERE hour >= toDateTime({cutoff: DateTime}) - INTERVAL {days: UInt32} DAY
        AND hour < toDateTime({cutoff: DateTime})
    `,
    query_params: params,
    clickhouse_settings: { mutations_sync: 2 },
  });

  await clickhouse.command({
    query: `
      INSERT INTO ${TARGET}
      SELECT
        toStartOfHour(created_at) AS hour,
        repo_name,
        event_type,
        action,
        countState(),
        uniqState(actor_login)
      FROM ${SOURCE}
      WHERE created_at >= toDateTime({cutoff: DateTime}) - INTERVAL {days: UInt32} DAY
        AND created_at < toDateTime({cutoff: DateTime})
      GROUP BY hour, repo_name, event_type, action
    `,
    query_params: params,
  });

  console.log("[firehose-event-mix] complete; resume writers");
}

run().catch((error) => {
  console.error("[firehose-event-mix] failed; keep writers paused until the operator verifies the target", error);
  process.exitCode = 1;
});
