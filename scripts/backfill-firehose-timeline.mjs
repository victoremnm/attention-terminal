#!/usr/bin/env node

import { createClient } from "@clickhouse/client";

const USAGE = `Usage:
  ./scripts/backfill-firehose-timeline.sh --writers-paused --rebuild [options]

Options:
  --writers-paused       Required acknowledgement that firehose writers are paused.
  --rebuild              Truncate the retained timeline before replaying the source window.
  --cutoff <timestamp>   Exclusive UTC cutoff; defaults to ClickHouse now().
  --window-hours <n>     Retained timeline window before cutoff (default: 168; max: 168).
  --help                 Show this help.
`;

const TIMELINE_TABLE = "curated.event_timeline";
const DEFAULT_WINDOW_HOURS = 168;
const MAX_WINDOW_HOURS = 168;

function parseArgs(argv) {
  const options = { windowHours: DEFAULT_WINDOW_HOURS, writersPaused: false, rebuild: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--writers-paused") options.writersPaused = true;
    else if (arg === "--rebuild") options.rebuild = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--cutoff") {
      options.cutoff = argv[++i];
      if (!options.cutoff) throw new Error("--cutoff requires a UTC timestamp");
    } else if (arg === "--window-hours") {
      options.windowHours = Number(argv[++i]);
      if (!Number.isFinite(options.windowHours)) throw new Error("--window-hours requires a number");
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; load the project .env first`);
  return value;
}

const TIMELINE_SELECT = `
  SELECT
    event_id,
    created_at,
    repo_name,
    actor_login,
    actor_avatar,
    event_type,
    action,
    title,
    number,
    if(event_type = 'PushEvent',
       if(JSONExtractString(payload, 'ref') != '',
          concat('pushed to ', replaceRegexpOne(JSONExtractString(payload, 'ref'), '^refs/heads/', '')),
          'pushed'),
       if(event_type = 'WatchEvent', 'starred the repo',
          if(event_type = 'ForkEvent', 'forked the repo',
             if(event_type = 'PullRequestEvent',
                concat(action, ' PR #', toString(number)),
                if(event_type = 'IssuesEvent',
                   concat(action, ' issue #', toString(number)),
                   if(event_type = 'CreateEvent',
                      if(ref_type != '', concat('created ', ref_type), 'created'),
                      if(event_type = 'DeleteEvent',
                         if(ref_type != '', concat('deleted ', ref_type), 'deleted'),
                         if(event_type = 'ReleaseEvent',
                            concat('published ', coalesce(title, '')),
                            event_type)))))))) AS payload_summary
  FROM default.github_events_firehose
  WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
    AND created_at < {cutoff: DateTime}
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.writersPaused) {
    throw new Error("Refusing to replay while writers may be active. Pass --writers-paused after pausing the firehose writer.");
  }
  if (!options.rebuild) {
    throw new Error("Refusing an additive replay. Pass --rebuild so reruns replace the retained timeline window.");
  }
  if (!Number.isInteger(options.windowHours) || options.windowHours < 1 || options.windowHours > MAX_WINDOW_HOURS) {
    throw new Error(`--window-hours must be an integer between 1 and ${MAX_WINDOW_HOURS}; curated.event_timeline retains 7 days`);
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
        query: "SELECT formatDateTime(now('UTC'), '%Y-%m-%d %H:%i:%S') AS cutoff",
        format: "JSONEachRow",
      });
      const rows = await response.json();
      cutoff = rows[0]?.cutoff;
    }
    if (!cutoff) throw new Error("Could not determine a runtime cutoff from ClickHouse");

    const params = { cutoff, windowHours: options.windowHours };
    console.log(`[firehose-timeline-backfill] writers_paused=true rebuild=true cutoff=${cutoff} window_hours=${options.windowHours}`);

    const sourceBounds = await client.query({
      query: `
        SELECT
          count() AS source_rows,
          uniqExact(event_id) AS source_event_ids,
          minOrNull(created_at) AS source_min,
          maxOrNull(created_at) AS source_max
        FROM default.github_events_firehose
        WHERE created_at >= {cutoff: DateTime} - INTERVAL {windowHours: UInt32} HOUR
          AND created_at < {cutoff: DateTime}
      `,
      format: "JSONEachRow",
      query_params: params,
    }).then((response) => response.json());
    console.log(`[firehose-timeline-backfill] source_bounds=${JSON.stringify(sourceBounds[0] || {})}`);

    await client.command({ query: `TRUNCATE TABLE ${TIMELINE_TABLE}` });
    await client.command({
      query: `INSERT INTO ${TIMELINE_TABLE}${TIMELINE_SELECT}`,
      query_params: params,
    });

    const verification = await client.query({
      query: `
        SELECT
          count() AS timeline_rows,
          uniqExact(event_id) AS timeline_event_ids,
          countIf(event_id = 0) AS zero_event_ids,
          minOrNull(created_at) AS timeline_min,
          maxOrNull(created_at) AS timeline_max
        FROM ${TIMELINE_TABLE}
      `,
      format: "JSONEachRow",
    }).then((response) => response.json());

    const source = sourceBounds[0] || {};
    const timeline = verification[0] || {};
    console.log(`[firehose-timeline-backfill] verification=${JSON.stringify(timeline)}`);

    if (BigInt(timeline.timeline_rows ?? 0) !== BigInt(source.source_rows ?? 0)) {
      throw new Error(`row parity failed: source_rows=${source.source_rows}, timeline_rows=${timeline.timeline_rows}`);
    }
    if (BigInt(timeline.timeline_event_ids ?? 0) !== BigInt(source.source_event_ids ?? 0)) {
      throw new Error(`event_id parity failed: source_event_ids=${source.source_event_ids}, timeline_event_ids=${timeline.timeline_event_ids}`);
    }
    if (BigInt(timeline.zero_event_ids ?? 0) !== 0n) {
      throw new Error(`timeline contains ${timeline.zero_event_ids} rows with event_id=0`);
    }
    console.log("[firehose-timeline-backfill] complete; verify the timeline before resuming writers");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[firehose-timeline-backfill] failed: ${error.message}`);
  console.error(USAGE);
  process.exitCode = 1;
});
