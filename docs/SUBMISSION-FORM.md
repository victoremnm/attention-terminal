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

The system is built around two pieces of infrastructure. ClickHouse handles the analytical side: it stores the raw event streams, maintains rollups for common time windows, and serves fast queries for repo drill-downs, trend views, and summary cards. Trigger.dev handles the operational side: ingestion jobs, refresh tasks, and other background work run outside the request path so the UI stays responsive.

On the front end, the product uses a floating chat drawer and a small set of SVG primitives to present the answer in the right format for the data. Small part-to-whole comparisons use pie or donut charts, grouped comparisons use stacked bars, cumulative change uses waterfall charts, higher-density views use treemaps, and developer behavior comparisons use scatter plots.

The project also includes a multi-model agent workflow. Subagent runs are logged to ClickHouse so model latency, cost, and success rate can be compared over time.

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
| Use of ClickHouse & Trigger.dev | 25% | ClickHouse serves the query layer and rollups; Trigger.dev runs ingestion and refresh jobs. |
| Problem fit | 20% | Replaces long text answers with rendered visual cards and charts. |
| Technical implementation | 20% | Uses rollups, background jobs, migrations, and query-focused UI components. |
| Innovation | 20% | Uses chart selection rules and agent telemetry instead of a single generic chat response. |
| Scalability & impact | 10% | Designed for large event volumes and repeatable background refreshes. |
| Presentation | 5% | The demo script is short, screen-recorded, and tied to the live product. |
