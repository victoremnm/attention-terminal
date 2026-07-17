# ClickHouse × Trigger.dev Hackathon 2026

**Theme: Beyond the Wall of Text** — build a chat agent where the response itself is the product: visual, interactive, explorable. Trigger.dev handles orchestration and background jobs; ClickHouse powers the real-time data layer.

- Build window: **17 July 09:00 CET → 23 July midnight AoE**
- Judging: Use of both tools 25% · Problem fit 20% · Technical implementation 20% · Innovation 20% · Scalability 10% · Presentation 5%
- Must use ClickHouse as the primary database **and** Trigger.dev's `chat.agent()`
- Bonus category: best OLTP + OLAP integration
- Submission: public GitHub repo (MIT/Apache-2.0) + demo video (max 5 min, open with live demo)

## Infrastructure

| Service | Details |
|---|---|
| ClickHouse Cloud | org `lfefoundation`, service "My first service", GCP us-central1, v26.2 |
| ClickHouse endpoint | `https://kmmno2h0ec.us-central1.gcp.clickhouse.cloud:8443` (HTTPS) / `:9440` (native) |
| Trigger.dev | project `lfefoundation` (`proj_inafrgiuiixqgirbqbww`), dev environment |

Secrets live in 1Password (Personal vault) and are mirrored into `.env` (gitignored):

- `API Credential - clickhouse-trigger-dev-api-key` — Cloud API key (`KEY_ID`/`KEY_SECRET`) + DB credentials (`DB_USER`/`DB_PASSWORD`/`DB_HOST`)
- `API Credential - Trigger.dev` — `TRIGGER_SECRET_KEY` (dev)

## Development

```bash
npx trigger.dev@latest dev   # start the local task runner
```

Tasks live in `src/trigger/`. Import from `@trigger.dev/sdk` (never `@trigger.dev/sdk/v3`, never `client.defineJob`).

Trigger a task from backend code with type-only imports:

```ts
import type { helloWorldTask } from "./src/trigger/example";
import { tasks } from "@trigger.dev/sdk";

const handle = await tasks.trigger<typeof helloWorldTask>("hello-world", {
  message: "Hello from my app!",
});
```

## Docs

- Writing tasks: https://trigger.dev/docs/tasks/overview
- Realtime (streaming to frontend): https://trigger.dev/docs/realtime/overview
- AI tooling / agents: https://trigger.dev/docs/building-with-ai
- ClickHouse JS client: https://clickhouse.com/docs/integrations/javascript
- ClickHouse MCP server: https://github.com/ClickHouse/mcp-clickhouse
