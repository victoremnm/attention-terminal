# Hackathon Submission Portal Fields

> Submission-ready text for the ClickHouse + Trigger.dev hackathon entry.

---

## 1. Project title

```text
Attention Terminal — Real-Time Developer Telemetry & Visual Analytics Engine
```

---

## 2. Project tagline

```text
Developer telemetry and chart-based answers powered by ClickHouse and Trigger.dev.
```

---

## 3. Solution summary

```text
Traditional AI chat tools usually answer with long paragraphs, which makes developer data hard to scan and compare. Attention Terminal turns GitHub and Hacker News activity into charts and cards that are easier to read and verify.

The system is built around two pieces of infrastructure. ClickHouse handles the analytical side: raw events land in ReplacingMergeTree tables (re-inserting a Hacker News item to update its score is the correct way to upsert it, not a bug), and Materialized Views synchronously roll them into AggregatingMergeTree state at the hour/day/month grain, so repo drill-downs and trend views read a rollup instead of scanning the 140M-row firehose. Trigger.dev handles the operational side: declarative `schedules.task` cron jobs run ingestion and refresh work outside the request path, each self-healing off a ClickHouse watermark so a missed run just catches up on the next tick.

On the front end, the product uses a floating chat drawer and a small set of SVG primitives to present the answer in the right format for the data. Small part-to-whole comparisons use pie or donut charts, grouped comparisons use stacked bars, cumulative change uses waterfall charts, higher-density views use treemaps, and developer behavior comparisons use scatter plots.

The project also includes a Council of Agents: a multi-model workflow where every subagent run across every model we used (Gemini, DeepSeek, Claude, Codex, Kimi) is logged to ClickHouse and joined into one queryable view, so model latency, cost, and success rate are compared on identical tasks instead of relying on anecdotes.

In short, Attention Terminal combines analytics, background work, and chart-based answers in one product.
```

---

## 4. GitHub URL

```text
https://github.com/victoremnm/attention-terminal
```

---

## 5. Demo video URL

```text
[REPLACE_WITH_YOUR_YOUTUBE_OR_LOOM_LINK]
```

---

## 6. Scoring alignment

| Criteria | Weight | How the project fits |
| :--- | :--- | :--- |
| Use of ClickHouse & Trigger.dev | 25% | ClickHouse serves the query layer via AggregatingMergeTree/ReplacingMergeTree rollups and skip indices; Trigger.dev runs ingestion and refresh jobs via declarative cron and self-healing watermarks. |
| Problem fit | 20% | Replaces long text answers with rendered visual cards and charts, following a fixed verdict vocabulary (ACCELERATING/PEAKING/COOLING/DORMANT/BREAKOUT/DIVERGENT). |
| Technical implementation | 20% | Uses rollups, background jobs, Goose-versioned migrations, and query-focused UI components; skip-index behavior is verified against production EXPLAIN output rather than assumed. |
| Innovation | 20% | Uses chart selection rules and a Council of Agents (multi-model subagent telemetry logged to ClickHouse) instead of a single generic chat response. |
| Scalability & impact | 10% | Designed for large event volumes and repeatable background refreshes. |
| Presentation | 5% | The demo script is short, screen-recorded, and tied to the live product. |
