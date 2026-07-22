# Demo Script: Attention Terminal — "Beyond the Wall of Text"

Preset "wow" queries for the ≤5-min demo video (issue #4, #28).
Each query showcases a different answer type + both tools (ClickHouse + Trigger.dev).

## Demo flow (5 minutes)

### 1. Daily Skinny Digest (0:00–0:45)

**Ask**: "What's happening today?" (or navigate to `/skinny` or `/deck` — the digest auto-loads)

**What shows**: The Daily Skinny deck — 6–8 clustered subjects in SHIPPING/DEBATED/HYPE bands,
each as a tactile card with a verdict tile, sparkline, and top comment. The deck runs out
(no infinite scroll — it's finishable).

**Tools showcased**: ClickHouse (the `daily_skinny_subject_hourly` rollup, sub-second scan),
Trigger.dev (the scheduled task that generates the digest hourly).

**Talking point**: "Every answer is a visual, not a paragraph. The data is live — these
clusters were computed from the last hour of HN + GitHub activity."

---

### 2. Repo Drilldown — triggerdotdev/trigger.dev (0:45–2:15)

**Ask**: "Why is triggerdotdev/trigger.dev moving?"

**What shows**: The repo drilldown card with:
- Repo header (description, language, topics, stars, forks)
- 24h KPI strip (pushes, commits, actors, stars, forks, PRs, merged, issues)
- Hourly velocity chart (pushes/commits/stars over 24h)
- Pulse overview (7-day: PRs merged/opened/open, issues closed/opened/open, commit summary, top committers bar chart)
- 30-day trend timeline (star/fork lines with ▲ release / ● PR-merge / ◆ issue-open event markers)
- Recent activity lists (commits with messages, PRs with titles, releases with tags, issues with titles — all 7-day, with GitHub deep-links)
- Top contributors strip
- View-SQL flip card (the actual ClickHouse query + rows read + elapsed ms)

**Tools showcased**: ClickHouse (11 parallel queries across aggregate tables, REST-activity
tables, and `gh_repo_daily`), Trigger.dev (the `refresh-repo-activity` poller that fetches
commits/PRs/releases/issues via Octokit and persists to ClickHouse).

**Talking point**: "This is GitHub's Pulse page, but computed en-masse for all watched repos —
not on-demand per page visit. The watchlist poller auto-seeds from the top-50 repos by stars,
forks, pushes, and commits, then fetches their REST activity hourly."

---

### 3. Real Builders DevScatter (2:15–3:00)

**Ask**: "Show me the real builders"

**What shows**: The DevScatter card — a scatter plot of developers by pushes/commits/PRs
vs repos, with bot filtering. Each point is a developer; hover shows their top repos.

**Tools showcased**: ClickHouse (the `gh_actor_daily` rollup + `gh_actor_pr_stats` for merged
PR signal), Trigger.dev (the `refresh-actor-pr-stats` task that fetches merged PR counts via
GitHub REST).

**Talking point**: "This filters out bots and spam — only real human contributors. The merged
PR signal comes from GitHub REST, not the firehose, because the firehose is push-dominated."

---

### 4. Breakout Ticker (3:00–3:45)

**Ask**: "What's breaking out right now?" (or click the ticker rail)

**What shows**: The live ticker — new repos (CreateEvent), top forked 24h, shipping velocity,
star breakouts (WatchEvent vs 30-day baseline), rising HN stories. Each ticker tile has a
sparkline and deep-links to the repo drilldown.

**Tools showcased**: ClickHouse (the `gh_repo_hourly` + `hn_hourly` rollups, z-scored against
30-day baselines), Trigger.dev (the ticker subscribes to Realtime for live tick-updates).

**Talking point**: "The ticker is live — it subscribes to Trigger.dev Realtime, so new repos
and star breakouts tick in as the firehose ingests. The z-score is against each repo's own
30-day baseline, not absolute counts — so a 10-star repo can still 'break out' if it usually
gets 0."

---

### 5. Divergence — talk vs code (3:45–4:30)

**Ask**: "Is Claude Code hype or real?" (or any trending topic)

**What shows**: The divergence chart — two normalized lines (HN mentions vs GitHub events)
z-scored against a 30-day baseline, with a verdict tile (DIVERGENT / ACCELERATING / COOLING).

**Tools showcased**: ClickHouse (the `hackernews` + `github_events` cross-source scan with
`tokenbf_v1` text indexes for keyword matching), Trigger.dev (the `ingest-hackernews` task
that tails the Firebase API every minute).

**Talking point**: "This is the talk-vs-code divergence — HN mentions normalized against GitHub
activity. If talk spikes but code doesn't, it's hype. If code spikes but talk doesn't, it's
real. The text indexes make arbitrary keyword scans fast across 48.9M HN items."

---

### 6. View-SQL transparency (4:30–5:00)

**Action**: Flip any card to reveal the SQL behind it.

**What shows**: The exact ClickHouse query that powered the answer, with real `rows_read` and
`elapsed_ms` from the ClickHouse summary header.

**Talking point**: "Every visual is backed by a real query you can inspect. Transparency as a
feature — no black boxes, no hallucinated tables. The agent calls a `render` tool with a
Zod-schema'd JSON payload; the LLM never emits markup, and prose is capped to captions."

---

## Dogfooding moment

Point out that `victoremnm/attention-terminal` (this repo) appears in the ticker and
drilldown — the hackathon project is tracking itself in its own live data.

## Demo prerequisites

- Trigger.dev tasks deployed to cloud (ingestion running 24/7)
- `GITHUB_TOKEN` set in **both** the Trigger.dev dashboard (for the activity poller) and the Vercel/Next.js env (for on-demand drilldown enrichment — see CLAUDE.md convention)
- Vercel deployment live
- Data freshness: `SELECT max(created_at) FROM github_events` should be < 1 hour old
- Activity tables seeded: `SELECT count() FROM gh_repo_commits` should be > 0