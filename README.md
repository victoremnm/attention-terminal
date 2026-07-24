# Attention Terminal

**Developer telemetry and chart-based answers powered by ClickHouse and Trigger.dev.**

> **Background.** This project was built for the ClickHouse × Trigger.dev Hackathon 2026 under the theme *Beyond the Wall of Text* — building a chat agent where the response itself is the product: visual, interactive, explorable. Trigger.dev handles orchestration and background jobs; ClickHouse powers the real-time data layer.

## What it does

- **Real-time dev telemetry.** Ingests GitHub Archive and Hacker News event streams into ClickHouse, processes them through materialized views and background tasks, and serves answers as charts and cards instead of walls of text.
- **Six answer types with verdict tiles.** Every question maps to one of six visual forms (attention candles, divergence chart, momentum matrix, break-out ticker, repo drill-down, daily digest) topped with a verdict tile — see [`docs/ANSWER-GRAMMAR.md`](docs/ANSWER-GRAMMAR.md).
- **Repo drill-down + live ticker.** Click any repository for a structured 4-tier card (KPI strip, velocity chart, actor feed, activity timeline). The `/trending` ticker subscribes to Trigger.dev Realtime so cards update as ingestion lands.
- **Chat agent via Trigger.dev.** The attention agent at `src/trigger/attention-agent.ts` uses Trigger.dev `chat.agent()` with scoped session tokens minted per-turn. Transport errors (closed-stream races on retry) are guarded transparently — see `src/lib/chat-stream.ts`.
- **Council of Agents.** Subagent runs across all models used in this repo (Gemini, DeepSeek, Claude, Codex, Kimi) are logged to ClickHouse and queryable in one model-comparison view — see [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) and [`docs/model-comparison.md`](docs/model-comparison.md).

## Architecture

The app follows a 5-layer flow: **Inputs** (GitHub Archive, HN API, user chat) → **Processing** (Trigger.dev ingestion tasks, dbt transforms, Goose DDL migrations) → **Data** (ClickHouse raw tables → ReplacingMergeTree/AggregatingMergeTree rollups with skipping indexes) → **Backend** (Next.js App Router, ClickHouse client pool with fail-open spooling, data-retrieval agents) → **Frontend** (Geist-monospaced terminal UI, custom SVG chart primitives, floating chat drawer). Firehose rows are at 140M+ and growing; most queries read pre-rolled AggregatingMergeTree tables for sub-second latency. Ingestion tasks self-heal off ClickHouse watermarks — a missed run catches up on the next tick. See [`docs/architecture/SYSTEM-ARCHITECTURE.md`](docs/architecture/SYSTEM-ARCHITECTURE.md) for the full Mermaid flow.

## Infrastructure

| Service | Details |
|---|---|
| ClickHouse Cloud | org `lfefoundation`, service "My first service", GCP us-central1, v26.2 |
| ClickHouse endpoint | `https://kmmno2h0ec.us-central1.gcp.clickhouse.cloud:8443` (HTTPS) / `:9440` (native) |
| Trigger.dev | project `lfefoundation` (`proj_inafrgiuiixqgirbqbww`), dev environment |
| OpenAI | model provider for attention-agent; `OPENAI_API_KEY` required in Trigger.dev env |
| Hugging Face | public Hub models API; optional `HUGGINGFACE_TOKEN`/`HF_TOKEN` for higher rate limits |
| RBAC / DPL | Read-only analyst role + Data Policy Language schema routing via `dbt/analyst.yml` (PR #239) |

Secrets live in 1Password (Personal vault) and are mirrored into `.env` (gitignored):

- `API Credential - clickhouse-trigger-dev-api-key` — Cloud API key (`KEY_ID`/`KEY_SECRET`) + DB credentials (`DB_USER`/`DB_PASSWORD`/`DB_HOST`)
- `API Credential - Trigger.dev` — `TRIGGER_SECRET_KEY` (dev)
- OpenAI API key — `OPENAI_API_KEY` for the Trigger.dev chat agent, stored at `op://Personal/API Credential - OpenAI clickhouse-trigger-dev-api-key/credential`

## Development

```bash
npm run dev              # start the Next.js app
npm test                 # run the vitest suite
npm run log-telemetry    # flush subagent telemetry from the local spool to ClickHouse
npx trigger.dev@latest dev   # start the local task runner
```

Tasks live in `src/trigger/`. Import from `@trigger.dev/sdk` (never `@trigger.dev/sdk/v3`, never `client.defineJob`).
The chat agent lives at `src/trigger/attention-agent.ts` and uses Trigger.dev `chat.agent()` with scoped session tokens minted by `src/lib/chat-actions.ts`.

Trigger a task from backend code with type-only imports:

```ts
import type { helloWorldTask } from "./src/trigger/example";
import { tasks } from "@trigger.dev/sdk";

const handle = await tasks.trigger<typeof helloWorldTask>("hello-world", {
  message: "Hello from my app!",
});
```

## Data Modeling

Goose migrations own raw ClickHouse ingestion structures: source tables, indexes,
watermarks, and real-time materialized views. dbt owns the analytical model:
staging views, conformed dimensions, facts, and product/search marts.

Events flow through a pseudo-medallion pipeline: **Bronze** (raw append-only `github_events` / `hackernews`) → **Silver** (cleansed facts with bot filtering and token bloom-filter skip indexes) → **Gold** (pre-rolled `_hourly`/`_daily`/`_monthly` AggregatingMergeTree tables). This cuts scan sizes from the full 140M-row firehose to a few thousand rollup rows for most queries.

Install dbt in a virtual environment:

```bash
python3.12 -m venv .venv-dbt
. .venv-dbt/bin/activate
pip install -r requirements-dbt.txt
```

Use Python 3.12 or 3.13 for dbt locally. The current dbt dependency stack did
not start cleanly under Python 3.14 during verification.

Run dbt with the checked-in env-var-only profile:

```bash
export CLICKHOUSE_HOST="kmmno2h0ec.us-central1.gcp.clickhouse.cloud"
export CLICKHOUSE_PORT="8443"
export CLICKHOUSE_SECURE="True"
dbt parse --profiles-dir dbt
dbt run --profiles-dir dbt
```

See `docs/data/modeling.md` for the Kimball/Inmon-style table roles and the
semantic-search direction.

## Docs

### Repo docs

- [Answer Grammar (answer types, verdict tiles, routing rules)](docs/ANSWER-GRAMMAR.md)
- [System Architecture & Mermaid Flowcharts](docs/architecture/SYSTEM-ARCHITECTURE.md)
- [Engineering Methodology & ADR Index](docs/METHODOLOGY.md)
- [Product Vision & Problem Statement](docs/product/PRODUCT-VISION-AND-METHODOLOGY.md)
- [Hackathon Submission Portal](docs/SUBMISSION-FORM.md)
- [Demo Script & Narration Guide](docs/DEMO-SCRIPT.md)
- [Architecture Decision Records](docs/adr/) (ADRs 0001–0007)

### External docs

- Writing tasks: https://trigger.dev/docs/tasks/overview
- Realtime (streaming to frontend): https://trigger.dev/docs/realtime/overview
- AI tooling / agents: https://trigger.dev/docs/building-with-ai
- ClickHouse JS client: https://clickhouse.com/docs/integrations/javascript
- ClickHouse MCP server: https://github.com/ClickHouse/mcp-clickhouse
- dbt + ClickHouse: https://clickhouse.com/docs/integrations/dbt
