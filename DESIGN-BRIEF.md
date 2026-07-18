# Attention Terminal — Design Brief

Self-contained context pack for any design conversation (Claude Design session, design
subagent, or human collaborator). Everything needed to reason about the product is here;
the repo is https://github.com/victoremnm/attention-terminal (issue #4 tracks design).

## Mission and hard constraints

ClickHouse × Trigger.dev Virtual Summer Hackathon 2026. Deadline: **July 23, midnight AoE**.
Theme: **"Beyond the Wall of Text"** — a chat agent where the response itself is the product:
visual, interactive, explorable. Direct quote from the brief: *"If your agent's best answer
is a paragraph, you've missed the brief."* Judging lens: **ratio of insight to words**.

Non-negotiables:
- Must use ClickHouse as the primary database and Trigger.dev's `chat.agent()` — superficial
  use is disqualifying; depth of use is 25% of score
- Innovation 20%, technical implementation 20%, problem fit 20%, scalability 10%, presentation 5%
- Demo video ≤5 min, must open with a live screen recording of the working product

## The product

**Attention Terminal** — ask questions about technology attention; get back rendered,
explorable visuals over two live feeds. The signature answer: **talk vs. code divergence** —
HackerNews mention velocity (talk) plotted against GitHub activity (code) for the same
technology. Talk outrunning code = hype; code outrunning talk = sleeper.

Things users should be able to see (issue #4):
- **New ideas/repos** — repos being created right now (CreateEvent), clustered by topic
- **New stars** — WatchEvent velocity per repo, breakout detection vs 30-day baseline
- **New comments** — HN comment velocity per story/topic, fresh to the minute
- **New PRs** — PullRequestEvent flow; pairs with HN mentions for divergence
- **Dogfood**: this very repo's events flow through the same pipeline — the demo can show
  the project appearing in its own live data

## Data reality (all live in ClickHouse Cloud now)

| Table | Scale | Freshness | Notes |
|---|---|---|---|
| `hackernews` | 48.9M items | **~1 minute** (Trigger.dev task tails the HN API) | full corpus since 2006; title/text token-indexed for arbitrary keyword scans |
| `github_events` | ~120M events | **hourly** (GH Archive task) | 30 days depth; event_type, repo_name, actor_login, action, number |
| `hn_hourly`, `gh_repo_hourly` | rollups | real-time via MVs | pre-aggregated counts/uniques for cheap sparklines |
| `ingest_log` | — | — | per-chunk ingestion records → "data is 49s old" freshness UI |
| `places` | 75.6M POIs | static (June 2026) | stretch goal only: geo/map answers, Morton-ordered |

Measured query characteristics: keyword trend scans over 30 days return in well under a
second; rollup reads are milliseconds. Assume the UI can afford one query per rendered
component, but not dozens per keystroke.

## Tech contract (decided)

- Backend: Trigger.dev v4 — `chat.agent()` orchestrates; scheduled tasks already ingest;
  **Realtime streaming** pushes agent output to the browser incrementally
- Agent → UI contract: agent calls a `render` tool with a **Zod-schema'd JSON payload**
  (`chartType`, axes, series, annotations) — the client maps payloads to React components;
  the LLM never emits markup, and prose is capped to captions
- Frontend: Next.js (App Router) + Recharts/Tremor + Tailwind/shadcn
- Everything in ClickHouse is versioned via goose migrations — new aggregates the design
  needs are cheap to add (file an entry in issue #3)

## Design questions to resolve (the conversation to have)

1. **Answer grammar** — enumerate the visual answer types (trend candles, momentum scatter,
   divergence chart, live ticker, repo cards, hype-cycle position) and the rules for when
   the agent picks each. This is the core design artifact.
2. **Canvas behavior** — chat rail + canvas layout; do successive answers stack as a feed,
   replace, or pin? How does a user drill into a chart (time-range zoom → re-query)?
3. **Liveness** — which components subscribe to Realtime for tick updates vs render once?
   Where does the "data freshness" indicator live?
4. **Terminal identity** — financial-terminal aesthetic (dense, dark, monospace?) vs
   consumer-clean; must read as *one system* and not a templated dashboard
5. **Demo choreography** — the 3-4 preset questions for the video, each showcasing a
   different answer type, ending on the dogfood moment (this repo in its own data)

## Anti-goals

- No paragraph answers; no markdown-table answers (the theme's explicit failure mode)
- No generic BI dashboard — every visual must be an *answer to a question*, composed by
  the agent at ask-time
- No fake liveness — anything animated must be backed by real ingestion timestamps
