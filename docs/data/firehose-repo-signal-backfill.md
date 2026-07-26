# Firehose aggregate backfill

The firehose aggregate migrations create only tables and materialized views.
They intentionally do not choose a calendar cutover or scan historical data.
That work is operator-controlled so the selected window reflects the actual
deployment and writer state.

## Safe sequence

1. Pause the GitHub/firehose writer task and confirm it is no longer inserting.
2. Apply Goose migrations through the firehose daily/monthly rollup migration.
   Before proceeding, verify the firehose timeline MV repair in issue #308 is
   deployed; migration 13 can otherwise leave the live MV targeting its
   temporary rebuild table and cause raw firehose inserts to fail.
3. Keep the writer paused and run:

   ```bash
   ./scripts/backfill-firehose-repo-signals.sh --writers-paused --rebuild
   ```

   The script asks ClickHouse for `now()` at execution time. An explicit UTC
   cutoff can be supplied with `--cutoff "YYYY-MM-DD HH:MM:SS"`; the selected
   window defaults to 168 hours and can be changed with `--window-hours` up to
   720 hours. The raw firehose source has a 30-day TTL, so the script reports
   the retained source bounds and warns when the requested window is wider than
   the available history; it cannot reconstruct expired rows.
   The same cutoff and window are used for hourly, daily, and monthly event/action
   aggregates, so a run has one reproducible source window. The script truncates
   and rebuilds all four firehose aggregate targets, including the existing repo
   signal hourly table.
4. Run the verification queries below while writers are still paused.
5. Resume the writer only after the counts and dimensions are plausible.

The `--writers-paused` and `--rebuild` flags are required. This prevents an
accidental additive backfill, and avoids double counting rows that the
materialized views might receive while a rebuild is in progress. Do not run
the script if the writer cannot be paused. Keep the writer paused until the
parity checks pass and the reported bucket bounds are plausible.

## Verification queries

```sql
WITH
  toDateTime('2026-07-25 12:00:00') AS cutoff,
  cutoff - INTERVAL 168 HOUR AS window_start
SELECT
  min(hour) AS oldest_hour,
  max(hour) AS newest_hour,
  countMerge(events) AS event_count,
  uniqExact(repo_name) AS repos
FROM curated.firehose_event_type_action_hourly
WHERE hour >= toStartOfHour(window_start)
  AND hour < cutoff;
```

```sql
WITH
  toDateTime('2026-07-25 12:00:00') AS cutoff,
  cutoff - INTERVAL 168 HOUR AS window_start
SELECT event_type, action, countMerge(events) AS events, uniqExact(repo_name) AS repos
FROM curated.firehose_event_type_action_hourly
WHERE hour >= toStartOfHour(window_start)
  AND hour < cutoff
GROUP BY event_type, action
ORDER BY events DESC;
```

```sql
WITH
  toDateTime('2026-07-25 12:00:00') AS cutoff,
  cutoff - INTERVAL 168 HOUR AS window_start
SELECT repo_name, countMerge(events) AS events, uniqExact(event_type) AS event_types
FROM curated.firehose_event_type_action_hourly
WHERE hour >= toStartOfHour(window_start)
  AND hour < cutoff
GROUP BY repo_name
ORDER BY events DESC
LIMIT 20;
```

Replace the example `cutoff` with the exact cutoff printed by the operator.
The daily and monthly tables contain the same `(repo_name, event_type, action)`
dimensions, with `day` and `month` buckets respectively.

### Hourly/daily/monthly parity

Run this while writers remain paused. Because the operator truncates and rebuilds
the targets from one bounded raw window, the three totals must match exactly:

```sql
WITH
  toDateTime('2026-07-25 12:00:00') AS cutoff,
  cutoff - INTERVAL 168 HOUR AS window_start
SELECT
  (SELECT count() FROM default.github_events_firehose
   WHERE created_at >= window_start AND created_at < cutoff) AS source_events,
  (SELECT countMerge(events) FROM curated.firehose_event_type_action_hourly) AS hourly_events,
  (SELECT countMerge(events) FROM curated.firehose_event_type_action_daily) AS daily_events,
  (SELECT countMerge(events) FROM curated.firehose_event_type_action_monthly) AS monthly_events;
```

For dimension-level parity, use the hourly table as the reference and compare
each coarser table after summing by event/action:

```sql
WITH
  toDateTime('2026-07-25 12:00:00') AS cutoff,
  cutoff - INTERVAL 168 HOUR AS window_start
SELECT event_type, action,
  sum(hourly_events) AS hourly_events,
  sum(daily_events) AS daily_events,
  sum(monthly_events) AS monthly_events
FROM
(
  SELECT event_type, action, countMerge(events) AS hourly_events,
    0 AS daily_events, 0 AS monthly_events
  FROM curated.firehose_event_type_action_hourly
  WHERE hour >= toStartOfHour(window_start) AND hour < cutoff
  GROUP BY event_type, action
  UNION ALL
  SELECT event_type, action, 0, countMerge(events), 0
  FROM curated.firehose_event_type_action_daily
  GROUP BY event_type, action
  UNION ALL
  SELECT event_type, action, 0, 0, countMerge(events)
  FROM curated.firehose_event_type_action_monthly
  GROUP BY event_type, action
)
GROUP BY event_type, action
HAVING hourly_events != daily_events OR hourly_events != monthly_events
ORDER BY event_type, action;
```

The parity query should return zero rows. It intentionally does not enumerate
event variants: empty actions and all currently observed actioned variants are
preserved by grouping the raw `event_type` and `action` values.

The event/action result should preserve empty actions for variants such as
`PushEvent`, `CreateEvent`, `DeleteEvent`, and `PublicEvent`; it should not
collapse the observed actioned variants into a fixed enum.

The monthly table is currently an aggregate over the retained firehose source
window, which may cover only one or two calendar months. Longer historical
monthly coverage requires a durable historical source; increasing the operator
window alone cannot recover rows removed by the source TTL.
