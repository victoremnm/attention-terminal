import { logger, metadata, schedules, tags } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

const MAX_FILES_PER_RUN = 12;
const STREAM_TABLE = "default.github_events_stream";

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

    // Derive the archive cursor from successful ingest_log entries, NOT
    // from max(created_at) in the stream — the real-time poller writes
    // recent timestamps that would push the cursor past unfinished hours,
    // stalling GH Archive ingestion entirely.
    const [logRow] = await selectRows<{ chunk_key: string }>(
      "SELECT max(chunk_key) AS chunk_key FROM ingest_log WHERE source = 'firehose'"
    );
    const lastKey = logRow?.chunk_key; // "2026-07-26-14" format
    const from =
      !lastKey || lastKey.startsWith("1970")
        ? new Date(Date.now() - 2 * 60 * 60 * 1000)
        : (() => {
            const [datePart, hourStr] = [lastKey.slice(0, 10), lastKey.slice(11)];
            const d = new Date(`${datePart}T${hourStr.padStart(2, "0")}:00:00Z`);
            d.setUTCHours(d.getUTCHours() + 1);
            return d;
          })();
    const until = new Date(Date.now() - 60 * 60 * 1000);

    let loaded = 0;
    for (const hour of candidateHours(from, until)) {
      if (loaded >= MAX_FILES_PER_RUN) break;
      const key = hourKey(hour);
      if (done.has(key)) continue;

      const url = `https://data.gharchive.org/${key}.json.gz`;
      const hourStart = Math.floor(hour.getTime() / 1000);
      const hourEnd = hourStart + 3600;
      try {
        // The anti-join keeps events the real-time poller already wrote for
        // this hour from being re-inserted: the RMT stream table would dedup
        // them at merge time, but MVs fire on every INSERT, so a re-inserted
        // event would double count in the AggregatingMergeTree projections.
        await clickhouse.command({
          query: `
            INSERT INTO ${STREAM_TABLE}
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
            WHERE toUInt64OrZero(id) NOT IN (
              SELECT event_id FROM ${STREAM_TABLE}
              WHERE created_at >= toDateTime(${hourStart}) AND created_at < toDateTime(${hourEnd})
            )
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
        `SELECT count() AS rows FROM ${STREAM_TABLE} WHERE toStartOfHour(created_at) = toDateTime(${Math.floor(hour.getTime() / 1000)})`
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
