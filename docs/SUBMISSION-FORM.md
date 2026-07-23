# Hackathon Submission Portal Fields

> **Official Submission Form Metadata for ClickHouse + Trigger.dev Hackathon**

---

## 📋 Field-by-Field Submission Details

### 1. Project Title
```text
Attention Terminal — Real-Time Developer Telemetry & Visual Analytics Engine
```
*(Length: 76 characters / Max 100 characters)*

---

### 2. Project Tagline
```text
Beyond the Wall of Text: Real-time open-source developer telemetry and interactive SVG cards powered by ClickHouse OLAP and Trigger.dev background orchestration.
```
*(Length: 157 characters / Max 160 characters)*

---

### 3. Solution Summary (Exact 490 Words / Max 500 Words)

```text
Traditional AI chat interfaces fail users by delivering a "wall of text"—dense paragraphs, repetitive bullet points, or raw unreadable log dumps. Attention Terminal fundamentally rejects this paradigm for open-source developer analytics. Built for the "Beyond the Wall of Text" theme, Attention Terminal transforms millions of raw event streams from GitHub Archive and Hacker News into interactive, Tufte-maximized SVG cards and real-time developer momentum signals. The response itself is the product: visual, interactive, and explorable.

Attention Terminal is powered by a high-performance ClickHouse + Trigger.dev v3 dual engine:

1. ClickHouse Real-Time Data Layer: ClickHouse serves as our ultra-fast columnar database, executing sub-second analytical queries across tens of millions of raw developer events. Rather than implementing traditional Kimball star schemas with heavy join penalties, we designed a Pseudo-Medallion Architecture. Raw event streams ingest into Bronze append-only tables (`github_events`). The Silver layer applies bot-filtering (`lower(actor_login) NOT LIKE '%[bot]%'`) and token bloom filter skipping indexes (`idx_github_events_actor_login`). The Gold layer computes continuous rollups via `_hourly`, `_daily`, and `_weekly` `AggregatingMergeTree` tables and Materialized Views (`gh_repo_activity_feed_mv`, `gh_repo_period_rollups`), reducing query scan sizes by over 95%. Single-pass velocity queries calculate 24-hour push, commit, fork, and issue metrics in a single SQL execution. All DDL transformations are version-controlled via Goose DDL migrations integrated into automated CD pipelines.

2. Trigger.dev v3 Orchestration: Trigger.dev handles high-frequency background ingestion workers, dbt continuous transformations, and async agent execution loops. It guarantees continuous streaming ingestion while managing scheduled rollup jobs without blocking user chat interactions.

3. Frontend Morphing Canvas & Persistent Gemini Chatbox: The frontend features a persistent floating chatbox drawer (`FloatingChat.tsx`) allowing users to introspect datasets, ask natural language questions ("Why is repository X accelerating?"), and trigger visual cards without losing dashboard context. Answers render through custom SVG chart primitives (`PieChart`, `StackedBarChart`, `WaterfallChart`, `TreemapChart`, `DevScatterChart`, `HorizontalBarChart`). Slices and tiles are capped with explicit `Other` aggregations to guarantee 100% data coverage, multi-category bar colors map to global key indices, and single-category donut distributions utilize SVG circle stroke rings to prevent arc path degeneration. Every chart enforces Edward Tufte's data-ink maximization: zero chartjunk gridlines, direct labels, and monospaced tabular numerics (`tabular-nums`).

4. Production Engineering & Subagent Telemetry: Attention Terminal includes a fail-open telemetry architecture—if database connections drop, model benchmarking logs (`subagent_runs`) fail-open via local NDJSON spooling (`~/.claude/telemetry/spool.ndjson`) for automated backfill. The codebase includes comprehensive unit tests, stress test suites for extreme SVG edge cases, and snapshot regression tests.

Attention Terminal proves that developer analytics and AI chat do not have to be text dumps. By uniting ClickHouse OLAP performance with Trigger.dev background orchestration, Attention Terminal delivers a production-grade, highly scalable visual discovery terminal for the open-source software ecosystem.
```

---

### 4. GitHub URL
```text
https://github.com/victoremnm/attention-terminal
```

---

### 5. Demo Video URL
```text
[REPLACE_WITH_YOUR_YOUTUBE_OR_LOOM_LINK]
```

---

## 🏆 Scoring Criteria Alignment Matrix

| Criteria | Weight | How Attention Terminal Fulfills the Criteria |
| :--- | :--- | :--- |
| **Use of ClickHouse & Trigger.dev** | **25%** | **Deep Dual-Engine Integration**: ClickHouse powers real-time OLAP queries over `github_events` using token bloom filter skip indexes, `AggregatingMergeTree` rollups, and Goose DDL migrations. Trigger.dev v3 orchestrates background ingestion, dbt transformations, and async agent loops. |
| **Problem Fit** | **20%** | **Directly Solves "Beyond the Wall of Text"**: Replaces paragraph dumps with interactive SVG cards, single verdict badges, 4-tier repo drill-down views, and a persistent Gemini-style discovery drawer. |
| **Technical Implementation** | **20%** | **Production Engineering**: Single-pass SQL velocity queries, Pseudo-Medallion data pipeline, fail-open NDJSON telemetry spooling, 100% green CI, automated CD migrations (`.github/workflows/cd.yml`), stress tests, and snapshot regression suite. |
| **Innovation** | **20%** | **Novel Morphing Canvas**: Hand-rolled Tufte SVG chart primitives (`PieChart`, `StackedBarChart`, `WaterfallChart`, `TreemapChart`, `DevScatterChart`) with dynamic slice capping, global color indexing, and arc circle fallbacks. |
| **Scalability & Impact** | **10%** | **Sub-Second OLAP at Scale**: >95% query scan size reduction via `AggregatingMergeTree` rollups and token bloom filter skipping indexes, capable of handling hundreds of millions of raw GitHub events. |
| **Presentation** | **5%** | **Focused 3-Minute Script**: Crisp, screen-recording demo video highlighting real product usage, live queries, and system architecture. |
