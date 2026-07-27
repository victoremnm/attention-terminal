import { logger, metadata, task, tags } from "@trigger.dev/sdk";
import { clickhouse, logIngest, selectRows } from "../lib/clickhouse";

const MAX_FILES_PER_RUN = 24;
const STREAM_TABLE = "default.github_events_stream";
// A fully loaded GH Archive hour is ~185K rows; the real-time poller writes
// at most a few hundred watchlist-repo rows per hour. Only treat an hour as
// already-loaded when it clears this threshold — otherwise the backfill must
// still fetch the file (the anti-join protects poller rows from dupes).
const FULL_HOUR_MIN_ROWS = 50_000;

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

    // Skip hours already in ingest_log (from previous runs)
    const done = new Set(
      (
        await selectRows<{ chunk_key: string }>(
          "SELECT chunk_key FROM ingest_log WHERE source = 'firehose'"
        )
      ).map((r) => r.chunk_key)
    );

    // Also skip hours that are already fully loaded in the stream table
    // (from the migration backfill or previous ingest runs). Hours with only
    // partial real-time-poller rows do NOT count — see FULL_HOUR_MIN_ROWS.
    const existing = new Set(
      (
        await selectRows<{ hour: string }>(
          `SELECT toString(toStartOfHour(created_at)) AS hour, count() AS c
           FROM ${STREAM_TABLE}
           WHERE created_at > now() - INTERVAL 7 DAY
           GROUP BY hour
           HAVING c > ${FULL_HOUR_MIN_ROWS}`
        )
      ).map((r) => r.hour)
    );

    // Backfill last 7 days of GH Archive files
    const until = new Date(Date.now() - 60 * 60 * 1000);
    const from = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    let loaded = 0;
    for (const hour of candidateHours(from, until)) {
      if (loaded >= MAX_FILES_PER_RUN) break;
      const key = hourKey(hour);
      if (done.has(key)) continue;

      // Normalize to hour start for comparison
      const hourStart = new Date(hour);
      hourStart.setUTCMinutes(0, 0, 0);
      const hourKeyNorm = hourStart.toISOString().slice(0, 19).replace("T", " ");
      if (existing.has(hourKeyNorm)) {
        logger.log("Hour already has data in firehose, skipping", { key, hourKeyNorm });
        await logIngest({ source: "firehose", chunk_key: key, rows_ingested: 0 });
        continue;
      }

      const url = `https://data.gharchive.org/${key}.json.gz`;
      const hourStartUnix = Math.floor(hourStart.getTime() / 1000);
      const hourEndUnix = hourStartUnix + 3600;
      try {
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
              WHERE created_at >= toDateTime(${hourStartUnix}) AND created_at < toDateTime(${hourEndUnix})
            )
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
        `SELECT count() AS rows FROM ${STREAM_TABLE} WHERE toStartOfHour(created_at) = toDateTime('${hourKeyNorm}')`
      );
      await logIngest({ source: "firehose", chunk_key: key, rows_ingested: Number(rows) });
      loaded += 1;
      metadata.set("backfill", { source: "firehose", filesLoaded: loaded, lastHour: key, rows: Number(rows) });
      logger.log("Backfilled firehose hour", { key, rows: Number(rows) });
    }

    if (loaded === 0) {
      metadata.set("backfill", { source: "firehose", filesLoaded: 0 });
    }
    return { filesLoaded: loaded };
  },
});
