# Attention Terminal — agent context

Hackathon project (ClickHouse × Trigger.dev Summer 2026, deadline **July 23 midnight AoE**).
A chat agent whose answers are rendered visuals over live HackerNews + GitHub attention
data. Theme: "Beyond the Wall of Text" — if the best answer is a paragraph, we've failed.
Judging: use of both tools 25% (superficial use disqualifies; must use `chat.agent()`),
problem fit 20%, technical 20%, innovation 20%. Submission: this public repo (MIT) + ≤5-min
demo video. All code must be written during July 17-23.

## What exists and works (verified)

- **Live ingestion** (`src/trigger/`): `ingest-hackernews` (every minute, tails the HN
  Firebase API — new items + score/comment updates; watermark = `max(id)` in the DB, so it
  self-heals after downtime) and `ingest-gharchive` (hourly, idempotent catch-up loop over
  GH Archive files; `ingest_log` tracks done hours). Verified: HN lag ~49s in dev.
- **ClickHouse Cloud** (org `lfefoundation`, service "My first service",
  `kmmno2h0ec.us-central1.gcp.clickhouse.cloud:8443` https / `:9440` native):
  - `hackernews` — 48.9M items, full corpus since 2006, minutes-fresh. ReplacingMergeTree
    (`update_time`) ORDER BY id: re-inserting an item is the *correct* way to update it.
  - `github_events` — ~120M events, 30 days depth, hourly-fresh. Lean schema:
    event_type/repo_name/actor_login/created_at/action/number.
  - `hn_hourly`, `gh_repo_hourly` — AggregatingMergeTree rollups fed by MVs; read with
    `-Merge` combinators (`countMerge(events)` etc.).
  - `gh_repo_drilldown_hourly`, `gh_repo_actor_hourly`, `gh_repo_activity_feed` —
    repo-specific drilldown surfaces for 24h KPIs/charts, contributor summaries, and
    latest PushEvent/PullRequestEvent rows without rescanning the full firehose.
  - `ingest_log` — ingestion idempotency + data-freshness ("data is 49s old" UI).
  - `places` — 75.6M Overture POIs (includes Foursquare data), Morton-encoded geo table.
    Stretch goal only.
- **Migrations**: ALL ClickHouse DDL goes through goose — `migrations/` +
  `./scripts/migrate.sh up|status`. Never ad-hoc DDL. New MVs need a manual
  `INSERT INTO ... SELECT` backfill (MVs only see post-creation inserts).
- **Trigger.dev**: project `lfefoundation` (`proj_inafrgiuiixqgirbqbww`), SDK v4. Dev:
  `npx trigger.dev@latest dev` (declarative cron schedules fire while it runs). Deploy to
  cloud is the day-2 task (env vars go in the Trigger.dev dashboard first).

## Design decisions (locked — see docs/ and issue #4)

- `DESIGN-BRIEF.md` — full context pack; `docs/ANSWER-GRAMMAR.md` — the answer grammar.
- Core 4 answer types: Attention Candles, Divergence (talk-vs-code), Momentum Matrix,
  Breakout Ticker; every answer = one verdict tile + one visual + ≤2-sentence caption.
  Verdict vocabulary is fixed: ACCELERATING/PEAKING/COOLING/DORMANT/BREAKOUT/DIVERGENT.
- Push layer: a "briefing" of computed headlines on open (scheduled task + LLM copy step).
  Trending = z-score vs each repo's own 30-day baseline, never absolute counts.
- Mobile-first single-column ranked feed (three-column lifecycle layouts explicitly
  rejected); terminal-dark identity; PWA + web push for watchlist alerts.
- "Lifespan" answer type (repo as living creature: birth, EKG heartbeat, vitals) is the
  planned fifth type and the demo's closing scene — this repo's own birth is in our data.
- Planned next tables (register in issue #3): `headlines`, `watchlist`, `repo_metrics`.

## Hard-won gotchas (each cost real debugging time)

1. Import from `@trigger.dev/sdk` — NEVER `@trigger.dev/sdk/v3`, never `client.defineJob`.
2. Long ClickHouse HTTP queries die silently at load balancers. Use the native client for
   bulk loads, or set `send_progress_in_http_headers: 1` (already configured in
   `src/lib/clickhouse.ts`). A 28M-row HTTP insert died mid-stream this way once.
3. The SQL playground (`play.clickhouse.com`, user `play`) caps every query at 1M result
   rows — chunk any `remoteSecure` copy below that.
4. GH Archive's global firehose is push-dominated (2026 reality: ~73 WatchEvents/hour
   globally — verified against raw files). Star/issue/comment tracking for specific repos
   must use per-repo REST (`/repos/{o}/{r}/events` is dense) via the planned watchlist
   poller. The firehose is for discovery, not per-repo precision.
5. Hackathon rule: NO code reuse from prior work (bonkbot etc.) — architectural patterns
   are fine, code is not. Everything here was written in-window.

## Conventions

- Secrets: 1Password Personal vault → `.env` (gitignored). ClickHouse creds in item
  `4innzk6cud7bz5v562i7tpgpki`, Trigger.dev in `2pgjlwxybaqvtrxjvlor5dkrsm`, OpenAI in
  `mfxzvdmx24qw74iue377jcflte`. Never inline. OPENAI_API_KEY must exist in BOTH the
  Next.js env (head-start route) and each Trigger.dev environment (agent runs) — prod
  missing it was the original silent-chat-hang root cause.
- Git: feature branches + PRs only, never push to main. Commits: `feat:`/`fix:`/`docs:`.
- Issues: #2 tracking checklist, #3 migrations/aggregates registry (update when adding
  DDL), #4 design record (append decisions there).
