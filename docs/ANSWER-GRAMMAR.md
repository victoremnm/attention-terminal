# Answer Grammar v1

The contract between the agent and the UI. Every question maps to exactly **one primary
answer type**, topped with a **verdict tile**, captioned in ≤2 sentences. The agent never
emits markup or prose walls — it calls a `render` tool with a Zod-validated payload.

Decisions locked 2026-07-17 (with @victoremnm): core 4 types + verdict tile · strict
verdict-plus-one-visual composition · feed-with-pinning canvas · terminal-dark identity.

## Answer types

### 0. Daily Skinny Digest
- **Intent:** empty prompt / daily open / "what's new" triage across both feeds
- **Visual:** bounded daily front page with 6-8 clustered subjects, separated into SHIPPING / DEBATED / HYPE bands; each row shows verdict, 7d sparkline, skinny, source counts, and talk/code share
- **Data:** `daily_skinny_subject_hourly` subject rollup fed by HN + GitHub materialized views; rolling buckets are anchored to each feed's own high-water mark
- **Noise floor:** 0-1 slider persisted client-side; filters server-side on max talk/code velocity signal and debounces API re-query
- **Drill:** row expand lazily fetches a debate map (`agree` / `dispute` / `outlier`) for that subject
- **Payload sketch:** `{ type: "digest", generatedAt, noiseFloor, clusters: [{ id, subject, verdict, band, skinny, talkShare, spark, sources, takes? }] }`

### 1. Attention Candles
- **Intent:** single topic/repo + trend question ("how is Bun trending?", "show me Rust this month")
- **Visual:** OHLC-style attention candles (or area fallback under sparse data) + volume bars beneath; hourly buckets ≤7d windows, daily beyond
- **Data:** HN keyword scans (tokenbf) + `hn_hourly`; `gh_repo_hourly` when the subject is a repo
- **Drill:** brush-zoom a range → re-query at finer bucket; toggle HN/GH series
- **Payload sketch:** `{ type: "candles", subject, window, buckets: [{t, o, h, l, c, volume}], series: "hn" | "gh" | "both" }`

### 2. Divergence Chart (talk vs. code)
- **Intent:** hype-check / comparison ("is X hype or real?", "talk vs code for htmx")
- **Visual:** two normalized lines — talk (HN mentions) vs code (GH pushes/PRs/stars) — with shaded divergence band; annotation markers on max-divergence points
- **Data:** both feeds joined on time bucket, z-scored against each subject's 30-day baseline
- **Drill:** hover markers reveal the top HN story / top repo event driving that bucket
- **Payload sketch:** `{ type: "divergence", subject, buckets: [{t, talk, code}], verdictSpread }`

### 3. Momentum Matrix
- **Intent:** open-ended category scans ("what's heating up in databases?", "compare JS runtimes")
- **Visual:** scatter — x: attention volume (log), y: 7d velocity vs baseline; quadrants labeled EMERGING / BOOMING / FADING / ESTABLISHED; dot size = GH activity share
- **Data:** rollups for a topic list (agent-expanded from the category, or user-supplied)
- **Drill:** click a dot → agent follows up with Attention Candles for that subject
- **Payload sketch:** `{ type: "matrix", topics: [{name, volume, velocity, ghShare}] }`

### 4. Breakout Ticker
- **Intent:** "now" questions ("what's new right now?", "new repos today", "star breakouts")
- **Visual:** live card feed — new repos (CreateEvent), star breakouts (WatchEvent vs baseline), rising HN stories; each card: name, one metric, micro-sparkline
- **Data:** live tables; thresholds from 30-day baselines
- **Live:** ✅ subscribes to Trigger.dev Realtime; ticks as ingestion lands. Pinned ticker keeps ticking at the top rail — this is the demo's dogfood moment (this repo appears in its own feed)
- **Payload sketch:** `{ type: "ticker", filter: "repos" | "stars" | "stories" | "all", items: [...] }` + stream channel id

### Verdict Tile (composes with every answer)
- One glanceable state + evidence sparkline + the single load-bearing number
- **Vocabulary (fixed):** `ACCELERATING` · `PEAKING` · `COOLING` · `DORMANT` · `BREAKOUT` · `DIVERGENT`
- Derived from velocity/acceleration z-scores; thresholds documented in the SQL library, cited in the tile's tooltip (no unexplainable verdicts)

## Routing rules

| Question shape | Primary type |
|---|---|
| empty prompt / daily-open / "what's new" | Daily Skinny Digest |
| one subject + trend/history | Candles |
| one subject + "real?/hype?/vs" | Divergence |
| category / plural / "compare" (3+ subjects) | Matrix |
| "now / new / latest / live" | Ticker |
| entity lookup ("tell me about X") | Candles (Entity Card is v2) |
| lifecycle/hype-cycle asked explicitly | Matrix + DIVERGENT/PEAKING verdict (Lifecycle curve is v2) |
| unanswerable from data | verdict tile `DORMANT`/no-data + caption explaining what we *can* answer — never a prose essay |

## Canvas

Feed of answers, newest on top, terminal-session feel. Any answer pins to a top rail;
pinned Ticker keeps live-updating. Each answer card shows its freshness ("data 49s old",
from `ingest_log`) and the SQL behind it on flip — transparency as a feature for judges.

## Identity

Terminal-dark: dense, dark surface, monospace numerals, financial-chart idiom. Recharts
styled to match; verdict states get the only saturated colors on screen.

## v2 (only if v1 is polished and deployed)

Entity Card · Lifecycle Position curve · free composition (verdict + chart + mini-ticker).
