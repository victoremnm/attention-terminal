---
name: Attention Terminal work item
about: Capture an evidence-backed, agent-ready feature, bug, performance, or documentation task
title: ""
labels: ""
assignees: ""
---

## User impact

<!-- One sentence describing what changes from the user's seat. Avoid implementation language. -->

## Issue type

- [ ] Bug / incorrect behavior
- [ ] Feature / UX improvement
- [ ] Performance / data contract
- [ ] Documentation / repository hygiene

## Observed evidence

<!-- Include the route, component, query, screenshot, log, or reproduction that proves the issue. -->

- Surface or file:
- Reproduction / query / capture:
- Current behavior:
- Expected behavior:

## Root cause and confidence

<!-- Separate confirmed facts from hypotheses. Do not propose a fix based only on correlation. -->

- Confirmed root cause:
- Evidence supporting it:
- Open questions / assumptions:

## Proposed solution

<!-- Describe the smallest coherent solution. Name the route, component, table, migration, or job when known. -->

## Scope

### In scope

-

### Out of scope

-

## Data and system contract

<!-- Complete when the issue touches ClickHouse, APIs, ingestion, or generated output. -->

- Inputs and source tables/APIs:
- Output shape / user-visible fields:
- Time window and freshness semantics:
- Native types and null/empty behavior:
- Query count/read budget, if relevant:
- Index / ORDER BY / MV considerations:
- Migration and backfill requirements:

## Acceptance criteria

- [ ] The observable user behavior matches the proposed solution.
- [ ] Existing deep links and adjacent surfaces continue to work.
- [ ] Loading, empty, stale, partial, and failed-data states degrade clearly.
- [ ] Accessibility and responsive behavior are verified for changed UI.
- [ ] Tests cover the main path, boundary cases, and regression reported here.
- [ ] Performance changes include before/after rows-read, elapsed-time, and query-count evidence.
- [ ] ClickHouse changes use goose migrations and document any manual MV/backfill step.
- [ ] No secrets, unbounded source text, or unsafe HTML are introduced.

<!-- Add issue-specific criteria below. -->

- [ ]

## Dependencies and related work

<!-- Link parent, blocking, duplicate, or coordinating issues. State which are true blockers. -->

- Parent:
- Blocked by:
- Related:

## Verification plan

### Agent verification

<!-- List exact commands and the observed result; leave unchecked items explicit. -->

- [ ] Unit/integration tests:
- [ ] Build/typecheck/lint:
- [ ] Migration status or query plan:
- [ ] Browser/API verification:

### Human verification

<!-- Name the specific UI interaction, external service, or deployment check that still needs a human. -->

- [ ]

## Graceful degradation

<!-- Explain what the user sees when optional tables, enrichment, agents, or external APIs are absent. -->

## Session and telemetry record

<!-- For agent/subagent work, record the session/run reference and measured or estimated token usage. Never fabricate exact usage. -->

- Session id:
- Agent/run id:
- Model:
- Token usage: measured / estimated / not applicable
- Telemetry record or spool reference:
- Learnings captured:

## Notes for review

<!-- Mention surprising constraints, pre-existing bugs, env vars, migration conflicts, or decisions reviewers should know. -->
