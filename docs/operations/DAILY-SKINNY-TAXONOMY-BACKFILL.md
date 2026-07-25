# Daily Skinny taxonomy backfill

This is the maintenance and verification runbook for
`default.daily_skinny_subject_hourly`, the taxonomy-backed rollup used by the
Daily Skinny digest.

## Durable learnings

- Trigger task-queue pause prevents new runs, but does not stop runs already in
  progress. Before changing the rollup, confirm both writer queues are paused
  and report `running = 0`. Cancel only the exact writer runs that are known to
  be stuck; do not cancel the queued schedule backlog by default.
- The production GitHub source key is `github_events.event_id`, not `id`.
  Before writing a maintenance query, inspect the live schema with
  `SHOW CREATE TABLE default.github_events` or `DESCRIBE TABLE`.
- Materialized views are incremental. They do not reconstruct historical
  rollup state after taxonomy logic changes, so historical repair requires a
  separate set-based `INSERT ... SELECT` backfill while writers are paused.
- The rollup uses source values `hn` and `gh`. Because the target is an
  AggregatingMergeTree, physical rows can exceed logical keys while parts are
  merging. Validate logical uniqueness with
  `uniqExact(tuple(hour, subject, source))`, not only `count()`.
- Each feed has its own high-water mark. Compare HN against `max(time)` and
  GitHub against `max(created_at)`; do not require both rollups to end at the
  same hour.
- `/api/chat` is not a Next.js route in this application. Chat runs in the
  Trigger.dev realtime worker. Use `/api/digest` and `/api/trending` for a
  deterministic post-backfill API smoke test.

## Safe maintenance sequence

1. Pause `ingest-hackernews` and `ingest-gharchive` task queues.
2. Confirm both are paused and have zero running runs.
3. Truncate only `default.daily_skinny_subject_hourly`.
4. Run `./scripts/backfills/backfill-daily-skinny-taxonomy.sh 30`.
5. Verify the SQL checks below.
6. Resume both queues and confirm `paused = false`.

The backfill script must use `github_events.event_id` when grouping GitHub
events. The script is intentionally set-based so it creates bounded batches,
rather than one insert per source row.

## Human verification: ClickHouse SQL

Run these queries against the same production ClickHouse environment used by
the application. The exact counts will change as ingestion continues; the
shape and invariants are what matter.

### 1. Confirm taxonomy coverage

```sql
SELECT
  count() AS taxonomy_rows,
  countIf(length(hn_tokens) > 0) AS hn_tokenized,
  countIf(length(gh_repo_patterns) > 0) AS gh_patternized
FROM default.daily_skinny_taxonomy;
```

Expected: `taxonomy_rows = hn_tokenized = gh_patternized`, and all are
greater than zero.

### 2. Validate both rollup sources and logical keys

```sql
SELECT
  source,
  max(hour) AS rollup_high_water,
  count() AS physical_rows,
  uniqExact(tuple(hour, subject, source)) AS logical_keys,
  uniqExact(subject) AS subjects,
  sum(talk_threads) AS talk_threads,
  sum(comments) AS comments,
  sum(code_score) AS code_score,
  sum(gh_stars) AS gh_stars
FROM default.daily_skinny_subject_hourly
GROUP BY source
ORDER BY source;
```

Expected: rows for both `hn` and `gh`; `logical_keys > 0`; HN metrics are
nonzero in the HN row; GitHub `code_score` or `gh_stars` is nonzero in the GH
row. `physical_rows >= logical_keys` is normal for an AggregatingMergeTree.

### 3. Compare each rollup to its source high-water mark

```sql
SELECT max(time) AS hn_source_high_water
FROM default.hackernews;

SELECT max(created_at) AS gh_source_high_water
FROM default.github_events;

SELECT
  maxIf(hour, source = 'hn') AS hn_rollup_high_water,
  maxIf(hour, source = 'gh') AS gh_rollup_high_water
FROM default.daily_skinny_subject_hourly;
```

The rollup high-water marks should be no later than the corresponding
`toStartOfHour` source high-water mark and should be recent enough for the
maintenance window. They may differ because matching taxonomy events are not
uniformly distributed by hour.

### 4. Inspect the subject-level payload that the digest consumes

```sql
SELECT
  subject,
  sum(talk_threads) AS hn_threads,
  sum(comments) AS comments,
  sum(code_score) AS gh_code_score,
  sum(gh_stars) AS gh_stars,
  uniqMerge(repos) AS repos
FROM default.daily_skinny_subject_hourly
WHERE subject != ''
GROUP BY subject
ORDER BY gh_code_score DESC, hn_threads DESC
LIMIT 20;
```

Use this result to sanity-check the top subjects shown by the digest. Large
values should be explainable by the source rows; unexpected all-zero columns
usually indicate that one writer or one taxonomy matcher is missing.

## Human verification: API payloads

Set the deployed application URL, then run the deterministic digest and
trending checks. These validate both user-facing data and the query proof
metadata returned by the ranking API.

```bash
export BASE_URL="https://<deployment-host>"

curl -fsS "$BASE_URL/api/digest?noiseFloor=0" \
  | tee /tmp/attention-digest.json \
  | jq -e '
    .type == "digest" and
    (.clusters | type == "array" and length > 0) and
    all(.clusters[]; (.sources | has("hnThreads") and has("ghStars24h") and has("repos")))
  '

curl -fsS "$BASE_URL/api/trending?window=30d&limit=20&sort=events&direction=desc" \
  | tee /tmp/attention-trending.json \
  | jq -e '
    (.data | type == "array" and length <= 20) and
    (.proof.rowsRead | type == "number" and . >= 0) and
    (.proof.elapsedMs | type == "number" and . >= 0) and
    (.proof.sourceTables | type == "array" and length > 0)
  '

jq '{generatedAt, clusters: (.clusters | length), subjects: [.clusters[].subject]}' \
  /tmp/attention-digest.json

jq '{rows: (.data | length), rowsRead: .proof.rowsRead, elapsedMs: .proof.elapsedMs, sourceTables: .proof.sourceTables}' \
  /tmp/attention-trending.json
```

Human acceptance criteria:

- Neither endpoint returns an `error` object or a 5xx response.
- `/api/digest` contains at least one cluster with nonnegative HN, GitHub-star,
  and repository source fields.
- `/api/trending` returns no more than the requested 20 rows and includes
  numeric, nonnegative `rowsRead` and `elapsedMs` proof fields.
- At least one digest subject is present in the SQL subject-level query, and
  the API values are directionally consistent with the SQL totals.

