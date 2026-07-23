# ADR 0003: Subagent Telemetry, Session Learnings, and Fail-Open Spooling

- **Status**: Accepted
- **Date**: 2026-07-21
- **Context**: AGENTS.md Subagent Telemetry & Session Learnings Protocol

## Context & Problem Statement
When running autonomous AI coding agents across multiple LLM models (`Gemini`, `Claude`, `Codex`, `GLM`), benchmarking latency, token counts, cost, and output quality is mandatory. Telemetry inserts must never break or block application execution loops if ClickHouse is temporarily unavailable.

## Decision Drivers
1. **Model Experimentation Tracking**: `subagent_runs` tracks prompt specs, result previews, token counts, latency, and success flags.
2. **Experiment Views**: `subagent_experiments` aggregates runs by model family, agent type, and effort level.
3. **Session Learnings Storage**: `session_learnings` persists engineering caveats, migration gotchas, and reusable architectural patterns.
4. **Fail-Open Architecture**: If ClickHouse credentials are missing or network connections fail, `./scripts/log-subagent-run.sh` spools `subagent_runs` and `subagent_api_events` JSON payloads to `~/.claude/telemetry/spool.ndjson` for automated backfill, while `session_learnings` script execution logs a non-blocking console warning.

## Decision Outcome
Accepted. All subagent runs invoke `./scripts/log-subagent-run.sh` (spooling enabled) and log session learnings to `session_learnings` (non-blocking fallback). JSDoc schema summaries documented in `src/lib/telemetry-queries.ts`.
