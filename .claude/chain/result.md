# Chain result: firehose-repo-signal-hourly aggregate

## Files created/edited

| File | Action | Subagent |
|------|--------|----------|
| `migrations/20260726000012_firehose_repo_signal_hourly.sql` | Created | A |
| `src/lib/queries/firehose.ts` | Edited | B |
| `src/lib/queries.integration.test.ts` | Edited | C |
| `src/components/EventsSurface.tsx` | Edited | D |

## Validation

- `npx tsc --noEmit` — zero new errors (only pre-existing errors in clickhouse.test.ts and actor-leaderboard.ts)
- Migration follows goose format, uses `default.github_events_firehose` physical table (correct for MVs)
- Query uses parameterized placeholders (`{hours: UInt32}`, `{limit: UInt32}`)
- EventsSurface fetches in parallel via Promise.all with existing queries — no serialization regression
- Type `FirehoseRepoSignalRow` properly exported via `index.ts` `export * from "./firehose"`

## Branch

`feat/firehose-repo-signal` — checked out in main workdir.
