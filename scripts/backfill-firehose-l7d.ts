/**
 * L7D backfill script: inserts last 7 days of GH Archive .gz files
 * into default.github_events_stream with actual payloads.
 *
 * Usage: npx tsx scripts/backfill-firehose-l7d.ts [--dry-run] [--from YYYY-MM-DD-HH] [--to YYYY-MM-DD-HH]
 */
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE ?? "default",
});

function hourKey(d: Date): string {
  return `${d.toISOString().slice(0, 10)}-${d.getUTCHours()}`;
}

function* candidateHours(from: Date, until: Date) {
  const cursor = new Date(from);
  while (cursor <= until) {
    yield new Date(cursor);
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
}

function parseHourArg(value: string): Date {
  // Accept both ISO timestamps and YYYY-MM-DD-HH format
  if (/^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(value)) {
    const [datePart, hourPart] = value.split("-");
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, Number(hourPart)));
  }
  return new Date(value);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");

  const until = toIdx >= 0 && args[toIdx + 1]
    ? parseHourArg(args[toIdx + 1])
    : new Date(Date.now() - 60 * 60 * 1000);
  const from = fromIdx >= 0 && args[fromIdx + 1]
    ? parseHourArg(args[fromIdx + 1])
    : new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

  console.log(`Backfilling from ${from.toISOString()} to ${until.toISOString()}`);
  console.log(`Dry run: ${dryRun}`);

  // Skip hours that already have data in the firehose (from migration backfill
  // or previous ingest runs) to avoid duplicates in MergeTree.
  // Only check the L7D window to avoid scanning the full table.
  const existingRows = await client.query({
    query: `SELECT DISTINCT toString(toStartOfHour(created_at)) AS hour
            FROM default.github_events_stream
            WHERE created_at > {from: DateTime}`,
    format: "JSONEachRow",
    query_params: { from: from.toISOString().slice(0, 19).replace("T", " ") },
  });
  const existingData = await existingRows.json<{ hour: string }>();
  const existing = new Set(existingData.map((r) => r.hour));
  console.log(`Found ${existing.size} existing hours in firehose`);

  let loaded = 0;
  for (const hour of candidateHours(from, until)) {
    const key = hourKey(hour);
    const url = `https://data.gharchive.org/${key}.json.gz`;
    // Truncate to hour start for comparison with toStartOfHour()
    const hourStart = new Date(hour);
    hourStart.setUTCMinutes(0, 0, 0);
    const hourNorm = hourStart.toISOString().slice(0, 19).replace("T", " ");
    if (existing.has(hourNorm)) {
      if (dryRun) {
        console.log(`Skipping ${key} (already has data)`);
      }
      continue;
    }

    if (dryRun) {
      console.log(`Would fetch: ${url}`);
      loaded++;
      continue;
    }

    try {
      await client.command({
        query: `
          INSERT INTO default.github_events_stream
            (event_id, event_type, actor_login, actor_avatar, repo_name, owner, created_at,
             action, ref_type, number, title, payload)
          SELECT
            toUInt64OrZero(id),
            type,
            tupleElement(actor, 'login'),
            tupleElement(actor, 'avatar_url'),
            tupleElement(repo, 'name'),
            splitByChar('/', tupleElement(repo, 'name'))[1],
            created_at,
            JSONExtractString(payload, 'action'),
            JSONExtractString(payload, 'ref_type'),
            toUInt32(JSONExtractUInt(payload, 'number')),
            if(type = 'PullRequestEvent',
               JSONExtractString(payload, 'pull_request', 'title'),
               if(type = 'IssuesEvent',
                  JSONExtractString(payload, 'issue', 'title'),
                  null)),
            payload
          FROM url('${url}', 'JSONEachRow',
                   'id String, type String, actor Tuple(login String, avatar_url String), repo Tuple(name String), payload String, created_at DateTime')
          SETTINGS input_format_json_read_objects_as_strings = 1,
                   input_format_json_ignore_unknown_keys_in_named_tuple = 1,
                   input_format_skip_unknown_fields = 1,
                   max_insert_threads = 4`,
      });

      const countResult = await client.query({
        query: `SELECT toString(count()) AS rows FROM default.github_events_stream WHERE toStartOfHour(created_at) = toDateTime('${hourStart.toISOString().slice(0, 19).replace("T", " ")}')`,
        format: "JSONEachRow",
      });
      const countData = await countResult.json<{ rows: string }>();
      const rowCount = countData[0]?.rows ?? "0";
      console.log(`Loaded ${key}: ${rowCount} rows`);
      loaded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("404")) {
        console.log(`Not available yet: ${key}`);
        continue;
      }
      throw err;
    }
  }

  console.log(`Done. Loaded ${loaded} hours.`);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
