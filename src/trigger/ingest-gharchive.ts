import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

const MAX_FILES_PER_RUN = 12;

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
    await tags.add("ingest");

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
      "SELECT toUnixTimestamp(toStartOfHour(max(created_at))) AS last FROM raw.github_events"
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
            INSERT INTO default.github_events
              (event_id, event_type, actor_login, repo_name, owner, created_at, action, ref_type,
               commit_count, distinct_commit_count, pr_merged, number, title, labels)
            SELECT toUInt64OrZero(id), type, tupleElement(actor,'login'), tupleElement(repo,'name'),
                   splitByChar('/', tupleElement(repo,'name'))[1], created_at,
                   JSONExtractString(payload,'action'), JSONExtractString(payload,'ref_type'),
                   toUInt16(JSONExtractUInt(payload,'size')),
                   toUInt16(JSONExtractUInt(payload,'distinct_size')),
                   toUInt8(JSONExtractBool(payload,'pull_request','merged')),
                   toUInt32(JSONExtractUInt(payload,'number')),
                   if(type = 'PullRequestEvent', JSONExtractString(payload, 'pull_request', 'title'),
                      if(type = 'IssuesEvent', JSONExtractString(payload, 'issue', 'title'), null)),
                   if(type = 'PullRequestEvent',
                      arrayMap(x -> JSONExtractString(x, 'name'), JSONExtractArrayRaw(payload, 'pull_request', 'labels')),
                      if(type = 'IssuesEvent',
                         arrayMap(x -> JSONExtractString(x, 'name'), JSONExtractArrayRaw(payload, 'issue', 'labels')),
                         []))
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
        `SELECT count() AS rows FROM raw.github_events WHERE toStartOfHour(created_at) = toDateTime(${Math.floor(hour.getTime() / 1000)})`
      );
      await logIngest({ source: "gharchive", chunk_key: key, rows_ingested: Number(rows) });
      loaded += 1;
      // Live progress: Realtime subscribers see each hour land as it loads.
      metadata.set("ingest", { source: "gharchive", filesLoaded: loaded, lastHour: key, rows: Number(rows) });
      logger.log("Loaded GH Archive hour", { key, rows: Number(rows) });
    }

    if (loaded === 0) {
      metadata.set("ingest", { source: "gharchive", filesLoaded: 0 });
    }
    return { filesLoaded: loaded };
  },
});
