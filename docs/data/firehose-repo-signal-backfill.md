# Firehose aggregate backfill

The firehose aggregate migrations create only tables and materialized views.
They intentionally do not choose a calendar cutover or scan historical data.
That work is operator-controlled so the selected window reflects the actual
deployment and writer state.

## Safe sequence

1. Pause the GitHub/firehose writer task and confirm it is no longer inserting.
2. Apply Goose migrations through `20260726000015`.
3. Keep the writer paused and run:

   ```bash
   ./scripts/backfill-firehose-repo-signals.sh --writers-paused --rebuild
   ```

   The script asks ClickHouse for `now()` at execution time. An explicit UTC
   cutoff can be supplied with `--cutoff "YYYY-MM-DD HH:MM:SS"`; the selected
   window defaults to 168 hours and can be changed with `--window-hours`.
4. Run the verification queries below while writers are still paused.
5. Resume the writer only after the counts and dimensions are plausible.

The `--writers-paused` and `--rebuild` flags are required. This prevents an
accidental additive backfill, and avoids double counting rows that the
materialized views might receive while a rebuild is in progress. Do not run
the script if the writer cannot be paused.

## Verification queries

```sql
SELECT
  min(hour) AS oldest_hour,
  max(hour) AS newest_hour,
  countMerge(events) AS event_count,
  uniqExact(repo_name) AS repos
FROM curated.firehose_event_type_action_hourly
WHERE hour >= now() - INTERVAL 24 HOUR;
```

```sql
SELECT event_type, action, countMerge(events) AS events, uniqExact(repo_name) AS repos
FROM curated.firehose_event_type_action_hourly
WHERE hour >= now() - INTERVAL 24 HOUR
GROUP BY event_type, action
ORDER BY events DESC;
```

```sql
SELECT repo_name, countMerge(events) AS events, uniqExact(event_type) AS event_types
FROM curated.firehose_event_type_action_hourly
WHERE hour >= now() - INTERVAL 24 HOUR
GROUP BY repo_name
ORDER BY events DESC
LIMIT 20;
```

The event/action result should preserve empty actions for variants such as
`PushEvent`, `CreateEvent`, `DeleteEvent`, and `PublicEvent`; it should not
collapse the observed actioned variants into a fixed enum.
