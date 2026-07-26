# Chain: firehose-repo-signal-hourly aggregate

## Goal
Add `curated.firehose_repo_signal_hourly` AggregatingMergeTree + MV that pre-computes per-(repo, hour) signal windows from `default.github_events_firehose` using existing columns (no JSON parsing). Powers ticker, drilldown, and events surface.

## Files to create/edit
1. `migrations/20260726000012_firehose_repo_signal_hourly.sql` — NEW, table+MV+backfill
2. `src/lib/queries/firehose.ts` — EDIT, add FirehoseRepoSignalRow + firehoseRepoSignal()
3. `src/lib/queries/index.ts` — EDIT, export new types + function if needed
4. `src/lib/queries.integration.test.ts` — EDIT, add test for firehoseRepoSignal
5. `src/components/EventsSurface.tsx` — EDIT, add signal cards

## Subagent assignments
- **A**: Migration SQL (file 1)
- **B**: Query layer (files 2-3)
- **C**: Integration test (file 4)
- **D**: EventsSurface UI (file 5; can reference the row type defined by B)

## Signal derivation rules (no JSON parsing)
- pushes = event_type = 'PushEvent'
- forks = event_type = 'ForkEvent'
- stars = event_type = 'WatchEvent'
- prs_opened = event_type = 'PullRequestEvent' AND action = 'opened'
- prs_closed = event_type = 'PullRequestEvent' AND action = 'closed'
- issues_opened = event_type = 'IssuesEvent' AND action = 'opened'
- issues_closed = event_type = 'IssuesEvent' AND action = 'closed'
- releases = event_type = 'ReleaseEvent'
- branches_created = event_type = 'CreateEvent' AND ref_type = 'branch'
- branches_deleted = event_type = 'DeleteEvent' AND ref_type = 'branch'
