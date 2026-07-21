# Agent conventions (Attention Terminal)

These conventions apply to every agent working on this repo. They are
load-bearing — agents that skip them produce unreviewable PRs and
uninstrumented work.

## Subagent telemetry (mandatory)

Every subagent run (Task tool, explore agent, general agent, any spawned
sub-agent) must be logged to `subagent_runs` in ClickHouse so the
`subagent_experiments` view picks it up. This is how we compare models
(glm-5.2 vs gpt-5.1 vs others) on the same specs.

**How to log**: call the helper script after each subagent completes:

```bash
./scripts/log-subagent-run.sh \
  --session-id "<session-id>" \
  --prompt-id "<unique-run-id>" \
  --agent-id "<agent-id>" \
  --agent-type "<explore|general|coder|...>" \
  --model "<model-name>" \
  --spec "<the spec/prompt given to the subagent>" \
  --result "<the result returned>" \
  --latency-ms <ms> \
  --ok <0|1>
```

The script reads ClickHouse creds from `.env` (same as `migrate.sh`) and
inserts a row into `subagent_runs`. It always exits 0 — telemetry must
never fail a turn.

If `CLICKHOUSE_URL` is unset, the script spools to
`~/.claude/telemetry/spool.ndjson` for later backfill (never loses data).

**What to log**:
- `spec_hash` — stable hash of the spec (same spec + different models =
  comparable rows). The script hashes the `--spec` arg.
- `model` — the model that ran the subagent (e.g. `glm-5.2:cloud`,
  `openai:gpt-5.1`). For opencode Task tool runs, use the model ID from
  the system prompt.
- `latency_ms` — wall-clock from spawn to completion.
- `ok` — 1 if the subagent returned a useful result, 0 if it errored or
  returned empty.
- `result_preview` — first 300 chars of the result (for quick scanning
  in the experiments view).

**Comparison query** (docs/model-comparison.md):
```sql
SELECT model_name, count() AS runs, avg(latency_ms) AS avg_latency,
       avg(total_cost_usd) AS avg_cost, avg(eval_score) AS avg_score
FROM subagent_experiments
WHERE agent_type = 'explore'  -- or whatever agent type
GROUP BY model_name
ORDER BY runs DESC
```

## PR template (mandatory)

Every PR must follow `.github/PULL_REQUEST_TEMPLATE.md`. The key sections:

1. **User Impact Summary** — one sentence, observable change from the
   user's seat.
2. **PR Summary** — bullet list of what changed (file paths, table names).
3. **What was verified (by the agent)** — commands + observed results.
   If the agent did NOT verify something, that fact appears here.
4. **What needs human verification** — specific UI elements, interactions,
   or external services a human must check. If nothing needs human
   verification, say "nothing — agent-verified end to end".
5. **Graceful degradation** — how the system behaves when new optional
   surfaces are absent or empty.
6. **Notes for review** — merge conflicts resolved, pre-existing bugs
   fixed, env vars added, anything surprising.

Agents must not self-merge. A human reviews and merges after the human
verification checklist is satisfied.

## Worktrees (mandatory)

Every agent works in a worktree, never directly on `main`. Create one
before starting work:

```bash
git worktree add .claude/worktrees/agent-<task-name> feat/<branch-name>
```

This keeps `main` checkout clean and allows multiple agents to work in
parallel without colliding.

## Migrations (mandatory)

All ClickHouse DDL goes through goose — `migrations/` +
`./scripts/migrate.sh up|status`. Never ad-hoc DDL. New MVs need a manual
`INSERT INTO ... SELECT` backfill (MVs only see post-creation inserts).

## Secrets (mandatory)

Secrets come from 1Password Personal vault → `.env` (gitignored). Never
inline. ClickHouse creds in item `4innzk6cud7bz5v562i7tpgpki`, Trigger.dev
in `2pgjlwxybaqvtrxjvlor5dkrsm`, OpenAI in `mfxzvdmx24qw74iue377jcflte`.
`GITHUB_TOKEN` must be set in both the Next.js env and each Trigger.dev
environment.