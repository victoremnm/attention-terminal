---
name: repo-docs-audit
description: Audit repository documentation, identify missing operational docs, and scaffold core files. Use when a repository needs better onboarding, maintenance docs, or session-tracking files.
---

# Repo Docs Audit

Use this to check whether a repo has the minimum useful documentation.

## Core Files

- `README.md`
- `CLAUDE.md`
- `PROGRESS.md`
- `HANDOVER.md`

## Workflow

1. Scan the target repo or workspace for the core files.
2. Report what is missing.
3. Scaffold only the docs the repo actually needs.

## Heuristics

- All repos should have `README.md`.
- Active repos benefit from `CLAUDE.md` and `PROGRESS.md`.
- Multi-session work benefits from `HANDOVER.md`.
- Stable repos usually do not need session-tracking docs.
