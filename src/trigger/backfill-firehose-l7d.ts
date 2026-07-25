import { logger, metadata, task, tags } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

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

export const backfillFirehoseL7D = task({
  id: "backfill-firehose-l7d",
  maxDuration: 3600,
  queue: { concurrencyLimit: 1 },
  run: async () => {
    await tags.add("ingest");

    const done = new Set(
      (
        await selectRows<{ chunk_key: string }>(
          "SELECT chunk_key FROM ingest_log WHERE source = 'firehose'"
        )
      ).map((r) => r.chunk_key)
    );

    // Backfill last 7 days of GH Archive files
    const until = new Date(Date.now() - 60 * 60 * 1000);
    const from = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    let loaded = 0;
    for (const hour of candidateHours(from, until)) {
      const key = hourKey(hour);
      if (done.has(key)) continue;

      const url = `https://data.gharchive.org/${key}.json.gz`;
      try {
        await clickhouse.command({
          query: `
            INSERT INTO default.github_events_firehose
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("404")) {
          logger.log("GH Archive file not available, skipping", { key });
          continue;
        }
        throw err;
      }

      const [{ rows }] = await selectRows<{ rows: string }>(
        `SELECT count() AS rows FROM default.github_events_firehose WHERE toStartOfHour(created_at) = toDateTime(${Math.floor(hour.getTime() / 1000)})`
      );
      await logIngest({ source: "firehose", chunk_key: key, rows_ingested: Number(rows) });
      loaded += 1;
      metadata.set("backfill", { source: "firehose", filesLoaded: loaded, lastHour: key, rows: Number(rows) });
      logger.log("Backfilled firehose hour", { key, rows: Number(rows) });
    }

    return { filesLoaded: loaded };
  },
});
