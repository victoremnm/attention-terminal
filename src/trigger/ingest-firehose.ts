import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

const MAX_FILES_PER_RUN = 12;

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

export const ingestFirehose = schedules.task({
  id: "ingest-firehose",
  cron: "5 * * * *",
  maxDuration: 1500,
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

    // Bootstrap: if the firehose table is empty, start from the high-water
    // of the existing default.github_events table so we don't try to fetch
    // 1970 GH Archive files.
    const [{ firehose_last }] = await selectRows<{ firehose_last: string }>(
      "SELECT toUnixTimestamp(toStartOfHour(max(created_at))) AS firehose_last FROM default.github_events_firehose"
    );
    const from =
      firehose_last === "0" || !firehose_last
        ? new Date(Date.now() - 2 * 60 * 60 * 1000) // start 2h ago on first run
        : new Date((Number(firehose_last) + 3600) * 1000);
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
            INSERT INTO default.github_events_firehose
              (event_id, event_type, actor_login, repo_name, owner, created_at,
               action, ref_type, commit_count, distinct_commit_count, pr_merged, number, title, labels, payload)
            SELECT
              toUInt64OrZero(id),
              type,
              tupleElement(actor, 'login'),
              tupleElement(repo, 'name'),
              splitByChar('/', tupleElement(repo, 'name'))[1],
              created_at,
              JSONExtractString(payload, 'action'),
              JSONExtractString(payload, 'ref_type'),
              toUInt16(JSONExtractUInt(payload, 'size')),
              toUInt16(JSONExtractUInt(payload, 'distinct_size')),
              toUInt8(JSONExtractBool(payload, 'pull_request', 'merged')),
              toUInt32(JSONExtractUInt(payload, 'number')),
              if(type = 'PullRequestEvent',
                 JSONExtractString(payload, 'pull_request', 'title'),
                 if(type = 'IssuesEvent',
                    JSONExtractString(payload, 'issue', 'title'),
                    null)),
              if(type = 'PullRequestEvent',
                 arrayMap(x -> JSONExtractString(x, 'name'),
                          JSONExtractArrayRaw(payload, 'pull_request', 'labels')),
                 if(type = 'IssuesEvent',
                    arrayMap(x -> JSONExtractString(x, 'name'),
                             JSONExtractArrayRaw(payload, 'issue', 'labels')),
                    [])),
              payload
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
          logger.log("GH Archive file not yet available, stopping", { key });
          break;
        }
        throw err;
      }

      const [{ rows }] = await selectRows<{ rows: string }>(
        `SELECT count() AS rows FROM default.github_events_firehose WHERE toStartOfHour(created_at) = toDateTime(${Math.floor(hour.getTime() / 1000)})`
      );
      await logIngest({ source: "firehose", chunk_key: key, rows_ingested: Number(rows) });
      loaded += 1;
      metadata.set("ingest", { source: "firehose", filesLoaded: loaded, lastHour: key, rows: Number(rows) });
      logger.log("Loaded firehose hour", { key, rows: Number(rows) });
    }

    if (loaded === 0) {
      metadata.set("ingest", { source: "firehose", filesLoaded: 0 });
    }
    return { filesLoaded: loaded };
  },
});
