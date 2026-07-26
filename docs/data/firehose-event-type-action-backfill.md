# Firehose event/action aggregate backfill

`20260726000015_firehose_event_type_action_hourly.sql` creates the target and
an unfiltered incremental MV. Goose does not choose a calendar cutover and does
not run historical work.

To populate the trailing window safely:

1. Apply goose migrations with `./scripts/migrate.sh up`.
2. Pause every writer that inserts into `default.github_events_firehose` and
   verify that ingestion is paused. The backfill script refuses to run without
   `--writers-paused`; this is an operator assertion, not an attempt to guess
   how a deployment pauses its writers.
3. Run `./scripts/backfill-firehose-event-type-action.sh` (seven days), or pass
   `--days N --cutoff 2026-07-26T01:00:00Z` for an explicit exact UTC-hour
   boundary. The default cutoff is computed at runtime as the next UTC hour.
4. Keep writers paused until the script reports success, then resume them.

The script deletes the target range first with synchronous mutation semantics,
then inserts the source rows with `created_at >= cutoff - days` and the strict
upper bound `created_at < cutoff`. Because writers are paused for the pair, a
rerun with the same cutoff is safe and reconstructs the range instead of
doubling aggregate states. Rows at or after the cutoff remain covered by the
incremental MV; rows before it are rebuilt by the explicit task.

If the insert fails, keep writers paused, rerun with the same cutoff, and only
resume after verifying the target query. The source firehose retention limits
how far back `--days` can be used.
