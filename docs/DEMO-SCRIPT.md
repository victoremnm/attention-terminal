# Attention Terminal — Demo Script & Narration Guide

> **Target duration**: 3:00–3:30  
> **Format**: live screen recording, no slides, no intro logos  
> **Goal**: show the product doing useful work in a way a reviewer can follow quickly

---

## Demo flow

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:45 | Open the homepage and ask a question in chat. | “Attention Terminal turns developer activity into charts and cards.” |
| 0:45–1:30 | Show the first rendered response. | “The response is a card or chart, not a paragraph.” |
| 1:30–2:15 | Open a repository drill-down card. | “This view combines repo metadata, recent activity, and the most relevant events.” |
| 2:15–2:45 | Show the ClickHouse / Trigger.dev workflow or a query/transformation example. | “ClickHouse handles analytics with Materialized Views rolling events up in real time. Trigger.dev runs ingestion and background jobs, self-healing off a watermark if a run gets missed.” |
| 2:45–3:15 | End on the architecture / telemetry / review flow. | “The system is built to be inspectable and measurable.” |

---

## Suggested narration

### 1. Opening
“This is Attention Terminal. The goal is simple: turn developer activity into charts and cards.”

### 2. Visual response
“When I ask a question, the app chooses a chart or card that matches the data.”

### 3. Repo drill-down
“A repository view brings together summary metrics, recent events, and deeper activity details.”

### 4. Engine and architecture
“The product is built on ClickHouse for analytics, with Materialized Views rolling raw events into aggregates in real time, and Trigger.dev for background work and ingestion, running on declarative cron with self-healing catch-up.”

### 5. Close
“The point of the project is not just to answer questions, but to present them in a form that is easy to review.”

---

## Recording checklist

- Use a clean browser window and dark mode.
- Keep the cursor movement slow and deliberate.
- Avoid pausing on technical details longer than needed.
- Show the live product first, then the supporting infrastructure.
- Keep the final recording inside the requested time limit.
