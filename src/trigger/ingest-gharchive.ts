import { logger, schedules } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

const MAX_FILES_PER_RUN = 6;

// GH Archive file names use unpadded hours: 2026-07-17-0.json.gz .. -23.json.gz
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

export const ingestGhArchive = schedules.task({
  id: "ingest-gharchive",
  cron: "10 * * * *",
  maxDuration: 1500,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const done = new Set(
      (
        await selectRows<{ chunk_key: string }>(
          "SELECT chunk_key FROM ingest_log WHERE source = 'gharchive'"
        )
      ).map((r) => r.chunk_key)
    );

    // Start from the hour after the newest loaded event; GH Archive publishes
    // each hour's file shortly after the hour closes, so stop at now-1h.
    const [{ last }] = await selectRows<{ last: string }>(
      "SELECT toUnixTimestamp(toStartOfHour(max(created_at))) AS last FROM github_events"
    );
    const from = new Date((Number(last) + 3600) * 1000);
    const until = new Date(Date.now() - 60 * 60 * 1000);

    let loaded = 0;
    for (const hour of candidateHours(from, until)) {
      if (loaded >= MAX_FILES_PER_RUN) break;
      const key = hourKey(hour);
      if (done.has(key)) continue;

      const url = `https://data.gharchive.org/${key}.json.gz`;
      try {
        await clickhouse.command({
          query: `
            INSERT INTO github_events
            SELECT toUInt64OrZero(id), type, tupleElement(actor,'login'), tupleElement(repo,'name'), created_at,
                   JSONExtractString(payload,'action'), toUInt32(JSONExtractUInt(payload,'number'))
            FROM url('${url}', 'JSONEachRow',
                     'id String, type String, actor Tuple(login String), repo Tuple(name String), payload String, created_at DateTime')
            SETTINGS input_format_json_read_objects_as_strings = 1,
                     input_format_json_ignore_unknown_keys_in_named_tuple = 1,
                     input_format_skip_unknown_fields = 1,
                     max_insert_threads = 4`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("404")) {
          // File not published yet - the next scheduled run picks it up.
          logger.log("GH Archive file not yet available, stopping", { key });
          break;
        }
        throw err;
      }

      const [{ rows }] = await selectRows<{ rows: string }>(
        `SELECT count() AS rows FROM github_events WHERE toStartOfHour(created_at) = toDateTime(${Math.floor(hour.getTime() / 1000)})`
      );
      await logIngest({ source: "gharchive", chunk_key: key, rows_ingested: Number(rows) });
      loaded += 1;
      logger.log("Loaded GH Archive hour", { key, rows: Number(rows) });
    }

    return { filesLoaded: loaded };
  },
});
